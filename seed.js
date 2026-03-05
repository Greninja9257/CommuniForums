const bcrypt = require('bcryptjs');
const { db, initialize, transaction } = require('./database');

async function seed() {
  console.log('Initializing database...');
  await initialize();

  console.log('Seeding data...');

  const adminPass = await bcrypt.hash('admin123', 12);
  const userPass = await bcrypt.hash('user123', 12);

  const users = [
    ['admin', 'admin@communiforums.com', adminPass, 'admin', 'Forum administrator. Here to help!', 150, 50, 45, 12],
    ['moderator', 'mod@communiforums.com', userPass, 'moderator', 'Keeping the community safe and positive.', 80, 30, 30, 8],
    ['alice', 'alice@example.com', userPass, 'user', 'Web developer and coffee enthusiast. Love helping others learn!', 120, 40, 55, 15],
    ['bob', 'bob@example.com', userPass, 'user', 'Python guru and data science nerd.', 65, 25, 35, 10],
    ['charlie', 'charlie@example.com', userPass, 'user', 'Full-stack developer. React & Node.js fan.', 45, 20, 28, 7],
    ['diana', 'diana@example.com', userPass, 'user', 'UX designer turned developer. Accessibility advocate.', 30, 15, 20, 5],
    ['eve', 'eve@example.com', userPass, 'user', 'New to programming. Excited to learn!', 5, 10, 8, 2],
    ['frank', 'frank@example.com', userPass, 'user', 'DevOps engineer. Linux enthusiast.', 55, 18, 22, 6],
    ['grace', 'grace@example.com', userPass, 'user', 'Mobile developer. Flutter & Swift.', 35, 12, 18, 4],
    ['hank', 'hank@example.com', userPass, 'user', 'Game developer. Unity & Godot.', 25, 8, 15, 3],
  ];

  const userIds = {};
  await transaction(async (tx) => {
    for (const u of users) {
      await tx.prepare(`
        INSERT INTO users (username, email, password_hash, role, bio, thanks_received, thanks_given, post_count, thread_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (username) DO NOTHING
      `).run(...u);
      const user = await tx.prepare('SELECT id FROM users WHERE username = ?').get(u[0]);
      userIds[u[0]] = user.id;
    }
  });

  console.log('Users created.');

  await transaction(async (tx) => {
    const entries = [
      ['General Discussion', 'Talk about anything and everything', '💬', 1, null],
      ['Programming Help', 'Get help with coding problems', '💻', 2, null],
      ['Web Development', 'HTML, CSS, JavaScript, and frameworks', '🌐', 3, null],
      ['Mobile Development', 'iOS, Android, Flutter, React Native', '📱', 4, null],
      ['DevOps & Cloud', 'Docker, Kubernetes, AWS, CI/CD', '☁️', 5, null],
      ['Career & Learning', 'Job advice, learning resources, career growth', '🎓', 6, null],
      ['Show & Tell', 'Share your projects and get feedback', '🎨', 7, null],
      ['Off-Topic', 'Non-tech discussions, hobbies, fun stuff', '🎲', 8, null],
    ];

    for (const entry of entries) {
      await tx.prepare(
        'INSERT INTO categories (name, description, icon, display_order, parent_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING'
      ).run(...entry);
    }
  });

  const cats = {};
  const catRows = await db.prepare('SELECT id, name FROM categories').all();
  for (const c of catRows) cats[c.name] = c.id;

  await transaction(async (tx) => {
    const subs = [
      ['JavaScript', 'All things JavaScript', '🟨', 1, cats['Programming Help']],
      ['Python', 'Python programming discussions', '🐍', 2, cats['Programming Help']],
      ['Java & JVM', 'Java, Kotlin, Scala', '☕', 3, cats['Programming Help']],
      ['React & Next.js', 'React ecosystem', '⚛️', 1, cats['Web Development']],
      ['Backend & APIs', 'Server-side development', '🔧', 2, cats['Web Development']],
    ];

    for (const s of subs) {
      await tx.prepare(
        'INSERT INTO categories (name, description, icon, display_order, parent_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING'
      ).run(...s);
    }
  });

  console.log('Categories created.');
  console.log('Seed script migration complete.');
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
