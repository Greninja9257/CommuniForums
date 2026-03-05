const express = require('express');
const router = express.Router();
const { db, transaction, getRank, getEffectiveRank } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { blockBanned, checkAutoBan } = require('../middleware/moderation');
const { marked } = require('marked');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');
const { scanFields, warningMessage } = require('../utils/profanity');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(text) {
  if (!text) return '';
  const html = marked.parse(text);
  return DOMPurify.sanitize(html);
}

async function processMentions(content, postId, authorId, tx = db) {
  const mentionRegex = /@([a-zA-Z0-9_]+)/g;
  let match;
  const mentioned = new Set();

  while ((match = mentionRegex.exec(content)) !== null) {
    const username = match[1];
    if (mentioned.has(username)) continue;
    mentioned.add(username);

    const user = await tx.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (user && user.id !== authorId) {
      await tx.prepare('INSERT INTO mentions (post_id, mentioner_id, mentioned_id) VALUES (?, ?, ?)')
        .run(postId, authorId, user.id);
      const mentioner = await tx.prepare('SELECT username FROM users WHERE id = ?').get(authorId);
      await tx.prepare('INSERT INTO notifications (user_id, type, reference_id, reference_type, message) VALUES (?, ?, ?, ?, ?)')
        .run(user.id, 'mention', postId, 'post', `@${mentioner.username} mentioned you in a post`);
    }
  }
}

async function checkBadges(userId, tx = db) {
  const user = await tx.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return;

  const badges = await tx.prepare('SELECT * FROM badges').all();
  const userBadges = await tx.prepare('SELECT badge_id FROM user_badges WHERE user_id = ?').all(userId);
  const hasBadge = new Set(userBadges.map(b => b.badge_id));

  for (const badge of badges) {
    if (hasBadge.has(badge.id)) continue;

    let earned = false;
    switch (badge.criteria_type) {
      case 'post_count':
        earned = user.post_count >= badge.criteria_value;
        break;
      case 'thanks_given':
        earned = user.thanks_given >= badge.criteria_value;
        break;
      case 'thanks_received':
        earned = user.thanks_received >= badge.criteria_value;
        break;
      case 'thread_count':
        earned = user.thread_count >= badge.criteria_value;
        break;
      default:
        break;
    }

    if (earned) {
      await tx.prepare('INSERT INTO user_badges (user_id, badge_id) VALUES (?, ?) ON CONFLICT (user_id, badge_id) DO NOTHING')
        .run(userId, badge.id);
      await tx.prepare('INSERT INTO notifications (user_id, type, reference_id, reference_type, message) VALUES (?, ?, ?, ?, ?)')
        .run(userId, 'badge', badge.id, 'badge', `You earned the "${badge.name}" badge! ${badge.icon}`);
    }
  }
}

