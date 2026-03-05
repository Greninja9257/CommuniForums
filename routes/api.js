const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { db, getRank } = require('../database');
const { requireAuth } = require('../middleware/auth');

async function apiAuth(req, res, next) {
  try {
    const key = req.headers['x-api-key'] || req.query.api_key;
    if (!key) {
      return res.status(401).json({ error: 'API key required. Pass via X-API-Key header or api_key query parameter.' });
    }

    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    const apiKey = await db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(keyHash);
    if (!apiKey) {
      return res.status(401).json({ error: 'Invalid API key.' });
    }

    await db.prepare('UPDATE api_keys SET last_used = CURRENT_TIMESTAMP WHERE id = ?').run(apiKey.id);
    req.apiUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(apiKey.user_id);
    next();
  } catch (error) {
    next(error);
  }
}

router.post('/keys/generate', requireAuth, async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Key name required' });

    const rawKey = 'cf_' + crypto.randomBytes(32).toString('hex');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    await db.prepare('INSERT INTO api_keys (user_id, key_hash, name) VALUES (?, ?, ?)')
      .run(res.locals.currentUser.id, keyHash, name);

    res.json({
      key: rawKey,
      name,
      message: 'Save this key securely. It cannot be retrieved again.'
    });
  } catch (error) {
    next(error);
  }
});

router.get('/stats', apiAuth, async (req, res, next) => {
  try {
    res.json({
      total_users: (await db.prepare('SELECT COUNT(*)::int as c FROM users').get()).c,
      total_threads: (await db.prepare('SELECT COUNT(*)::int as c FROM threads').get()).c,
      total_posts: (await db.prepare('SELECT COUNT(*)::int as c FROM posts').get()).c,
      total_thanks: (await db.prepare('SELECT COUNT(*)::int as c FROM thanks').get()).c,
      total_categories: (await db.prepare('SELECT COUNT(*)::int as c FROM categories').get()).c,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/users', apiAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const total = (await db.prepare('SELECT COUNT(*)::int as c FROM users').get()).c;
    const users = await db.prepare(`
      SELECT id, username, avatar, bio, role, thanks_received, thanks_given,
        post_count, thread_count, created_at, last_active
      FROM users ORDER BY id LIMIT ? OFFSET ?
    `).all(limit, offset);

    res.json({
      data: users.map(u => ({ ...u, rank: getRank(u.thanks_received).title })),
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/categories', apiAuth, async (req, res, next) => {
  try {
    const categories = await db.prepare('SELECT * FROM categories ORDER BY display_order').all();
    res.json({ data: categories });
  } catch (error) {
    next(error);
  }
});

router.get('/threads', apiAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const category = req.query.category_id;

    let query = `
      SELECT t.*, u.username as author_name, c.name as category_name
      FROM threads t
      JOIN users u ON t.author_id = u.id
      JOIN categories c ON t.category_id = c.id
    `;
    const params = [];

    if (category) {
      query += ' WHERE t.category_id = ?';
      params.push(category);
    }

    const countQuery = category
      ? 'SELECT COUNT(*)::int as c FROM threads WHERE category_id = ?'
      : 'SELECT COUNT(*)::int as c FROM threads';
    const total = (await db.prepare(countQuery).get(...(category ? [category] : []))).c;

    query += ' ORDER BY t.last_post_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const threads = await db.prepare(query).all(...params);

    res.json({
      data: threads,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/threads/:id/posts', apiAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const thread = await db.prepare('SELECT * FROM threads WHERE id = ?').get(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });

    const total = (await db.prepare('SELECT COUNT(*)::int as c FROM posts WHERE thread_id = ?').get(thread.id)).c;
    const posts = await db.prepare(`
      SELECT p.*, u.username as author_name
      FROM posts p
      JOIN users u ON p.author_id = u.id
      WHERE p.thread_id = ?
      ORDER BY p.created_at ASC
      LIMIT ? OFFSET ?
    `).all(thread.id, limit, offset);

    res.json({
      thread,
      data: posts,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/posts', apiAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const total = (await db.prepare('SELECT COUNT(*)::int as c FROM posts').get()).c;
    const posts = await db.prepare(`
      SELECT p.*, u.username as author_name, t.title as thread_title
      FROM posts p
      JOIN users u ON p.author_id = u.id
      JOIN threads t ON p.thread_id = t.id
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    res.json({
      data: posts,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/conversations', apiAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const total = (await db.prepare('SELECT COUNT(*)::int as c FROM threads').get()).c;
    const threads = await db.prepare(`
      SELECT t.*, u.username as author_name, c.name as category_name
      FROM threads t
      JOIN users u ON t.author_id = u.id
      JOIN categories c ON t.category_id = c.id
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const conversations = [];
    for (const thread of threads) {
      const posts = await db.prepare(`
        SELECT p.content, u.username as author, p.thanks_count, p.created_at
        FROM posts p
        JOIN users u ON p.author_id = u.id
        WHERE p.thread_id = ?
        ORDER BY p.created_at ASC
      `).all(thread.id);

      conversations.push({
        id: thread.id,
        title: thread.title,
        category: thread.category_name,
        author: thread.author_name,
        is_solved: thread.is_solved,
        created_at: thread.created_at,
        posts
      });
    }

    res.json({
      data: conversations,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/export/dataset', apiAuth, async (req, res, next) => {
  try {
    const format = req.query.format || 'jsonl';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const minThanks = parseInt(req.query.min_thanks, 10) || 0;

    const threads = await db.prepare(`
      SELECT t.id, t.title, t.is_solved
      FROM threads t
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const dataset = [];
    for (const thread of threads) {
      const posts = await db.prepare(`
        SELECT p.content, u.username as author, p.thanks_count
        FROM posts p
        JOIN users u ON p.author_id = u.id
        WHERE p.thread_id = ?
        ORDER BY p.created_at ASC
      `).all(thread.id);

      if (posts.length < 2) continue;

      const question = posts[0];
      const replies = posts.slice(1).filter(p => p.thanks_count >= minThanks);
      if (replies.length === 0) continue;

      replies.sort((a, b) => b.thanks_count - a.thanks_count);
      const bestAnswer = replies[0];

      dataset.push({
        instruction: question.content,
        input: thread.title,
        output: bestAnswer.content,
        metadata: {
          thread_id: thread.id,
          is_solved: thread.is_solved,
          answer_thanks: bestAnswer.thanks_count,
          question_author: question.author,
          answer_author: bestAnswer.author
        }
      });
    }

    if (format === 'jsonl') {
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.send(dataset.map(d => JSON.stringify(d)).join('\n'));
    } else {
      res.json({ data: dataset, total: dataset.length });
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;
