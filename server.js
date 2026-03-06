const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const path = require('path');
const { initialize, pool, hasDatabaseConfig, getEffectiveRank, isHighestRank, db } = require('./database');
const { escapeHtml, escapeAttr, escapeJs, safeRedirect } = require('./utils/security');
const { configureSecurity, authLimiter, writeLimiter } = require('./middleware/security');

async function start() {
  const app = express();
  const PORT = process.env.PORT || 3000;
  app.disable('x-powered-by');
  let dbReady = false;

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  // Ensure shared templates always have baseline locals, even on early errors.
  app.use((req, res, next) => {
    res.locals.currentUser = null;
    res.locals.unreadNotifications = 0;
    res.locals.unreadMessages = 0;
    res.locals.permissionLevel = 0;
    res.locals.capabilities = {};
    next();
  });

  app.get('/health', (req, res) => {
    res.status(200).json({ ok: true });
  });

  app.get('/healthz', (req, res) => {
    res.status(200).json({ ok: true });
  });

  app.get('/ready', async (req, res) => {
    res.status(dbReady ? 200 : 503).json({ ok: dbReady, db: dbReady });
  });

  configureSecurity(app);
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  const sessionOptions = {
    secret: process.env.SESSION_SECRET || 'communiforums-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    }
  };
  if (hasDatabaseConfig && pool) {
    sessionOptions.store = new PgSession({
      pool,
      tableName: 'user_sessions',
      createTableIfMissing: true
    });
  } else {
    console.warn('DATABASE_URL missing: using in-memory session store until configured.');
  }
  app.use(session(sessionOptions));

  app.use((req, res, next) => {
    res.locals.flash = req.session.flash || {};
    delete req.session.flash;
    next();
  });

  app.use((req, res, next) => {
    req.flash = (type, message) => {
      req.session.flash = { type, message };
    };
    next();
  });

  const { attachUser } = require('./middleware/auth');
  const { checkBanned } = require('./middleware/moderation');
  app.use(attachUser);
  app.use(checkBanned);

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

  app.use('/auth', authLimiter, require('./routes/auth'));
  app.use('/forums', require('./routes/forums'));
  app.use('/users', require('./routes/users'));
  app.use('/messages', writeLimiter, require('./routes/messages'));
  app.use('/notifications', require('./routes/notifications'));
  app.use('/admin', writeLimiter, require('./routes/admin'));
  app.use('/search', require('./routes/search'));
  app.use('/api/v1', writeLimiter, require('./routes/api'));

  app.get('/', async (req, res, next) => {
    try {
      const categories = await db.all(`
        SELECT c.*,
          (SELECT COUNT(*)::int FROM threads WHERE category_id = c.id) as thread_count,
          (SELECT COUNT(*)::int FROM posts p JOIN threads t ON p.thread_id = t.id WHERE t.category_id = c.id) as post_count
        FROM categories c WHERE c.parent_id IS NULL ORDER BY c.display_order
      `);

      for (const cat of categories) {
        cat.subcategories = await db.all(
          'SELECT * FROM categories WHERE parent_id = ? ORDER BY display_order',
          cat.id
        );
      }

      const stats = {
        totalUsers: (await db.get('SELECT COUNT(*)::int as c FROM users')).c,
        totalThreads: (await db.get('SELECT COUNT(*)::int as c FROM threads')).c,
        totalPosts: (await db.get('SELECT COUNT(*)::int as c FROM posts')).c,
        totalThanks: (await db.get('SELECT COUNT(*)::int as c FROM thanks')).c,
        newestUser: await db.get('SELECT username, id FROM users ORDER BY created_at DESC LIMIT 1'),
        recentThreads: await db.all(`
          SELECT t.*, u.username as author_name, c.name as category_name
          FROM threads t
          JOIN users u ON t.author_id = u.id
          JOIN categories c ON t.category_id = c.id
          ORDER BY t.last_post_at DESC LIMIT 5
        `),
        topContributors: await db.all(`
          SELECT id, username, thanks_received, avatar, rank_override_title, rank_override_color
          FROM users ORDER BY thanks_received DESC LIMIT 5
        `),
      };

      stats.topContributors = stats.topContributors.map(u => ({
        ...u,
        rank: getEffectiveRank(u)
      }));

      const communityMessages = [
        'Ask clear questions and share practical solutions.',
        'Use the search to build on previous discussions.',
        'Well-structured replies help everyone learn faster.',
        'Keep threads focused so answers stay useful over time.',
      ];
      const featuredMessage = communityMessages[Math.floor(Math.random() * communityMessages.length)];

      res.render('home', { categories, stats, featuredMessage });
    } catch (err) {
      // Keep homepage available for platform health checks during transient DB outages.
      res.render('home', {
        categories: [],
        stats: {
          totalUsers: 0,
          totalThreads: 0,
          totalPosts: 0,
          totalThanks: 0,
          newestUser: null,
          recentThreads: [],
          topContributors: []
        },
        featuredMessage: 'Service is warming up. Please refresh in a moment.'
      });
    }
  });

  app.use((req, res) => {
    res.status(404).render('error', {
      title: 'Page Not Found',
      message: 'The page you are looking for does not exist.'
    });
  });

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

  async function attemptInit() {
    if (!hasDatabaseConfig) {
      dbReady = false;
      return;
    }
    try {
      await initialize();
      dbReady = true;
      console.log('Database initialization successful.');
    } catch (err) {
      dbReady = false;
      console.error('Database initialization failed, retrying in 5s:', err.message);
      setTimeout(attemptInit, 5000);
    }
  }

  attemptInit();
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
