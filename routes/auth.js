const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const router = express.Router();
const { db } = require('../database');
const { scanFields, warningMessage } = require('../utils/profanity');
const { verifyTotpCode, hashBackupCode } = require('../utils/mfa');
const { refreshTrustForUser } = require('../utils/trust');
const { validateStrongPassword } = require('../utils/security');

function parseBackupCodes(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

async function recordSecurityEvent(req, eventType, userId = null, metadata = '') {
  try {
    const ip = req.ip || req.socket?.remoteAddress || null;
    const userAgent = req.get('user-agent') || null;
    await db.prepare(
      'INSERT INTO user_security_events (user_id, event_type, ip, user_agent, metadata) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, eventType, ip, userAgent, metadata || null);
  } catch (err) {
    // Avoid blocking auth flow on logging issues.
  }
}

async function regenerateSession(req) {
  await new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

async function completeLogin(req, user, redirectPath) {
  await regenerateSession(req);
  req.session.userId = user.id;
  await db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);
  await refreshTrustForUser(user.id);
  req.flash('success', `Welcome back, ${user.username}!`);
  return redirectPath;
}

function normalizeGuestUsername(input) {
  const cleaned = String(input || '')
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_');
  return cleaned.slice(0, 20);
}

async function getUniqueGuestUsername(baseName) {
  const base = normalizeGuestUsername(baseName);
  const fallback = `Guest_${Math.floor(1000 + Math.random() * 9000)}`;
  const seed = base && base.length >= 3 ? base : fallback;
  let candidate = seed;
  let attempts = 0;

  while (attempts < 20) {
    const existing = await db.prepare('SELECT id FROM users WHERE username = ?').get(candidate);
    if (!existing) return candidate;
    attempts += 1;
    const suffix = String(Math.floor(100 + Math.random() * 900));
    candidate = `${seed.slice(0, Math.max(0, 20 - suffix.length - 1))}_${suffix}`;
  }

  return `Guest_${Date.now().toString().slice(-6)}`;
}

router.get('/register', (req, res) => {
  if (res.locals.currentUser && !res.locals.currentUser.guest_account) return res.redirect('/');
  res.render('auth/register', { title: 'Register', error: null });
});

router.post('/register', async (req, res, next) => {
  try {
    const guestUser = res.locals.currentUser && res.locals.currentUser.guest_account ? res.locals.currentUser : null;
    const { username, email, password, confirm_password } = req.body;

    if (!username || !email || !password) {
      return res.render('auth/register', { title: 'Register', error: 'All fields are required.' });
    }
    if (username.length < 3 || username.length > 20) {
      return res.render('auth/register', { title: 'Register', error: 'Username must be 3-20 characters.' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.render('auth/register', { title: 'Register', error: 'Username can only contain letters, numbers, and underscores.' });
    }
    const usernameScan = scanFields({ username });
    if (usernameScan.flagged) {
      return res.render('auth/register', { title: 'Register', error: warningMessage(usernameScan) });
    }
    const passwordError = validateStrongPassword(password);
    if (passwordError) {
      return res.render('auth/register', { title: 'Register', error: passwordError });
    }
    if (password !== confirm_password) {
      return res.render('auth/register', { title: 'Register', error: 'Passwords do not match.' });
    }

    const existingUser = await db.prepare('SELECT id FROM users WHERE (username = ? OR email = ?) AND id <> COALESCE(?, -1)')
      .get(username, email.toLowerCase(), guestUser ? guestUser.id : null);
    if (existingUser) {
      return res.render('auth/register', { title: 'Register', error: 'Username or email already taken.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    let userId;
    if (guestUser) {
      await db.prepare(
        'UPDATE users SET username = ?, email = ?, password_hash = ?, guest_account = false WHERE id = ?'
      ).run(username, email.toLowerCase(), passwordHash, guestUser.id);
      userId = guestUser.id;
      await recordSecurityEvent(req, 'guest_upgraded', userId);
    } else {
      const result = await db.prepare(
        'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)'
      ).run(username, email.toLowerCase(), passwordHash);
      userId = result.lastInsertRowid;
    }
    await refreshTrustForUser(userId);

    const userCount = (await db.prepare('SELECT COUNT(*)::int as c FROM users WHERE guest_account = false').get()).c;
    if (!guestUser && userCount <= 10) {
      const badge = await db.prepare('SELECT id FROM badges WHERE name = ?').get('Welcome Wagon');
      if (badge) {
        await db.prepare('INSERT INTO user_badges (user_id, badge_id) VALUES (?, ?) ON CONFLICT (user_id, badge_id) DO NOTHING')
          .run(userId, badge.id);
      }
    }

    if (!guestUser) {
      await regenerateSession(req);
      req.session.userId = userId;
      await recordSecurityEvent(req, 'register_success', userId);
      req.flash('success', 'Welcome to CommuniForums! Your account has been created.');
    } else {
      req.flash('success', 'Guest account upgraded. Your posts and threads were kept.');
    }
    res.redirect('/');
  } catch (error) {
    next(error);
  }
});

router.get('/login', (req, res) => {
  if (res.locals.currentUser) return res.redirect('/');
  const banned = req.query.banned === '1';
  const locked = req.query.locked === '1';
  res.render('auth/login', {
    title: 'Login',
    error: banned ? 'Your account is currently suspended.' : locked ? 'Too many failed logins. Your account is temporarily locked.' : null,
    redirect: res.locals.safeRedirect(req.query.redirect || '/')
  });
});

router.post('/login', async (req, res, next) => {
  try {
    const { username, password, redirect } = req.body;

    if (!username || !password) {
      return res.render('auth/login', { title: 'Login', error: 'All fields are required.', redirect: res.locals.safeRedirect(redirect || '/') });
    }

    const user = await db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username.toLowerCase());
    if (!user) {
      await recordSecurityEvent(req, 'login_failed_unknown', null, username);
      return res.render('auth/login', { title: 'Login', error: 'Invalid username or password.', redirect: res.locals.safeRedirect(redirect || '/') });
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      await recordSecurityEvent(req, 'login_blocked_locked', user.id);
      return res.render('auth/login', {
        title: 'Login',
        error: `Account temporarily locked until ${new Date(user.locked_until).toLocaleString()}.`,
        redirect: res.locals.safeRedirect(redirect || '/')
      });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      const attempts = (user.failed_login_attempts || 0) + 1;
      let lockUntil = null;
      if (attempts >= 5) {
        lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      }
      await db.prepare(
        'UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?'
      ).run(attempts, lockUntil, user.id);
      await recordSecurityEvent(req, 'login_failed_password', user.id, `attempts=${attempts}`);
      return res.render('auth/login', { title: 'Login', error: 'Invalid username or password.', redirect: res.locals.safeRedirect(redirect || '/') });
    }

    if (user.banned_until && new Date(user.banned_until) > new Date()) {
      return res.render('auth/login', {
        title: 'Login',
        error: `Account suspended until ${new Date(user.banned_until).toLocaleString()}. Reason: ${user.ban_reason || 'Community guideline violation'}`,
        redirect: res.locals.safeRedirect(redirect || '/')
      });
    }

    if (user.mfa_enabled && user.mfa_secret) {
      req.session.pendingMfaUserId = user.id;
      req.session.pendingMfaRedirect = res.locals.safeRedirect(redirect || '/');
      await recordSecurityEvent(req, 'mfa_challenge_started', user.id);
      return res.redirect('/auth/mfa');
    }

    const destination = await completeLogin(req, user, res.locals.safeRedirect(redirect || '/'));
    await recordSecurityEvent(req, 'login_success', user.id);
    return res.redirect(destination);
  } catch (error) {
    next(error);
  }
});

router.post('/guest', async (req, res, next) => {
  try {
    if (res.locals.currentUser) return res.redirect('/');
    const redirect = res.locals.safeRedirect(req.body.redirect || '/');

    const guestNameInput = req.body.guest_name || req.body.username || '';
    const guestNameScan = scanFields({ username: guestNameInput });
    if (guestNameScan.flagged) {
      return res.render('auth/login', {
        title: 'Login',
        error: warningMessage(guestNameScan),
        redirect
      });
    }

    const username = await getUniqueGuestUsername(guestNameInput);
    if (username.length < 3) {
      return res.render('auth/login', {
        title: 'Login',
        error: 'Guest name must be at least 3 characters.',
        redirect
      });
    }

    const nonce = crypto.randomBytes(6).toString('hex');
    const email = `guest_${Date.now()}_${nonce}@guest.local`;
    const passwordHash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 8);
    const result = await db.prepare(
      'INSERT INTO users (username, email, password_hash, guest_account) VALUES (?, ?, ?, true)'
    ).run(username, email, passwordHash);

    await regenerateSession(req);
    req.session.userId = result.lastInsertRowid;
    await recordSecurityEvent(req, 'guest_login', result.lastInsertRowid);
    return res.redirect(redirect);
  } catch (error) {
    next(error);
  }
});

router.get('/mfa', async (req, res, next) => {
  try {
    if (res.locals.currentUser) return res.redirect('/');
    if (!req.session.pendingMfaUserId) return res.redirect('/auth/login');

    const user = await db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.session.pendingMfaUserId);
    if (!user) {
      delete req.session.pendingMfaUserId;
      delete req.session.pendingMfaRedirect;
      return res.redirect('/auth/login');
    }

    return res.render('auth/mfa', {
      title: 'Two-Factor Authentication',
      error: null,
      username: user.username
    });
  } catch (error) {
    next(error);
  }
});

router.post('/mfa', async (req, res, next) => {
  try {
    if (!req.session.pendingMfaUserId) return res.redirect('/auth/login');
    const token = (req.body.token || '').trim();
    const user = await db.prepare('SELECT id, username, mfa_secret, mfa_backup_codes FROM users WHERE id = ?').get(req.session.pendingMfaUserId);
    if (!user || !user.mfa_secret) return res.redirect('/auth/login');

    let verified = verifyTotpCode(token, user.mfa_secret);
    let usedBackup = false;
    if (!verified) {
      const hashes = parseBackupCodes(user.mfa_backup_codes);
      const submittedHash = hashBackupCode(token);
      const idx = hashes.indexOf(submittedHash);
      if (idx !== -1) {
        hashes.splice(idx, 1);
        await db.prepare('UPDATE users SET mfa_backup_codes = ? WHERE id = ?').run(JSON.stringify(hashes), user.id);
        verified = true;
        usedBackup = true;
      }
    }

    if (!verified) {
      await recordSecurityEvent(req, 'mfa_failed', user.id);
      return res.render('auth/mfa', {
        title: 'Two-Factor Authentication',
        error: 'Invalid authentication code.',
        username: user.username
      });
    }

    const redirectPath = res.locals.safeRedirect(req.session.pendingMfaRedirect || '/');
    delete req.session.pendingMfaUserId;
    delete req.session.pendingMfaRedirect;

    const destination = await completeLogin(req, user, redirectPath);
    await recordSecurityEvent(req, usedBackup ? 'mfa_success_backup' : 'mfa_success_totp', user.id);
    return res.redirect(destination);
  } catch (error) {
    next(error);
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

module.exports = router;
