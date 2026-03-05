const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { db } = require('../database');

// GET /auth/register
router.get('/register', (req, res) => {
  if (res.locals.currentUser) return res.redirect('/');
  res.render('auth/register', { title: 'Register', error: null });
});

// POST /auth/register
router.post('/register', async (req, res) => {
  const { username, email, password, confirm_password } = req.body;

  // Validation
  if (!username || !email || !password) {
    return res.render('auth/register', { title: 'Register', error: 'All fields are required.' });
  }
  if (username.length < 3 || username.length > 20) {
    return res.render('auth/register', { title: 'Register', error: 'Username must be 3-20 characters.' });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.render('auth/register', { title: 'Register', error: 'Username can only contain letters, numbers, and underscores.' });
  }
  if (password.length < 6) {
    return res.render('auth/register', { title: 'Register', error: 'Password must be at least 6 characters.' });
  }
  if (password !== confirm_password) {
    return res.render('auth/register', { title: 'Register', error: 'Passwords do not match.' });
  }

  // Check existing
  const existingUser = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
  if (existingUser) {
    return res.render('auth/register', { title: 'Register', error: 'Username or email already taken.' });
  }

  // Create user
  const passwordHash = await bcrypt.hash(password, 12);
  const result = db.prepare(
    'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)'
  ).run(username, email.toLowerCase(), passwordHash);

  // Check early member badge
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (userCount <= 10) {
    const badge = db.prepare('SELECT id FROM badges WHERE name = ?').get('Welcome Wagon');
    if (badge) {
      db.prepare('INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)').run(result.lastInsertRowid, badge.id);
    }
  }

  req.session.userId = result.lastInsertRowid;
  req.flash('success', 'Welcome to CommuniForums! Your account has been created.');
  res.redirect('/');
});

// GET /auth/login
router.get('/login', (req, res) => {
  if (res.locals.currentUser) return res.redirect('/');
  const banned = req.query.banned === '1';
  res.render('auth/login', {
    title: 'Login',
    error: banned ? 'Your account is currently suspended.' : null,
    redirect: res.locals.safeRedirect(req.query.redirect || '/')
  });
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { username, password, redirect } = req.body;

  if (!username || !password) {
    return res.render('auth/login', { title: 'Login', error: 'All fields are required.', redirect: res.locals.safeRedirect(redirect || '/') });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);
  if (!user) {
    return res.render('auth/login', { title: 'Login', error: 'Invalid username or password.', redirect: res.locals.safeRedirect(redirect || '/') });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.render('auth/login', { title: 'Login', error: 'Invalid username or password.', redirect: res.locals.safeRedirect(redirect || '/') });
  }

  // Check ban
  if (user.banned_until && new Date(user.banned_until) > new Date()) {
    return res.render('auth/login', {
      title: 'Login',
      error: `Account suspended until ${new Date(user.banned_until).toLocaleString()}. Reason: ${user.ban_reason || 'Community guideline violation'}`,
      redirect: res.locals.safeRedirect(redirect || '/')
    });
  }

  req.session.userId = user.id;
  req.flash('success', `Welcome back, ${user.username}!`);
  res.redirect(res.locals.safeRedirect(redirect || '/'));
});

// GET /auth/logout
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

module.exports = router;
