const { db, isHighestRank } = require('../database');
const { refreshTrustForUser, getCapabilities } = require('../utils/trust');

async function attachUser(req, res, next) {
  try {
    if (req.session && req.session.userId) {
      const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
      if (user) {
        if (user.locked_until && new Date(user.locked_until) > new Date()) {
          req.session.destroy();
          return res.redirect('/auth/login?locked=1');
        }
        if (user.banned_until && new Date(user.banned_until) > new Date()) {
          req.session.destroy();
          return res.redirect('/auth/login?banned=1');
        }

        const trust = await refreshTrustForUser(user.id);
        if (trust) {
          user.trust_score = trust.trust_score;
          user.trust_level = trust.trust_level;
        }

        await db.prepare('UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
        const notifCount = await db.prepare(
          'SELECT COUNT(*)::int as count FROM notifications WHERE user_id = ? AND is_read = 0'
        ).get(user.id);
        const pmCount = await db.prepare(
          'SELECT COUNT(*)::int as count FROM private_messages WHERE receiver_id = ? AND is_read = 0 AND receiver_deleted = 0'
        ).get(user.id);

        res.locals.currentUser = user;
        res.locals.unreadNotifications = notifCount.count;
        res.locals.unreadMessages = pmCount.count;
        res.locals.capabilities = getCapabilities(user);
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
    res.locals.capabilities = res.locals.capabilities || {};
    res.locals.permissionLevel = res.locals.permissionLevel || 0;
    next();
  } catch (error) {
    next(error);
  }
}

function requireAuth(req, res, next) {
  if (!res.locals.currentUser) {
    return res.redirect('/auth/login?redirect=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

function requireMod(req, res, next) {
  if (!res.locals.currentUser || !['moderator', 'admin'].includes(res.locals.currentUser.role)) {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: 'You do not have permission to access this page.'
    });
  }
  next();
}

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
