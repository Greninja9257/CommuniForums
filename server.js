const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const { initialize, getEffectiveRank, isHighestRank } = require('./database');
const { escapeHtml, escapeAttr, escapeJs, safeRedirect } = require('./utils/security');

// Initialize database
initialize();

const app = express();
const PORT = process.env.PORT || 3000;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Sessions
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: __dirname }),
  secret: process.env.SESSION_SECRET || 'communiforums-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true
  }
}));

// Flash messages via session
app.use((req, res, next) => {
  res.locals.flash = req.session.flash || {};
  delete req.session.flash;
  next();
});

// Helper to set flash messages
app.use((req, res, next) => {
  req.flash = (type, message) => {
    req.session.flash = { type, message };
  };
  next();
});

// Middleware
const { attachUser } = require('./middleware/auth');
const { checkBanned } = require('./middleware/moderation');
app.use(attachUser);
app.use(checkBanned);

// Global template helpers
app.use((req, res, next) => {
  res.locals.formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  res.locals.truncate = (str, len) => {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '...' : str;
  };
  res.locals.getEffectiveRank = getEffectiveRank;
  res.locals.isHighestRank = isHighestRank;
  res.locals.escapeHtml = escapeHtml;
  res.locals.escapeAttr = escapeAttr;
  res.locals.escapeJs = escapeJs;
  res.locals.safeRedirect = safeRedirect;
  next();
});

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/forums', require('./routes/forums'));
app.use('/users', require('./routes/users'));
app.use('/messages', require('./routes/messages'));
app.use('/notifications', require('./routes/notifications'));
app.use('/admin', require('./routes/admin'));
app.use('/search', require('./routes/search'));
app.use('/api/v1', require('./routes/api'));

// Home page
const { db, getRank } = require('./database');
app.get('/', (req, res) => {
  const categories = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM threads WHERE category_id = c.id) as thread_count,
      (SELECT COUNT(*) FROM posts p JOIN threads t ON p.thread_id = t.id WHERE t.category_id = c.id) as post_count
    FROM categories c WHERE c.parent_id IS NULL ORDER BY c.display_order
  `).all();

  // Get subcategories
  for (const cat of categories) {
    cat.subcategories = db.prepare(
      'SELECT * FROM categories WHERE parent_id = ? ORDER BY display_order'
    ).all(cat.id);
  }

  const stats = {
    totalUsers: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    totalThreads: db.prepare('SELECT COUNT(*) as c FROM threads').get().c,
    totalPosts: db.prepare('SELECT COUNT(*) as c FROM posts').get().c,
    totalThanks: db.prepare('SELECT COUNT(*) as c FROM thanks').get().c,
    newestUser: db.prepare('SELECT username, id FROM users ORDER BY created_at DESC LIMIT 1').get(),
    recentThreads: db.prepare(`
      SELECT t.*, u.username as author_name, c.name as category_name
      FROM threads t
      JOIN users u ON t.author_id = u.id
      JOIN categories c ON t.category_id = c.id
      ORDER BY t.last_post_at DESC LIMIT 5
    `).all(),
    topContributors: db.prepare(`
      SELECT id, username, thanks_received, avatar, rank_override_title, rank_override_color
      FROM users ORDER BY thanks_received DESC LIMIT 5
    `).all(),
  };

  // Attach ranks
  stats.topContributors = stats.topContributors.map(u => ({
    ...u,
    rank: getEffectiveRank(u)
  }));

  const positivityMessages = [
    "Every post you make helps someone learn something new!",
    "Kindness is contagious - spread it around!",
    "The best communities are built on mutual respect.",
    "Your knowledge could be exactly what someone needs today.",
    "A simple 'thanks' can make someone's day!",
    "Together we grow, together we learn.",
    "Be the reason someone smiles today!",
  ];
  const randomMessage = positivityMessages[Math.floor(Math.random() * positivityMessages.length)];

  res.render('home', { categories, stats, positivityMessage: randomMessage, getRank });
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Page Not Found',
    message: 'The page you are looking for does not exist.'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', {
    title: 'Server Error',
    message: 'Something went wrong. Please try again later.'
  });
});

app.listen(PORT, () => {
  console.log(`CommuniForums running at http://localhost:${PORT}`);
});
