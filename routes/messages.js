const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { requireCapability } = require('../middleware/permissions');
const { blockBanned } = require('../middleware/moderation');
const { scanFields, warningMessage } = require('../utils/profanity');

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const tab = req.query.tab || 'inbox';
    let messages;

    if (tab === 'sent') {
      messages = await db.prepare(`
        SELECT pm.*, u.username as other_username, u.avatar as other_avatar
        FROM private_messages pm
        JOIN users u ON pm.receiver_id = u.id
        WHERE pm.sender_id = ? AND pm.sender_deleted = 0
        ORDER BY pm.created_at DESC
      `).all(res.locals.currentUser.id);
    } else {
      messages = await db.prepare(`
        SELECT pm.*, u.username as other_username, u.avatar as other_avatar
        FROM private_messages pm
        JOIN users u ON pm.sender_id = u.id
        WHERE pm.receiver_id = ? AND pm.receiver_deleted = 0
        ORDER BY pm.created_at DESC
      `).all(res.locals.currentUser.id);
    }

    res.render('messages/inbox', { title: 'Messages', messages, tab });
  } catch (error) {
    next(error);
  }
});

router.get('/new', requireAuth, blockBanned, requireCapability('canSendDirectMessage', {
  message: 'Direct messages unlock at Basic trust level.',
  redirectTo: '/messages'
}), (req, res) => {
  const to = req.query.to || '';
  res.render('messages/compose', { title: 'New Message', to, error: null });
});

router.post('/send', requireAuth, blockBanned, requireCapability('canSendDirectMessage', {
  message: 'Direct messages unlock at Basic trust level.',
  redirectTo: '/messages'
}), async (req, res, next) => {
  try {
    const { to, content } = req.body;

    if (!to || !content) {
      return res.render('messages/compose', {
        title: 'New Message', to, error: 'Recipient and message are required.'
      });
    }
    const msgScan = scanFields({ content });
    if (msgScan.flagged) {
      return res.render('messages/compose', {
        title: 'New Message', to, error: warningMessage(msgScan)
      });
    }

    const recipient = await db.prepare('SELECT id FROM users WHERE username = ?').get(to.trim());
    if (!recipient) {
      return res.render('messages/compose', {
        title: 'New Message', to, error: 'User not found.'
      });
    }
    if (recipient.id === res.locals.currentUser.id) {
      return res.render('messages/compose', {
        title: 'New Message', to, error: 'You cannot message yourself.'
      });
    }

    await db.prepare(
      'INSERT INTO private_messages (sender_id, receiver_id, subject, content) VALUES (?, ?, ?, ?)'
    ).run(res.locals.currentUser.id, recipient.id, '', content.trim());

    await db.prepare(
      'INSERT INTO notifications (user_id, type, reference_id, reference_type, message) VALUES (?, ?, ?, ?, ?)'
    ).run(recipient.id, 'pm', res.locals.currentUser.id, 'user',
      `New message from ${res.locals.currentUser.username}`);

    req.flash('success', 'Message sent!');
    res.redirect('/messages');
  } catch (error) {
    next(error);
  }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const message = await db.prepare(`
      SELECT pm.*, s.username as sender_name, s.avatar as sender_avatar,
        r.username as receiver_name, r.avatar as receiver_avatar
      FROM private_messages pm
      JOIN users s ON pm.sender_id = s.id
      JOIN users r ON pm.receiver_id = r.id
      WHERE pm.id = ? AND (pm.sender_id = ? OR pm.receiver_id = ?)
    `).get(req.params.id, res.locals.currentUser.id, res.locals.currentUser.id);

    if (!message) return res.status(404).render('error', { title: 'Not Found', message: 'Message not found.' });

    if (message.receiver_id === res.locals.currentUser.id && !message.is_read) {
      await db.prepare('UPDATE private_messages SET is_read = 1 WHERE id = ?').run(message.id);
    }

    res.render('messages/conversation', { title: 'Message', message });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/delete', requireAuth, async (req, res, next) => {
  try {
    const message = await db.prepare('SELECT * FROM private_messages WHERE id = ?').get(req.params.id);
    if (!message) return res.status(404).json({ error: 'Not found' });

    if (message.sender_id === res.locals.currentUser.id) {
      await db.prepare('UPDATE private_messages SET sender_deleted = 1 WHERE id = ?').run(message.id);
    } else if (message.receiver_id === res.locals.currentUser.id) {
      await db.prepare('UPDATE private_messages SET receiver_deleted = 1 WHERE id = ?').run(message.id);
    }

    req.flash('success', 'Message deleted.');
    res.redirect('/messages');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
