const { db } = require('../database');

async function checkAutoBan(userId) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentThumbsDown = await db.prepare(
    'SELECT COUNT(*)::int as count FROM thumbs_down WHERE receiver_id = ? AND created_at > ?'
  ).get(userId, sevenDaysAgo);

  if (recentThumbsDown.count >= 10) {
    const user = await db.prepare('SELECT ban_count FROM users WHERE id = ?').get(userId);
    if (!user) return { banned: false };

    const banDurations = [1, 3, 7, 30];
    const banIndex = Math.min(user.ban_count, banDurations.length - 1);
    const banDays = banDurations[banIndex];
    const banUntil = new Date(Date.now() + banDays * 24 * 60 * 60 * 1000).toISOString();

    await db.prepare(
      'UPDATE users SET banned_until = ?, ban_reason = ?, ban_count = ban_count + 1 WHERE id = ?'
    ).run(banUntil, `Auto-banned: Received ${recentThumbsDown.count} thumbs down in 7 days`, userId);

    await db.prepare(
      'INSERT INTO mod_actions (mod_id, target_user_id, action_type, reason, duration) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, userId, 'auto_ban', 'Excessive thumbs down', banDays);

    await db.prepare(
      'INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)'
    ).run(userId, 'moderation', `You have been temporarily banned for ${banDays} day(s) due to receiving excessive negative feedback. Please review our community guidelines.`);

    return { banned: true, days: banDays };
  }
  return { banned: false };
}

function checkBanned(req, res, next) {
  if (res.locals.currentUser && res.locals.currentUser.banned_until) {
    const banEnd = new Date(res.locals.currentUser.banned_until);
    if (banEnd > new Date()) {
      res.locals.isBanned = true;
      res.locals.banEnd = banEnd;
    }
  }
  res.locals.isBanned = res.locals.isBanned || false;
  next();
}

function blockBanned(req, res, next) {
  if (res.locals.isBanned) {
    return res.status(403).render('error', {
      title: 'Account Suspended',
      message: `Your account is temporarily suspended until ${res.locals.banEnd.toLocaleString()}. Reason: ${res.locals.currentUser.ban_reason || 'Community guideline violation'}`
    });
  }
  next();
}

module.exports = { checkAutoBan, checkBanned, blockBanned };