router.get('/', async (req, res, next) => {
  try {
    const categories = await db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*)::int FROM threads WHERE category_id = c.id) as thread_count,
        (SELECT COUNT(*)::int FROM posts p JOIN threads t ON p.thread_id = t.id WHERE t.category_id = c.id) as post_count,
        (SELECT t.title FROM threads t WHERE t.category_id = c.id ORDER BY t.last_post_at DESC LIMIT 1) as latest_thread_title,
        (SELECT t.id FROM threads t WHERE t.category_id = c.id ORDER BY t.last_post_at DESC LIMIT 1) as latest_thread_id,
        (SELECT u.username FROM threads t JOIN users u ON t.last_post_by = u.id WHERE t.category_id = c.id ORDER BY t.last_post_at DESC LIMIT 1) as latest_poster
      FROM categories c ORDER BY c.display_order, c.id
    `).all();

    const topLevel = categories.filter(c => !c.parent_id);
    for (const cat of topLevel) {
      cat.subcategories = categories.filter(c => c.parent_id === cat.id);
    }

    res.render('forums/categories', { title: 'Forums', categories: topLevel });
  } catch (error) {
    next(error);
  }
});

router.post('/categories/create', requireAuth, blockBanned, async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    const description = (req.body.description || '').trim();
    const parentId = req.body.parent_id ? parseInt(req.body.parent_id, 10) : null;

    if (name.length < 3 || name.length > 60) {
      req.flash('error', 'Category name must be between 3 and 60 characters.');
      return res.redirect('/forums');
    }
    const categoryScan = scanFields({ name, description });
    if (categoryScan.flagged) {
      req.flash('error', warningMessage(categoryScan));
      return res.redirect('/forums');
    }

    if (parentId) {
      const parent = await db.prepare('SELECT id FROM categories WHERE id = ?').get(parentId);
      if (!parent) {
        req.flash('error', 'Parent category not found.');
        return res.redirect('/forums');
      }
    }

    const existing = await db.prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?)').get(name);
    if (existing) {
      req.flash('error', 'A category with that name already exists.');
      return res.redirect('/forums');
    }

    const orderRow = await db.prepare(
      'SELECT COALESCE(MAX(display_order), 0)::int as max_order FROM categories WHERE parent_id IS NOT DISTINCT FROM ?'
    ).get(parentId);

    await db.prepare(
      'INSERT INTO categories (name, description, icon, display_order, parent_id) VALUES (?, ?, ?, ?, ?)'
    ).run(name, description.substring(0, 180), '', (orderRow.max_order || 0) + 1, parentId);

    req.flash('success', 'Category created successfully.');
    res.redirect('/forums');
  } catch (error) {
    next(error);
  }
});

router.get('/category/:id', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = 20;
    const offset = (page - 1) * perPage;

    const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
    if (!category) return res.status(404).render('error', { title: 'Not Found', message: 'Category not found.' });

    const subcategories = await db.prepare('SELECT * FROM categories WHERE parent_id = ? ORDER BY display_order').all(category.id);

    const totalThreads = (await db.prepare('SELECT COUNT(*)::int as c FROM threads WHERE category_id = ?').get(category.id)).c;
    const totalPages = Math.ceil(totalThreads / perPage);

    const threads = await db.prepare(`
      SELECT t.*, u.username as author_name, u.avatar as author_avatar,
        lu.username as last_poster_name,
        (SELECT COUNT(*)::int FROM posts WHERE thread_id = t.id) - 1 as reply_count
      FROM threads t
      JOIN users u ON t.author_id = u.id
      LEFT JOIN users lu ON t.last_post_by = lu.id
      WHERE t.category_id = ?
      ORDER BY t.is_pinned DESC, t.last_post_at DESC
      LIMIT ? OFFSET ?
    `).all(category.id, perPage, offset);

    res.render('forums/category', {
      title: category.name,
      category,
      subcategories,
      threads,
      page,
      totalPages,
      totalThreads
    });
  } catch (error) {
    next(error);
  }
});

router.get('/thread/:id', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = 15;
    const offset = (page - 1) * perPage;

    const thread = await db.prepare(`
      SELECT t.*, u.username as author_name, c.name as category_name, c.id as category_id
      FROM threads t
      JOIN users u ON t.author_id = u.id
      JOIN categories c ON t.category_id = c.id
      WHERE t.id = ?
    `).get(req.params.id);

    if (!thread) return res.status(404).render('error', { title: 'Not Found', message: 'Thread not found.' });

    await db.prepare('UPDATE threads SET view_count = view_count + 1 WHERE id = ?').run(thread.id);

    const totalPosts = (await db.prepare('SELECT COUNT(*)::int as c FROM posts WHERE thread_id = ?').get(thread.id)).c;
    const totalPages = Math.ceil(totalPosts / perPage);

    const posts = await db.prepare(`
      SELECT p.*, u.username as author_name, u.avatar as author_avatar,
        u.role as author_role, u.thanks_received as author_thanks,
        u.post_count as author_post_count, u.created_at as author_joined,
        u.bio as author_bio,
        u.rank_override_title as rank_override_title,
        u.rank_override_color as rank_override_color
      FROM posts p
      JOIN users u ON p.author_id = u.id
      WHERE p.thread_id = ?
      ORDER BY p.created_at ASC
      LIMIT ? OFFSET ?
    `).all(thread.id, perPage, offset);

    for (const post of posts) {
      post.content_html = renderMarkdown(post.content);
      post.rank = getEffectiveRank({
        thanks_received: post.author_thanks,
        rank_override_title: post.rank_override_title,
        rank_override_color: post.rank_override_color
      });
      post.badges = await db.prepare(`
        SELECT b.* FROM badges b
        JOIN user_badges ub ON b.id = ub.badge_id
        WHERE ub.user_id = ?
      `).all(post.author_id);

      if (res.locals.currentUser) {
        post.userThanked = !!(await db.prepare(
          'SELECT 1 FROM thanks WHERE post_id = ? AND giver_id = ?'
        ).get(post.id, res.locals.currentUser.id));
        post.userThumbedDown = !!(await db.prepare(
          'SELECT 1 FROM thumbs_down WHERE post_id = ? AND giver_id = ?'
        ).get(post.id, res.locals.currentUser.id));
      }
    }

    res.render('forums/thread', {
      title: thread.title,
      thread,
      posts,
      page,
      totalPages,
      totalPosts,
      getRank
    });
  } catch (error) {
    next(error);
  }
});

router.get('/new-thread/:categoryId', requireAuth, blockBanned, async (req, res, next) => {
  try {
    const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.categoryId);
    if (!category) return res.status(404).render('error', { title: 'Not Found', message: 'Category not found.' });
    res.render('forums/new-thread', { title: 'New Thread', category, error: null });
  } catch (error) {
    next(error);
  }
});

router.post('/new-thread/:categoryId', requireAuth, blockBanned, async (req, res, next) => {
  try {
    const { title, content } = req.body;
    const categoryId = req.params.categoryId;

    const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
    if (!category) return res.status(404).render('error', { title: 'Not Found', message: 'Category not found.' });

    if (!title || !content || title.trim().length < 3) {
      return res.render('forums/new-thread', {
        title: 'New Thread',
        category,
        error: 'Title (min 3 chars) and content are required.'
      });
    }
    const threadScan = scanFields({ title, content });
    if (threadScan.flagged) {
      return res.render('forums/new-thread', {
        title: 'New Thread',
        category,
        error: warningMessage(threadScan)
      });
    }

    const threadId = await transaction(async (tx) => {
      const threadResult = await tx.prepare(
        'INSERT INTO threads (title, category_id, author_id, last_post_by) VALUES (?, ?, ?, ?)'
      ).run(title.trim(), categoryId, res.locals.currentUser.id, res.locals.currentUser.id);

      const postResult = await tx.prepare(
        'INSERT INTO posts (thread_id, author_id, content) VALUES (?, ?, ?)'
      ).run(threadResult.lastInsertRowid, res.locals.currentUser.id, content.trim());

      await tx.prepare('UPDATE users SET post_count = post_count + 1, thread_count = thread_count + 1 WHERE id = ?')
        .run(res.locals.currentUser.id);

      await tx.prepare('UPDATE categories SET thread_count = thread_count + 1, post_count = post_count + 1 WHERE id = ?')
        .run(categoryId);

      await processMentions(content, postResult.lastInsertRowid, res.locals.currentUser.id, tx);
      await checkBadges(res.locals.currentUser.id, tx);

      return threadResult.lastInsertRowid;
    });

    req.flash('success', 'Thread created successfully!');
    res.redirect(`/forums/thread/${threadId}`);
  } catch (error) {
    next(error);
  }
});

router.post('/thread/:id/reply', requireAuth, blockBanned, async (req, res, next) => {
  try {
    const { content } = req.body;
    const thread = await db.prepare('SELECT * FROM threads WHERE id = ?').get(req.params.id);

    if (!thread) return res.status(404).render('error', { title: 'Not Found', message: 'Thread not found.' });
    if (thread.is_locked) {
      req.flash('error', 'This thread is locked.');
      return res.redirect(`/forums/thread/${thread.id}`);
    }
    if (!content || content.trim().length < 1) {
      req.flash('error', 'Reply content is required.');
      return res.redirect(`/forums/thread/${thread.id}`);
    }
    const replyScan = scanFields({ content });
    if (replyScan.flagged) {
      req.flash('error', warningMessage(replyScan));
      return res.redirect(`/forums/thread/${thread.id}`);
    }

    await transaction(async (tx) => {
      const postResult = await tx.prepare(
        'INSERT INTO posts (thread_id, author_id, content) VALUES (?, ?, ?)'
      ).run(thread.id, res.locals.currentUser.id, content.trim());

      await tx.prepare(
        'UPDATE threads SET reply_count = reply_count + 1, last_post_at = CURRENT_TIMESTAMP, last_post_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(res.locals.currentUser.id, thread.id);

      await tx.prepare('UPDATE users SET post_count = post_count + 1 WHERE id = ?')
        .run(res.locals.currentUser.id);

      await tx.prepare('UPDATE categories SET post_count = post_count + 1 WHERE id = ?')
        .run(thread.category_id);

      if (thread.author_id !== res.locals.currentUser.id) {
        await tx.prepare(
          'INSERT INTO notifications (user_id, type, reference_id, reference_type, message) VALUES (?, ?, ?, ?, ?)'
        ).run(thread.author_id, 'reply', thread.id, 'thread',
          `${res.locals.currentUser.username} replied to your thread "${thread.title}"`);
      }

      await processMentions(content, postResult.lastInsertRowid, res.locals.currentUser.id, tx);
      await checkBadges(res.locals.currentUser.id, tx);

      const replyCount = (await tx.prepare('SELECT COUNT(*)::int as c FROM posts WHERE thread_id = ?').get(thread.id)).c;
      if (replyCount >= 50) {
        const badge = await tx.prepare('SELECT id FROM badges WHERE name = ?').get('Popular Thread');
        if (badge) {
          await tx.prepare('INSERT INTO user_badges (user_id, badge_id) VALUES (?, ?) ON CONFLICT (user_id, badge_id) DO NOTHING')
            .run(thread.author_id, badge.id);
        }
      }
    });

    const totalPosts = (await db.prepare('SELECT COUNT(*)::int as c FROM posts WHERE thread_id = ?').get(thread.id)).c;
    const lastPage = Math.ceil(totalPosts / 15);
    res.redirect(`/forums/thread/${thread.id}?page=${lastPage}#latest`);
  } catch (error) {
    next(error);
  }
});

