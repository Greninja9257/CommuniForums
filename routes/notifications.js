const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = 20;
    const offset = (page - 1) * perPage;

    const total = (await db.prepare('SELECT COUNT(*)::int as c FROM notifications WHERE user_id = ?')
      .get(res.locals.currentUser.id)).c;
    const totalPages = Math.ceil(total / perPage);

    const notifications = await db.prepare(`
      SELECT * FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(res.locals.currentUser.id, perPage, offset);

    res.render('notifications', { title: 'Notifications', notifications, page, totalPages });
  } catch (error) {
    next(error);
  }
});

router.post('/read/:id', requireAuth, async (req, res, next) => {
  try {
    await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?')
      .run(req.params.id, res.locals.currentUser.id);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post('/read-all', requireAuth, async (req, res, next) => {
  try {
    await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?')
      .run(res.locals.currentUser.id);
    res.redirect('/notifications');
  } catch (error) {
    next(error);
  }
});

router.get('/count', requireAuth, async (req, res, next) => {
  try {
    const count = (await db.prepare(
      'SELECT COUNT(*)::int as c FROM notifications WHERE user_id = ? AND is_read = 0'
    ).get(res.locals.currentUser.id)).c;
    res.json({ count });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
