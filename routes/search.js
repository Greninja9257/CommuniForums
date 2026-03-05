const express = require('express');
const router = express.Router();
const { db, getRank, getEffectiveRank } = require('../database');

// GET /search
router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  const type = req.query.type || 'all'; // all, threads, posts, users
  const category = req.query.category || '';
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const perPage = 20;
  const offset = (page - 1) * perPage;

  let threads = [];
  let posts = [];
  let users = [];
  let totalResults = 0;

  if (q.length >= 2) {
    const searchTerm = `%${q}%`;

    if (type === 'all' || type === 'threads') {
      threads = db.prepare(`
        SELECT t.*, u.username as author_name, c.name as category_name
        FROM threads t
        JOIN users u ON t.author_id = u.id
        JOIN categories c ON t.category_id = c.id
        WHERE t.title LIKE ?
        ${category ? 'AND t.category_id = ?' : ''}
        ORDER BY t.last_post_at DESC
        LIMIT ? OFFSET ?
      `).all(...(category ? [searchTerm, category, perPage, offset] : [searchTerm, perPage, offset]));
      totalResults += threads.length;
    }

    if (type === 'all' || type === 'posts') {
      posts = db.prepare(`
        SELECT p.*, u.username as author_name, t.title as thread_title, t.id as thread_id
        FROM posts p
        JOIN users u ON p.author_id = u.id
        JOIN threads t ON p.thread_id = t.id
        WHERE p.content LIKE ?
        ORDER BY p.created_at DESC
        LIMIT ? OFFSET ?
      `).all(searchTerm, perPage, offset);
      totalResults += posts.length;
    }

    if (type === 'all' || type === 'users') {
      users = db.prepare(`
        SELECT id, username, avatar, role, thanks_received, post_count, created_at,
          rank_override_title, rank_override_color
        FROM users WHERE username LIKE ? OR bio LIKE ?
        ORDER BY thanks_received DESC
        LIMIT ? OFFSET ?
      `).all(searchTerm, searchTerm, perPage, offset);
      users = users.map(u => ({ ...u, rank: getEffectiveRank(u) }));
      totalResults += users.length;
    }
  }

  const categories = db.prepare('SELECT id, name FROM categories ORDER BY name').all();

  res.render('search', {
    title: q ? `Search: ${q}` : 'Search',
    q,
    type,
    category,
    threads,
    posts,
    users,
    totalResults,
    categories,
    page
  });
});

module.exports = router;
