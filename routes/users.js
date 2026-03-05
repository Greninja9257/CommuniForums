const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { db, getRank, getEffectiveRank, getRankByTitle, isHighestRank, RANKS } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { scanFields, warningMessage } = require('../utils/profanity');

router.get('/profile/:id', async (req, res, next) => {
  try {
    const user = await db.prepare(`
      SELECT id, username, email, avatar, bio, role, thanks_received, thanks_given,
        post_count, thread_count, banned_until, ban_reason, last_active, created_at,
        rank_override_title, rank_override_color, rank_override_reason, rank_override_by, rank_override_at
      FROM users WHERE id = ?
    `).get(req.params.id);

    if (!user) return res.status(404).render('error', { title: 'Not Found', message: 'User not found.' });

    const rank = getEffectiveRank(user);

    const badges = await db.prepare(`
      SELECT b.*, ub.awarded_at FROM badges b
      JOIN user_badges ub ON b.id = ub.badge_id
      WHERE ub.user_id = ?
      ORDER BY ub.awarded_at DESC
    `).all(user.id);

    const recentPosts = await db.prepare(`
      SELECT p.*, t.title as thread_title, t.id as thread_id
      FROM posts p
      JOIN threads t ON p.thread_id = t.id
      WHERE p.author_id = ?
      ORDER BY p.created_at DESC LIMIT 10
    `).all(user.id);

    const recentThreads = await db.prepare(`
      SELECT t.*, c.name as category_name
      FROM threads t
      JOIN categories c ON t.category_id = c.id
      WHERE t.author_id = ?
      ORDER BY t.created_at DESC LIMIT 10
    `).all(user.id);

    const thanksGivenRecent = (await db.prepare(
      "SELECT COUNT(*)::int as c FROM thanks WHERE giver_id = ? AND created_at > NOW() - INTERVAL '30 days'"
    ).get(user.id)).c;

    const postsRecent = (await db.prepare(
      "SELECT COUNT(*)::int as c FROM posts WHERE author_id = ? AND created_at > NOW() - INTERVAL '30 days'"
    ).get(user.id)).c;

    let rankOverrideBy = null;
    if (user.rank_override_by) {
      rankOverrideBy = await db.prepare('SELECT id, username FROM users WHERE id = ?').get(user.rank_override_by);
    }

    res.render('users/profile', {
      title: user.username + "'s Profile",
      profileUser: user,
      rank,
      rankOverrideBy,
      canManageRanks: isHighestRank(res.locals.currentUser),
      rankOptions: RANKS.map(r => r.title),
      badges,
      recentPosts,
      recentThreads,
      thanksGivenRecent,
      postsRecent,
      getRank
    });
  } catch (error) {
    next(error);
  }
});

router.get('/settings', requireAuth, (req, res) => {
  res.render('users/settings', { title: 'Settings', error: null, success: null });
});

router.post('/settings', requireAuth, async (req, res, next) => {
  try {
    const { bio, avatar, current_password, new_password, confirm_password } = req.body;

    if (bio !== undefined) {
      const cleanBio = (bio || '').substring(0, 500);
      const bioScan = scanFields({ bio: cleanBio });
      if (bioScan.flagged) {
        return res.render('users/settings', { title: 'Settings', error: warningMessage(bioScan), success: null });
      }
      await db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(cleanBio, res.locals.currentUser.id);
    }

    if (avatar && avatar.match(/^https?:\/\/.+\..+/)) {
      await db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, res.locals.currentUser.id);
    }

    if (current_password && new_password) {
      const user = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(res.locals.currentUser.id);
      const valid = await bcrypt.compare(current_password, user.password_hash);
      if (!valid) {
        return res.render('users/settings', { title: 'Settings', error: 'Current password is incorrect.', success: null });
      }
      if (new_password.length < 6) {
        return res.render('users/settings', { title: 'Settings', error: 'New password must be at least 6 characters.', success: null });
      }
      if (new_password !== confirm_password) {
        return res.render('users/settings', { title: 'Settings', error: 'New passwords do not match.', success: null });
      }
      const hash = await bcrypt.hash(new_password, 12);
      await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, res.locals.currentUser.id);
    }

    res.render('users/settings', { title: 'Settings', error: null, success: 'Settings updated successfully!' });
  } catch (error) {
    next(error);
  }
});

router.get('/members', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = 20;
    const offset = (page - 1) * perPage;
    const sort = req.query.sort || 'thanks';

    let orderBy = 'thanks_received DESC';
    if (sort === 'posts') orderBy = 'post_count DESC';
    if (sort === 'newest') orderBy = 'created_at DESC';
    if (sort === 'oldest') orderBy = 'created_at ASC';
    if (sort === 'active') orderBy = 'last_active DESC';

    const totalUsers = (await db.prepare('SELECT COUNT(*)::int as c FROM users').get()).c;
    const totalPages = Math.ceil(totalUsers / perPage);

    const users = await db.prepare(`
      SELECT id, username, avatar, role, thanks_received, post_count, created_at, last_active,
        rank_override_title, rank_override_color
      FROM users ORDER BY ${orderBy} LIMIT ? OFFSET ?
    `).all(perPage, offset);

    const usersWithRanks = users.map(u => ({ ...u, rank: getEffectiveRank(u) }));

    res.render('users/members', {
      title: 'Members',
      members: usersWithRanks,
      page,
      totalPages,
      totalUsers,
      sort
    });
  } catch (error) {
    next(error);
  }
});

router.post('/profile/:id/rank', requireAuth, async (req, res, next) => {
  try {
    if (!isHighestRank(res.locals.currentUser)) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'Rank management requires highest rank.' });
    }

    const target = await db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
    if (!target) return res.status(404).render('error', { title: 'Not Found', message: 'User not found.' });

    const action = req.body.action || 'set';
    if (action === 'clear') {
      await db.prepare(
        'UPDATE users SET rank_override_title = NULL, rank_override_color = NULL, rank_override_reason = NULL, rank_override_by = NULL, rank_override_at = NULL WHERE id = ?'
      ).run(target.id);

      await db.prepare('INSERT INTO mod_actions (mod_id, target_user_id, action_type, reason) VALUES (?, ?, ?, ?)')
        .run(res.locals.currentUser.id, target.id, 'rank_revoke', 'Rank override revoked');

      await db.prepare('INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)')
        .run(target.id, 'moderation', 'Your special rank has been revoked.');

      req.flash('success', 'Rank override revoked.');
      return res.redirect(`/users/profile/${target.id}`);
    }

    const title = (req.body.rank_title || '').trim();
    const reason = (req.body.reason || '').trim();
    const rank = getRankByTitle(title);
    if (!rank) {
      req.flash('error', 'Invalid rank selected.');
      return res.redirect(`/users/profile/${target.id}`);
    }

    await db.prepare(
      'UPDATE users SET rank_override_title = ?, rank_override_color = ?, rank_override_reason = ?, rank_override_by = ?, rank_override_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(rank.title, rank.color, reason || null, res.locals.currentUser.id, target.id);

    await db.prepare('INSERT INTO mod_actions (mod_id, target_user_id, action_type, reason) VALUES (?, ?, ?, ?)')
      .run(res.locals.currentUser.id, target.id, 'rank_grant', `Assigned rank: ${rank.title}${reason ? ' - ' + reason : ''}`);

    await db.prepare('INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)')
      .run(target.id, 'moderation', `You have been granted the "${rank.title}" rank.`);

    req.flash('success', 'Rank override saved.');
    res.redirect(`/users/profile/${target.id}`);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
