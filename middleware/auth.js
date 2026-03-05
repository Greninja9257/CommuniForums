const { db, isHighestRank } = require('../database');

// Attach user to all requests if logged in
function attachUser(req, res, next) {
  if (req.session && req.session.userId) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (user) {
      // Check if banned
      if (user.banned_until && new Date(user.banned_until) > new Date()) {
        req.session.destroy();
        return res.redirect('/auth/login?banned=1');
      }
      // Update last active
      db.prepare('UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
      // Get unread notification count
      const notifCount = db.prepare(
        'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0'
      ).get(user.id);
      const pmCount = db.prepare(
        'SELECT COUNT(*) as count FROM private_messages WHERE receiver_id = ? AND is_read = 0 AND receiver_deleted = 0'
      ).get(user.id);
      res.locals.currentUser = user;
      res.locals.unreadNotifications = notifCount.count;
      res.locals.unreadMessages = pmCount.count;
      const roleLevel = user.role === 'admin' ? 3 : user.role === 'moderator' ? 2 : 1;
      const rankLevel = isHighestRank(user) ? 4 : 0;
      res.locals.permissionLevel = Math.max(roleLevel, rankLevel);
    } else {
      req.session.destroy();
    }
  }
  res.locals.currentUser = res.locals.currentUser || null;
  res.locals.unreadNotifications = res.locals.unreadNotifications || 0;
  res.locals.unreadMessages = res.locals.unreadMessages || 0;
  res.locals.permissionLevel = res.locals.permissionLevel || 0;
  next();
}

// Require login
function requireAuth(req, res, next) {
  if (!res.locals.currentUser) {
    return res.redirect('/auth/login?redirect=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

// Require moderator or admin
function requireMod(req, res, next) {
  if (!res.locals.currentUser || !['moderator', 'admin'].includes(res.locals.currentUser.role)) {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: 'You do not have permission to access this page.'
    });
  }
  next();
}

// Require admin
function requireAdmin(req, res, next) {
  if (!res.locals.currentUser || res.locals.currentUser.role !== 'admin') {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: 'Admin access required.'
    });
  }
  next();
}

module.exports = { attachUser, requireAuth, requireMod, requireAdmin };
