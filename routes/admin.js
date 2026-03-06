const express = require('express');
const router = express.Router();
const { db, getRank, getEffectiveRank } = require('../database');
const { requireAuth, requireMod } = require('../middleware/auth');
const { refreshTrustForUser } = require('../utils/trust');
const { scanFields, warningMessage } = require('../utils/profanity');

router.use(requireAuth, requireMod);

router.get('/', async (req, res, next) => {
  try {
    const stats = {
      totalUsers: (await db.prepare('SELECT COUNT(*)::int as c FROM users').get()).c,
      totalThreads: (await db.prepare('SELECT COUNT(*)::int as c FROM threads').get()).c,
      totalPosts: (await db.prepare('SELECT COUNT(*)::int as c FROM posts').get()).c,
      totalThanks: (await db.prepare('SELECT COUNT(*)::int as c FROM thanks').get()).c,
      totalThumbsDown: (await db.prepare('SELECT COUNT(*)::int as c FROM thumbs_down').get()).c,
      pendingReports: (await db.prepare("SELECT COUNT(*)::int as c FROM reports WHERE status = 'pending'").get()).c,
      triagedReports: (await db.prepare("SELECT COUNT(*)::int as c FROM reports WHERE workflow_state IN ('triaged', 'investigating')").get()).c,
      bannedUsers: (await db.prepare('SELECT COUNT(*)::int as c FROM users WHERE banned_until > NOW()').get()).c,
      newUsersToday: (await db.prepare("SELECT COUNT(*)::int as c FROM users WHERE created_at > NOW() - INTERVAL '1 day'").get()).c,
      newPostsToday: (await db.prepare("SELECT COUNT(*)::int as c FROM posts WHERE created_at > NOW() - INTERVAL '1 day'").get()).c,
    };

    const recentReports = await db.prepare(`
      SELECT r.*, u.username as reporter_name, p.content as post_content, p.author_id as post_author_id,
        pu.username as post_author_name, am.username as assigned_mod_name
      FROM reports r
      JOIN users u ON r.reporter_id = u.id
      JOIN posts p ON r.post_id = p.id
      JOIN users pu ON p.author_id = pu.id
      LEFT JOIN users am ON r.assigned_mod_id = am.id
      WHERE r.status IN ('pending', 'reviewed')
      ORDER BY
        CASE r.priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
        r.created_at DESC
      LIMIT 20
    `).all();

    const moderatorList = await db.prepare(
      "SELECT id, username FROM users WHERE role IN ('moderator', 'admin') ORDER BY username ASC"
    ).all();

    const recentModActions = await db.prepare(`
      SELECT ma.*, m.username as mod_name, tu.username as target_name
      FROM mod_actions ma
      JOIN users m ON ma.mod_id = m.id
      LEFT JOIN users tu ON ma.target_user_id = tu.id
      ORDER BY ma.created_at DESC LIMIT 10
    `).all();

    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      stats,
      recentReports,
      moderatorList,
      recentModActions,
      getRank
    });
  } catch (error) {
    next(error);
  }
});

router.get('/users', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = 25;
    const offset = (page - 1) * perPage;
    const search = req.query.search || '';

    let query = 'SELECT * FROM users';
    let countQuery = 'SELECT COUNT(*)::int as c FROM users';
    const params = [];

    if (search) {
      query += ' WHERE username ILIKE ? OR email ILIKE ?';
      countQuery += ' WHERE username ILIKE ? OR email ILIKE ?';
      params.push(`%${search}%`, `%${search}%`);
    }

    const total = (await db.prepare(countQuery).get(...params)).c;
    const totalPages = Math.ceil(total / perPage);

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    const users = await db.prepare(query).all(...params, perPage, offset);

    res.render('admin/users', {
      title: 'Manage Users',
      users: users.map(u => ({ ...u, rank: getEffectiveRank(u) })),
      page,
      totalPages,
      search,
      getRank
    });
  } catch (error) {
    next(error);
  }
});

