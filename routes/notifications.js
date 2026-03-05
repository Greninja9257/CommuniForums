const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');

// GET /notifications
router.get('/', requireAuth, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const perPage = 20;
  const offset = (page - 1) * perPage;

  const total = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ?')
    .get(res.locals.currentUser.id).c;
  const totalPages = Math.ceil(total / perPage);

  const notifications = db.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(res.locals.currentUser.id, perPage, offset);

  res.render('notifications', { title: 'Notifications', notifications, page, totalPages });
});

// POST /notifications/read/:id
router.post('/read/:id', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?')
    .run(req.params.id, res.locals.currentUser.id);
  res.json({ success: true });
});

// POST /notifications/read-all
router.post('/read-all', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?')
    .run(res.locals.currentUser.id);
  res.redirect('/notifications');
});

// GET /notifications/count (JSON for AJAX)
router.get('/count', requireAuth, (req, res) => {
  const count = db.prepare(
    'SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0'
  ).get(res.locals.currentUser.id).c;
  res.json({ count });
});

module.exports = router;