router.post('/post/:id/edit', requireAuth, blockBanned, async (req, res, next) => {
  try {
    const post = await db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
    if (!post) return res.status(404).render('error', { title: 'Not Found', message: 'Post not found' });

    if (post.author_id !== res.locals.currentUser.id && !['moderator', 'admin'].includes(res.locals.currentUser.role)) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'Not authorized' });
    }

    const { content } = req.body;
    if (!content || content.trim().length < 1) {
      req.flash('error', 'Content required.');
      return res.redirect(`/forums/thread/${post.thread_id}`);
    }
    const editScan = scanFields({ content });
    if (editScan.flagged) {
      req.flash('error', warningMessage(editScan));
      return res.redirect(`/forums/thread/${post.thread_id}`);
    }

    await db.prepare('UPDATE posts SET content = ?, is_edited = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(content.trim(), post.id);

    res.redirect(`/forums/thread/${post.thread_id}`);
  } catch (error) {
    next(error);
  }
});

router.post('/post/:id/delete', requireAuth, async (req, res, next) => {
  try {
    const post = await db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    if (post.author_id !== res.locals.currentUser.id && !['moderator', 'admin'].includes(res.locals.currentUser.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const thread = await db.prepare('SELECT * FROM threads WHERE id = ?').get(post.thread_id);

    const firstPost = await db.prepare('SELECT id FROM posts WHERE thread_id = ? ORDER BY created_at ASC LIMIT 1').get(post.thread_id);
    if (firstPost && firstPost.id === post.id) {
      await db.prepare('DELETE FROM threads WHERE id = ?').run(post.thread_id);
      req.flash('success', 'Thread deleted.');
      return res.redirect(`/forums/category/${thread.category_id}`);
    }

    await db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
    await db.prepare('UPDATE threads SET reply_count = GREATEST(reply_count - 1, 0) WHERE id = ?').run(post.thread_id);
    await db.prepare('UPDATE users SET post_count = GREATEST(post_count - 1, 0) WHERE id = ?').run(post.author_id);

    req.flash('success', 'Post deleted.');
    res.redirect(`/forums/thread/${post.thread_id}`);
  } catch (error) {
    next(error);
  }
});

router.post('/post/:id/thank', requireAuth, blockBanned, async (req, res, next) => {
  try {
    const post = await db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.author_id === res.locals.currentUser.id) {
      return res.status(400).json({ error: 'Cannot thank your own post' });
    }

    const existing = await db.prepare('SELECT 1 FROM thanks WHERE post_id = ? AND giver_id = ?')
      .get(post.id, res.locals.currentUser.id);

    if (existing) {
      await db.prepare('DELETE FROM thanks WHERE post_id = ? AND giver_id = ?')
        .run(post.id, res.locals.currentUser.id);
      await db.prepare('UPDATE posts SET thanks_count = GREATEST(thanks_count - 1, 0) WHERE id = ?').run(post.id);
      await db.prepare('UPDATE users SET thanks_received = GREATEST(thanks_received - 1, 0) WHERE id = ?').run(post.author_id);
      await db.prepare('UPDATE users SET thanks_given = GREATEST(thanks_given - 1, 0) WHERE id = ?').run(res.locals.currentUser.id);
      return res.json({ thanked: false, count: Math.max(0, post.thanks_count - 1) });
    }

    await db.prepare('INSERT INTO thanks (post_id, giver_id, receiver_id) VALUES (?, ?, ?)')
      .run(post.id, res.locals.currentUser.id, post.author_id);
    await db.prepare('UPDATE posts SET thanks_count = thanks_count + 1 WHERE id = ?').run(post.id);
    await db.prepare('UPDATE users SET thanks_received = thanks_received + 1 WHERE id = ?').run(post.author_id);
    await db.prepare('UPDATE users SET thanks_given = thanks_given + 1 WHERE id = ?').run(res.locals.currentUser.id);

    await db.prepare('INSERT INTO notifications (user_id, type, reference_id, reference_type, message) VALUES (?, ?, ?, ?, ?)')
      .run(post.author_id, 'thanks', post.id, 'post',
        `${res.locals.currentUser.username} thanked your post!`);

    await checkBadges(post.author_id);
    await checkBadges(res.locals.currentUser.id);

    res.json({ thanked: true, count: post.thanks_count + 1 });
  } catch (error) {
    next(error);
  }
});

router.post('/post/:id/thumbs-down', requireAuth, blockBanned, async (req, res, next) => {
  try {
    const post = await db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.author_id === res.locals.currentUser.id) {
      return res.status(400).json({ error: 'Cannot thumbs-down your own post' });
    }

    const { reason } = req.body;
    if (!reason || reason.trim().length < 3) {
      return res.status(400).json({ error: 'A reason is required (minimum 3 characters)' });
    }

    const existing = await db.prepare('SELECT 1 FROM thumbs_down WHERE post_id = ? AND giver_id = ?')
      .get(post.id, res.locals.currentUser.id);
    if (existing) {
      return res.status(400).json({ error: 'Already thumbs-downed' });
    }

    await db.prepare('INSERT INTO thumbs_down (post_id, giver_id, receiver_id, reason) VALUES (?, ?, ?, ?)')
      .run(post.id, res.locals.currentUser.id, post.author_id, reason.trim());
    await db.prepare('UPDATE posts SET thumbs_down_count = thumbs_down_count + 1 WHERE id = ?').run(post.id);

    const banResult = await checkAutoBan(post.author_id);

    res.json({
      success: true,
      count: post.thumbs_down_count + 1,
      autoBanned: banResult.banned
    });
  } catch (error) {
    next(error);
  }
});