router.post('/users/:id/ban', async (req, res, next) => {
  try {
    const { days, reason } = req.body;
    const banDays = parseInt(days, 10) || 1;
    const banUntil = new Date(Date.now() + banDays * 24 * 60 * 60 * 1000).toISOString();

    await db.prepare('UPDATE users SET banned_until = ?, ban_reason = ?, ban_count = ban_count + 1 WHERE id = ?')
      .run(banUntil, reason || 'Banned by moderator', req.params.id);

    await db.prepare('INSERT INTO mod_actions (mod_id, target_user_id, action_type, reason, duration) VALUES (?, ?, ?, ?, ?)')
      .run(res.locals.currentUser.id, req.params.id, 'ban', reason || 'Manual ban', banDays);

    await db.prepare('INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)')
      .run(req.params.id, 'moderation', `You have been banned for ${banDays} day(s). Reason: ${reason || 'Moderator action'}`);

    req.flash('success', 'User banned.');
    res.redirect('/admin/users');
  } catch (error) {
    next(error);
  }
});

router.post('/users/:id/unban', async (req, res, next) => {
  try {
    await db.prepare('UPDATE users SET banned_until = NULL, ban_reason = NULL WHERE id = ?').run(req.params.id);

    await db.prepare('INSERT INTO mod_actions (mod_id, target_user_id, action_type, reason) VALUES (?, ?, ?, ?)')
      .run(res.locals.currentUser.id, req.params.id, 'unban', 'Manual unban');

    await db.prepare('INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)')
      .run(req.params.id, 'moderation', 'Your ban has been lifted. Welcome back!');

    req.flash('success', 'User unbanned.');
    res.redirect('/admin/users');
  } catch (error) {
    next(error);
  }
});

router.post('/users/:id/role', async (req, res, next) => {
  try {
    if (res.locals.currentUser.role !== 'admin') {
      return res.status(403).render('error', { title: 'Forbidden', message: 'Admin only.' });
    }
    const { role } = req.body;
    if (!['user', 'moderator', 'admin'].includes(role)) {
      return res.status(400).render('error', { title: 'Bad Request', message: 'Invalid role.' });
    }

    await db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
    await db.prepare('INSERT INTO mod_actions (mod_id, target_user_id, action_type, reason) VALUES (?, ?, ?, ?)')
      .run(res.locals.currentUser.id, req.params.id, 'role_change', `Changed role to ${role}`);

    req.flash('success', 'User role updated.');
    res.redirect('/admin/users');
  } catch (error) {
    next(error);
  }
});

router.get('/categories', async (req, res, next) => {
  try {
    const categories = await db.prepare('SELECT * FROM categories ORDER BY display_order, id').all();
    res.render('admin/categories', { title: 'Manage Categories', categories });
  } catch (error) {
    next(error);
  }
});

router.post('/categories/create', async (req, res, next) => {
  try {
    const { name, description, icon, display_order, parent_id } = req.body;
    const categoryScan = scanFields({ name, description });
    if (categoryScan.flagged) {
      req.flash('error', warningMessage(categoryScan));
      return res.redirect('/admin/categories');
    }
    await db.prepare(
      'INSERT INTO categories (name, description, icon, display_order, parent_id) VALUES (?, ?, ?, ?, ?)'
    ).run(name, description || '', (icon || '').trim(), parseInt(display_order, 10) || 0, parent_id || null);

    req.flash('success', 'Category created.');
    res.redirect('/admin/categories');
  } catch (error) {
    next(error);
  }
});

router.post('/categories/:id/edit', async (req, res, next) => {
  try {
    const { name, description, icon, display_order } = req.body;
    const categoryScan = scanFields({ name, description });
    if (categoryScan.flagged) {
      req.flash('error', warningMessage(categoryScan));
      return res.redirect('/admin/categories');
    }
    await db.prepare(
      'UPDATE categories SET name = ?, description = ?, icon = ?, display_order = ? WHERE id = ?'
    ).run(name, description || '', (icon || '').trim(), parseInt(display_order, 10) || 0, req.params.id);

    req.flash('success', 'Category updated.');
    res.redirect('/admin/categories');
  } catch (error) {
    next(error);
  }
});

router.post('/categories/:id/delete', async (req, res, next) => {
  try {
    const threadCount = (await db.prepare('SELECT COUNT(*)::int as c FROM threads WHERE category_id = ?').get(req.params.id)).c;
    if (threadCount > 0) {
      req.flash('error', 'Cannot delete category with threads. Move or delete threads first.');
      return res.redirect('/admin/categories');
    }
    await db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
    req.flash('success', 'Category deleted.');
    res.redirect('/admin/categories');
  } catch (error) {
    next(error);
  }
});

