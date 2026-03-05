const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Point this to your Replit SQL/Postgres instance.');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
});

function convertPlaceholders(sql) {
  let index = 0;
  let inSingleQuote = false;
  let out = '';

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === "'") {
      out += ch;
      if (inSingleQuote && next === "'") {
        out += next;
        i += 1;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }

    if (!inSingleQuote && ch === '?') {
      index += 1;
      out += `$${index}`;
      continue;
    }

    out += ch;
  }

  return out;
}

function normalizeSql(sql) {
  return convertPlaceholders(String(sql)
    .replace(/\bLIKE\b/gi, 'ILIKE')
    .replace(/datetime\('now'\s*,\s*'-1 day'\)/gi, "NOW() - INTERVAL '1 day'")
    .replace(/datetime\('now'\s*,\s*'-30 days'\)/gi, "NOW() - INTERVAL '30 days'")
    .replace(/datetime\('now'\)/gi, 'NOW()'));
}

function makeDb(client = pool) {
  return {
    prepare(sql) {
      return {
        get: (...params) => this.get(sql, ...params),
        all: (...params) => this.all(sql, ...params),
        run: (...params) => this.run(sql, ...params),
      };
    },

    async query(sql, params = []) {
      return client.query(normalizeSql(sql), params);
    },

    async get(sql, ...params) {
      const result = await this.query(sql, params);
      return result.rows[0];
    },

    async all(sql, ...params) {
      const result = await this.query(sql, params);
      return result.rows;
    },

    async run(sql, ...params) {
      let q = String(sql);
      if (/^\s*INSERT\b/i.test(q) && !/\bRETURNING\b/i.test(q)) {
        q = `${q.trim()} RETURNING id`;
      }
      const result = await this.query(q, params);
      return {
        changes: result.rowCount || 0,
        lastInsertRowid: result.rows[0] ? result.rows[0].id : undefined
      };
    },

    async exec(sql) {
      await client.query(String(sql));
    }
  };
}

const db = makeDb(pool);

async function transaction(handler) {
  const client = await pool.connect();
  const txDb = makeDb(client);
  try {
    await client.query('BEGIN');
    const result = await handler(txDb);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function initialize() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
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
      banned_until TIMESTAMPTZ NULL,
      ban_reason TEXT NULL,
      ban_count INTEGER DEFAULT 0,
      last_active TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      rank_override_title TEXT NULL,
      rank_override_color TEXT NULL,
      rank_override_reason TEXT NULL,
      rank_override_by INTEGER NULL REFERENCES users(id),
      rank_override_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      display_order INTEGER DEFAULT 0,
      parent_id INTEGER NULL REFERENCES categories(id) ON DELETE SET NULL,
      thread_count INTEGER DEFAULT 0,
      post_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS threads (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_pinned INTEGER DEFAULT 0,
      is_locked INTEGER DEFAULT 0,
      is_solved INTEGER DEFAULT 0,
      view_count INTEGER DEFAULT 0,
      reply_count INTEGER DEFAULT 0,
      last_post_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      last_post_by INTEGER NULL REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      is_edited INTEGER DEFAULT 0,
      thanks_count INTEGER DEFAULT 0,
      thumbs_down_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS thanks (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      giver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(post_id, giver_id)
    );

    CREATE TABLE IF NOT EXISTS thumbs_down (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      giver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(post_id, giver_id)
    );

    CREATE TABLE IF NOT EXISTS badges (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT NOT NULL,
      icon TEXT NOT NULL,
      criteria_type TEXT NOT NULL,
      criteria_value INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_badges (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      badge_id INTEGER NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
      awarded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, badge_id)
    );

    CREATE TABLE IF NOT EXISTS mentions (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      mentioner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mentioned_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS private_messages (
      id SERIAL PRIMARY KEY,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      content TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      sender_deleted INTEGER DEFAULT 0,
      receiver_deleted INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      reference_id INTEGER NULL,
      reference_type TEXT NULL,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
      resolved_by INTEGER NULL REFERENCES users(id),
      resolution_note TEXT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      resolved_at TIMESTAMPTZ NULL
    );

    CREATE TABLE IF NOT EXISTS mod_actions (
      id SERIAL PRIMARY KEY,
      mod_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      target_post_id INTEGER NULL REFERENCES posts(id) ON DELETE SET NULL,
      action_type TEXT NOT NULL,
      reason TEXT,
      duration INTEGER NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key_hash TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      last_used TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

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

  const badgeCount = await db.get('SELECT COUNT(*)::int as count FROM badges');
  if (badgeCount.count === 0) {
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

    await transaction(async (tx) => {
      for (const b of badges) {
        await tx.run(
          'INSERT INTO badges (name, description, icon, criteria_type, criteria_value) VALUES (?, ?, ?, ?, ?)',
          ...b
        );
      }
    });
  }

  const badgeIconUpdates = [
    ['First Post', '✏️'],
    ['Regular Poster', '📝'],
    ['Prolific Writer', '📚'],
    ['First Thanks Given', '🤝'],
    ['First Thanks Received', '⭐'],
    ['Helpful', '🌟'],
    ['Super Helpful', '💫'],
    ['Legendary Helper', '🏆'],
    ['Conversation Starter', '💡'],
    ['Popular Thread', '🔥'],
    ['Kindness Streak', '💖'],
    ['Veteran', '🎖️'],
    ['Welcome Wagon', '🎪'],
  ];
  for (const [name, icon] of badgeIconUpdates) {
    await db.run('UPDATE badges SET icon = ? WHERE name = ?', icon, name);
  }
}

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

module.exports = {
  db,
  pool,
  transaction,
  initialize,
  getRank,
  getRankByTitle,
  getEffectiveRank,
  isHighestRank,
  RANKS
};
