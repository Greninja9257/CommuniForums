const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'communiforums.db'));

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initialize() {
  db.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      avatar TEXT DEFAULT '/css/default-avatar.svg',
      bio TEXT DEFAULT '',
      role TEXT DEFAULT 'user' CHECK(role IN ('user', 'moderator', 'admin')),
      thanks_received INTEGER DEFAULT 0,
      thanks_given INTEGER DEFAULT 0,
      post_count INTEGER DEFAULT 0,
      thread_count INTEGER DEFAULT 0,
      banned_until DATETIME NULL,
      ban_reason TEXT NULL,
      ban_count INTEGER DEFAULT 0,
      last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      rank_override_title TEXT NULL,
      rank_override_color TEXT NULL,
      rank_override_reason TEXT NULL,
      rank_override_by INTEGER NULL REFERENCES users(id),
      rank_override_at DATETIME NULL
    );

    -- Categories
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      icon TEXT DEFAULT '💬',
      display_order INTEGER DEFAULT 0,
      parent_id INTEGER NULL REFERENCES categories(id) ON DELETE SET NULL,
      thread_count INTEGER DEFAULT 0,
      post_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Threads
    CREATE TABLE IF NOT EXISTS threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_pinned INTEGER DEFAULT 0,
      is_locked INTEGER DEFAULT 0,
      is_solved INTEGER DEFAULT 0,
      view_count INTEGER DEFAULT 0,
      reply_count INTEGER DEFAULT 0,
      last_post_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_post_by INTEGER NULL REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Posts
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      is_edited INTEGER DEFAULT 0,
      thanks_count INTEGER DEFAULT 0,
      thumbs_down_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Thanks
    CREATE TABLE IF NOT EXISTS thanks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      giver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(post_id, giver_id)
    );

    -- Thumbs down
    CREATE TABLE IF NOT EXISTS thumbs_down (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      giver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(post_id, giver_id)
    );

    -- Badges
    CREATE TABLE IF NOT EXISTS badges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT NOT NULL,
      icon TEXT NOT NULL,
      criteria_type TEXT NOT NULL,
      criteria_value INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- User badges
    CREATE TABLE IF NOT EXISTS user_badges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      badge_id INTEGER NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
      awarded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, badge_id)
    );

    -- Mentions
    CREATE TABLE IF NOT EXISTS mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      mentioner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mentioned_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Private messages
    CREATE TABLE IF NOT EXISTS private_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      content TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      sender_deleted INTEGER DEFAULT 0,
      receiver_deleted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Notifications
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      reference_id INTEGER NULL,
      reference_type TEXT NULL,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Reports
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
      resolved_by INTEGER NULL REFERENCES users(id),
      resolution_note TEXT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME NULL
    );

    -- Moderation actions log
    CREATE TABLE IF NOT EXISTS mod_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mod_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      target_post_id INTEGER NULL REFERENCES posts(id) ON DELETE SET NULL,
      action_type TEXT NOT NULL,
      reason TEXT,
      duration INTEGER NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- API keys
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key_hash TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      last_used DATETIME NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_threads_category ON threads(category_id);
    CREATE INDEX IF NOT EXISTS idx_threads_author ON threads(author_id);
    CREATE INDEX IF NOT EXISTS idx_threads_last_post ON threads(last_post_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_thread ON posts(thread_id);
    CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
    CREATE INDEX IF NOT EXISTS idx_thanks_post ON thanks(post_id);
    CREATE INDEX IF NOT EXISTS idx_thanks_receiver ON thanks(receiver_id);
    CREATE INDEX IF NOT EXISTS idx_thumbs_down_receiver ON thumbs_down(receiver_id);
    CREATE INDEX IF NOT EXISTS idx_thumbs_down_recent ON thumbs_down(receiver_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_mentions_mentioned ON mentions(mentioned_id);
    CREATE INDEX IF NOT EXISTS idx_pm_receiver ON private_messages(receiver_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_pm_sender ON private_messages(sender_id);
    CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
  `);

  // Best-effort schema upgrades for existing databases
  const addColumn = (table, columnDef) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
    } catch (err) {
      // Ignore if column already exists
    }
  };
  addColumn('users', 'rank_override_title TEXT NULL');
  addColumn('users', 'rank_override_color TEXT NULL');
  addColumn('users', 'rank_override_reason TEXT NULL');
  addColumn('users', 'rank_override_by INTEGER NULL REFERENCES users(id)');
  addColumn('users', 'rank_override_at DATETIME NULL');

  // Seed default badges
  const badgeCount = db.prepare('SELECT COUNT(*) as count FROM badges').get();
  if (badgeCount.count === 0) {
    const insertBadge = db.prepare(
      'INSERT INTO badges (name, description, icon, criteria_type, criteria_value) VALUES (?, ?, ?, ?, ?)'
    );
    const badges = [
      ['First Post', 'Made your first post!', '✏️', 'post_count', 1],
      ['Regular Poster', 'Made 10 posts', '📝', 'post_count', 10],
      ['Prolific Writer', 'Made 100 posts', '📚', 'post_count', 100],
      ['First Thanks Given', 'Thanked someone for the first time', '🤝', 'thanks_given', 1],
      ['First Thanks Received', 'Received your first thanks', '⭐', 'thanks_received', 1],
      ['Helpful', 'Received 25 thanks', '🌟', 'thanks_received', 25],
      ['Super Helpful', 'Received 100 thanks', '💫', 'thanks_received', 100],
      ['Legendary Helper', 'Received 500 thanks', '🏆', 'thanks_received', 500],
      ['Conversation Starter', 'Started 10 threads', '💡', 'thread_count', 10],
      ['Popular Thread', 'Had a thread reach 50 replies', '🔥', 'popular_thread', 50],
      ['Kindness Streak', '30 days without receiving a thumbs down', '💖', 'kindness_streak', 30],
      ['Veteran', 'Member for over 1 year', '🎖️', 'account_age_days', 365],
      ['Welcome Wagon', 'One of the first 10 members', '🎪', 'early_member', 10],
    ];
    const insertMany = db.transaction(() => {
      for (const b of badges) {
        insertBadge.run(...b);
      }
    });
    insertMany();
  }
}

// Rank thresholds
const RANKS = [
  { min: 0, title: 'Newcomer', color: '#6b7280' },
  { min: 5, title: 'Contributor', color: '#3b82f6' },
  { min: 25, title: 'Active Member', color: '#10b981' },
  { min: 50, title: 'Valued Member', color: '#8b5cf6' },
  { min: 100, title: 'Expert', color: '#f59e0b' },
  { min: 250, title: 'Elite', color: '#ef4444' },
  { min: 500, title: 'Legend', color: '#ec4899' },
  { min: 1000, title: 'Forum God', color: '#f97316' },
];

function getRank(thanksReceived) {
  let rank = RANKS[0];
  for (const r of RANKS) {
    if (thanksReceived >= r.min) rank = r;
  }
  return rank;
}

function getRankByTitle(title) {
  if (!title) return null;
  return RANKS.find(r => r.title === title) || null;
}

function getEffectiveRank(user) {
  if (!user) return RANKS[0];
  if (user.rank_override_title) {
    return {
      title: user.rank_override_title,
      color: user.rank_override_color || '#111827',
      min: 0
    };
  }
  return getRank(user.thanks_received || 0);
}

function isHighestRank(user) {
  if (!user) return false;
  const effective = getEffectiveRank(user);
  return effective.title === RANKS[RANKS.length - 1].title;
}

module.exports = { db, initialize, getRank, getRankByTitle, getEffectiveRank, isHighestRank, RANKS };