router.post('/post/:id/report', requireAuth, async (req, res, next) => {
  try {
    const post = await db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const { reason } = req.body;
    if (!reason || reason.trim().length < 5) {
      return res.status(400).json({ error: 'A reason is required (minimum 5 characters)' });
    }

    await db.prepare('INSERT INTO reports (reporter_id, post_id, reason) VALUES (?, ?, ?)')
      .run(res.locals.currentUser.id, post.id, reason.trim());

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post('/thread/:id/pin', requireAuth, async (req, res, next) => {
  try {
    if (!['moderator', 'admin'].includes(res.locals.currentUser.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const thread = await db.prepare('SELECT * FROM threads WHERE id = ?').get(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });

    await db.prepare('UPDATE threads SET is_pinned = ? WHERE id = ?').run(thread.is_pinned ? 0 : 1, thread.id);
    res.redirect(`/forums/thread/${thread.id}`);
  } catch (error) {
    next(error);
  }
});

router.post('/thread/:id/lock', requireAuth, async (req, res, next) => {
  try {
    if (!['moderator', 'admin'].includes(res.locals.currentUser.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const thread = await db.prepare('SELECT * FROM threads WHERE id = ?').get(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });

    await db.prepare('UPDATE threads SET is_locked = ? WHERE id = ?').run(thread.is_locked ? 0 : 1, thread.id);
    res.redirect(`/forums/thread/${thread.id}`);
  } catch (error) {
    next(error);
  }
});

router.post('/thread/:id/solve', requireAuth, async (req, res, next) => {
  try {
    const thread = await db.prepare('SELECT * FROM threads WHERE id = ?').get(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });

    if (thread.author_id !== res.locals.currentUser.id && !['moderator', 'admin'].includes(res.locals.currentUser.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await db.prepare('UPDATE threads SET is_solved = ? WHERE id = ?').run(thread.is_solved ? 0 : 1, thread.id);
    res.redirect(`/forums/thread/${thread.id}`);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