router.post('/reports/:id/resolve', async (req, res, next) => {
  try {
    const { action, note, assignee_id } = req.body;
    const report = await db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
    if (!report) {
      req.flash('error', 'Report not found.');
      return res.redirect('/admin');
    }

    if (action === 'assign') {
      await db.prepare(
        "UPDATE reports SET assigned_mod_id = ?, workflow_state = 'investigating', status = 'reviewed' WHERE id = ?"
      ).run(assignee_id || null, req.params.id);
      await db.prepare('INSERT INTO mod_actions (mod_id, action_type, reason) VALUES (?, ?, ?)')
        .run(res.locals.currentUser.id, 'assign_report', `Report #${req.params.id} assigned to mod ${assignee_id || 'none'}`);
      req.flash('success', 'Report assignment updated.');
      return res.redirect('/admin');
    }

    if (action === 'triage') {
      await db.prepare(
        "UPDATE reports SET workflow_state = 'triaged', status = 'reviewed', assigned_mod_id = COALESCE(assigned_mod_id, ?) WHERE id = ?"
      ).run(res.locals.currentUser.id, req.params.id);
      await db.prepare('INSERT INTO mod_actions (mod_id, action_type, reason) VALUES (?, ?, ?)')
        .run(res.locals.currentUser.id, 'triage_report', `Report #${req.params.id} triaged`);
      req.flash('success', 'Report triaged.');
      return res.redirect('/admin');
    }

    let finalStatus = 'resolved';
    let resolvedAction = action || 'resolved';
    let workflowState = 'closed';

    const post = await db.prepare('SELECT id, author_id, thread_id FROM posts WHERE id = ?').get(report.post_id);

    if (action === 'dismissed') {
      finalStatus = 'dismissed';
      resolvedAction = 'dismissed';
    } else if (action === 'delete_post' && post) {
      const thread = await db.prepare('SELECT id, category_id FROM threads WHERE id = ?').get(post.thread_id);
      const firstPost = await db.prepare('SELECT id FROM posts WHERE thread_id = ? ORDER BY created_at ASC LIMIT 1').get(post.thread_id);
      await db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
      if (firstPost && firstPost.id === post.id) {
        await db.prepare('DELETE FROM threads WHERE id = ?').run(post.thread_id);
        if (thread?.category_id) {
          await db.prepare('UPDATE categories SET thread_count = GREATEST(thread_count - 1, 0) WHERE id = ?').run(thread.category_id);
          await db.prepare('UPDATE categories SET post_count = GREATEST(post_count - 1, 0) WHERE id = ?').run(thread.category_id);
        }
      } else if (thread?.category_id) {
        await db.prepare('UPDATE threads SET reply_count = GREATEST(reply_count - 1, 0) WHERE id = ?').run(post.thread_id);
        await db.prepare('UPDATE categories SET post_count = GREATEST(post_count - 1, 0) WHERE id = ?').run(thread.category_id);
      }
      await db.prepare('UPDATE users SET post_count = GREATEST(post_count - 1, 0) WHERE id = ?').run(post.author_id);
    } else if (action === 'warn_user' && post) {
      await db.prepare('INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)')
        .run(post.author_id, 'moderation', `A moderator warning was issued on your post. ${note || ''}`);
    } else if (action === 'ban_1d' && post) {
      const banUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await db.prepare('UPDATE users SET banned_until = ?, ban_reason = ?, ban_count = ban_count + 1 WHERE id = ?')
        .run(banUntil, note || 'Banned after report review', post.author_id);
      await db.prepare('INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)')
        .run(post.author_id, 'moderation', `You have been banned for 1 day. ${note || ''}`);
    }

    await db.prepare(
      'UPDATE reports SET status = ?, workflow_state = ?, resolved_action = ?, resolved_by = ?, resolution_note = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(finalStatus, workflowState, resolvedAction, res.locals.currentUser.id, note || '', req.params.id);

    await db.prepare('INSERT INTO mod_actions (mod_id, action_type, reason) VALUES (?, ?, ?)')
      .run(res.locals.currentUser.id, 'resolve_report', `Report #${req.params.id}: ${resolvedAction} - ${note || 'No note'}`);

    if (report.reporter_id) {
      await refreshTrustForUser(report.reporter_id);
    }
    if (post?.author_id) {
      await refreshTrustForUser(post.author_id);
    }

    req.flash('success', 'Report resolved.');
    res.redirect('/admin');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
