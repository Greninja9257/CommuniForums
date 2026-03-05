const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { db, getRank } = require('../database');
const { requireAuth } = require('../middleware/auth');

// API key auth middleware
function apiAuth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!key) {
    return res.status(401).json({ error: 'API key required. Pass via X-API-Key header or api_key query parameter.' });
  }

  const keyHash = crypto.createHash('sha256').update(key).digest('hex');
  const apiKey = db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(keyHash);
  if (!apiKey) {
    return res.status(401).json({ error: 'Invalid API key.' });
  }

  // Update last used
  db.prepare('UPDATE api_keys SET last_used = CURRENT_TIMESTAMP WHERE id = ?').run(apiKey.id);
  req.apiUser = db.prepare('SELECT * FROM users WHERE id = ?').get(apiKey.user_id);
  next();
}

// Generate API key (requires login via web)
router.post('/keys/generate', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Key name required' });

  const rawKey = 'cf_' + crypto.randomBytes(32).toString('hex');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  db.prepare('INSERT INTO api_keys (user_id, key_hash, name) VALUES (?, ?, ?)')
    .run(res.locals.currentUser.id, keyHash, name);

  res.json({
    key: rawKey,
    name,
    message: 'Save this key securely. It cannot be retrieved again.'
  });
});

// GET /api/v1/stats
router.get('/stats', apiAuth, (req, res) => {
  res.json({
    total_users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    total_threads: db.prepare('SELECT COUNT(*) as c FROM threads').get().c,
    total_posts: db.prepare('SELECT COUNT(*) as c FROM posts').get().c,
    total_thanks: db.prepare('SELECT COUNT(*) as c FROM thanks').get().c,
    total_categories: db.prepare('SELECT COUNT(*) as c FROM categories').get().c,
  });
});

// GET /api/v1/users
router.get('/users', apiAuth, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  const total = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const users = db.prepare(`
    SELECT id, username, avatar, bio, role, thanks_received, thanks_given,
      post_count, thread_count, created_at, last_active
    FROM users ORDER BY id LIMIT ? OFFSET ?
  `).all(limit, offset);

  res.json({
    data: users.map(u => ({ ...u, rank: getRank(u.thanks_received).title })),
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
  });
});

// GET /api/v1/categories
router.get('/categories', apiAuth, (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY display_order').all();
  res.json({ data: categories });
});

// GET /api/v1/threads
router.get('/threads', apiAuth, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
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
    ? 'SELECT COUNT(*) as c FROM threads WHERE category_id = ?'
    : 'SELECT COUNT(*) as c FROM threads';
  const total = db.prepare(countQuery).get(...(category ? [category] : [])).c;

  query += ' ORDER BY t.last_post_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const threads = db.prepare(query).all(...params);

  res.json({
    data: threads,
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
  });
});

// GET /api/v1/threads/:id/posts
router.get('/threads/:id/posts', apiAuth, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(req.params.id);
  if (!thread) return res.status(404).json({ error: 'Thread not found' });

  const total = db.prepare('SELECT COUNT(*) as c FROM posts WHERE thread_id = ?').get(thread.id).c;
  const posts = db.prepare(`
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
});

// GET /api/v1/posts
router.get('/posts', apiAuth, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  const total = db.prepare('SELECT COUNT(*) as c FROM posts').get().c;
  const posts = db.prepare(`
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
});

// GET /api/v1/conversations - Full threads with all posts (for AI training)
router.get('/conversations', apiAuth, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const total = db.prepare('SELECT COUNT(*) as c FROM threads').get().c;
  const threads = db.prepare(`
    SELECT t.*, u.username as author_name, c.name as category_name
    FROM threads t
    JOIN users u ON t.author_id = u.id
    JOIN categories c ON t.category_id = c.id
    ORDER BY t.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  const conversations = threads.map(thread => {
    const posts = db.prepare(`
      SELECT p.content, u.username as author, p.thanks_count, p.created_at
      FROM posts p
      JOIN users u ON p.author_id = u.id
      WHERE p.thread_id = ?
      ORDER BY p.created_at ASC
    `).all(thread.id);

    return {
      id: thread.id,
      title: thread.title,
      category: thread.category_name,
      author: thread.author_name,
      is_solved: thread.is_solved,
      created_at: thread.created_at,
      posts
    };
  });

  res.json({
    data: conversations,
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
  });
});

// GET /api/v1/export/dataset - Formatted for AI training
router.get('/export/dataset', apiAuth, (req, res) => {
  const format = req.query.format || 'jsonl'; // jsonl or json
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const minThanks = parseInt(req.query.min_thanks) || 0;

  // Get threads where the OP asks a question and there are helpful replies
  const threads = db.prepare(`
    SELECT t.id, t.title, t.is_solved
    FROM threads t
    ORDER BY t.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  const dataset = [];
  for (const thread of threads) {
    const posts = db.prepare(`
      SELECT p.content, u.username as author, p.thanks_count
      FROM posts p
      JOIN users u ON p.author_id = u.id
      WHERE p.thread_id = ?
      ORDER BY p.created_at ASC
    `).all(thread.id);

    if (posts.length < 2) continue;

    const question = posts[0];
    // Get best answer (most thanked reply)
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
});

module.exports = router;
