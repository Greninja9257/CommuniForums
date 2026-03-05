const bcrypt = require('bcryptjs');
const { db, initialize } = require('./database');

async function seed() {
  console.log('Initializing database...');
  initialize();

  console.log('Seeding data...');

  // Create users
  const adminPass = await bcrypt.hash('admin123', 12);
  const userPass = await bcrypt.hash('user123', 12);

  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (username, email, password_hash, role, bio, thanks_received, thanks_given, post_count, thread_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

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
  db.transaction(() => {
    for (const u of users) {
      insertUser.run(...u);
      const user = db.prepare('SELECT id FROM users WHERE username = ?').get(u[0]);
      userIds[u[0]] = user.id;
    }
  })();

  console.log('Users created.');

  // Create categories
  const insertCat = db.prepare(
    'INSERT OR IGNORE INTO categories (name, description, icon, display_order, parent_id) VALUES (?, ?, ?, ?, ?)'
  );

  db.transaction(() => {
    insertCat.run('General Discussion', 'Talk about anything and everything', '💬', 1, null);
    insertCat.run('Programming Help', 'Get help with coding problems', '💻', 2, null);
    insertCat.run('Web Development', 'HTML, CSS, JavaScript, and frameworks', '🌐', 3, null);
    insertCat.run('Mobile Development', 'iOS, Android, Flutter, React Native', '📱', 4, null);
    insertCat.run('DevOps & Cloud', 'Docker, Kubernetes, AWS, CI/CD', '☁️', 5, null);
    insertCat.run('Career & Learning', 'Job advice, learning resources, career growth', '🎓', 6, null);
    insertCat.run('Show & Tell', 'Share your projects and get feedback', '🎨', 7, null);
    insertCat.run('Off-Topic', 'Non-tech discussions, hobbies, fun stuff', '🎲', 8, null);
  })();

  // Get category IDs
  const cats = {};
  db.prepare('SELECT id, name FROM categories').all().forEach(c => {
    cats[c.name] = c.id;
  });

  // Create subcategories
  db.transaction(() => {
    insertCat.run('JavaScript', 'All things JavaScript', '🟨', 1, cats['Programming Help']);
    insertCat.run('Python', 'Python programming discussions', '🐍', 2, cats['Programming Help']);
    insertCat.run('Java & JVM', 'Java, Kotlin, Scala', '☕', 3, cats['Programming Help']);
    insertCat.run('React & Next.js', 'React ecosystem', '⚛️', 1, cats['Web Development']);
    insertCat.run('Backend & APIs', 'Server-side development', '🔧', 2, cats['Web Development']);
  })();

  console.log('Categories created.');

  // Create threads and posts
  const insertThread = db.prepare(
    'INSERT INTO threads (title, category_id, author_id, last_post_by, reply_count, view_count) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertPost = db.prepare(
    'INSERT INTO posts (thread_id, author_id, content, thanks_count) VALUES (?, ?, ?, ?)'
  );

  const threads = [
    {
      title: 'Welcome to CommuniForums! Read this first',
      category: 'General Discussion',
      author: 'admin',
      views: 342,
      posts: [
        { author: 'admin', content: "# Welcome to CommuniForums! 🎉\n\nWe're thrilled to have you here. This is a community built on **positivity**, **knowledge sharing**, and **mutual respect**.\n\n## Community Guidelines\n\n1. **Be kind and respectful** - Treat others how you'd want to be treated\n2. **Help others** - Share your knowledge freely\n3. **Stay on topic** - Post in the right categories\n4. **No spam** - Quality over quantity\n5. **Give thanks** - If someone helps you, click the 👍 button!\n\n## Ranking System\n\nYou earn ranks by receiving thanks from other members:\n- 🔵 **Newcomer** → 🔵 **Contributor** → 🟢 **Active Member** → 🟣 **Valued Member**\n- 🟡 **Expert** → 🔴 **Elite** → 💗 **Legend** → 🔥 **Forum God**\n\nLet's build something great together!", thanks: 15 },
        { author: 'alice', content: "Great to be here! Looking forward to helping out the community. 😊", thanks: 5 },
        { author: 'bob', content: "This looks awesome! Love the positivity focus.", thanks: 3 },
        { author: 'eve', content: "Just joined and already feeling welcome. Thanks for creating this!", thanks: 2 },
      ]
    },
    {
      title: 'How do closures work in JavaScript?',
      category: 'General Discussion',
      author: 'eve',
      views: 187,
      posts: [
        { author: 'eve', content: "I keep hearing about closures in JavaScript but I don't quite understand them. Can someone explain in simple terms?\n\n```javascript\nfunction outer() {\n  let count = 0;\n  return function inner() {\n    count++;\n    return count;\n  };\n}\n```\n\nWhy does `inner` still have access to `count` after `outer` has returned?", thanks: 1 },
        { author: 'alice', content: "Great question! A closure is when a function \"remembers\" the variables from its outer scope, even after the outer function has finished executing.\n\nThink of it like this: when `outer()` runs, it creates a little environment (scope) with `count = 0`. The `inner` function is created inside this environment, so it has a reference to it.\n\nWhen `outer()` returns `inner`, that reference doesn't go away. The inner function \"closes over\" the variables it needs.\n\n```javascript\nconst counter = outer();\nconsole.log(counter()); // 1\nconsole.log(counter()); // 2\nconsole.log(counter()); // 3\n```\n\nEach call to `counter()` increments the same `count` variable because the closure keeps it alive!", thanks: 12 },
        { author: 'charlie', content: "To add to what Alice said, closures are super useful for:\n\n1. **Data privacy** - Variables inside the closure can't be accessed from outside\n2. **State management** - Like the counter example above\n3. **Callbacks** - Event handlers often use closures\n4. **Partial application** - Creating specialized functions\n\nHere's a practical example:\n\n```javascript\nfunction createGreeter(greeting) {\n  return function(name) {\n    return `${greeting}, ${name}!`;\n  };\n}\n\nconst sayHello = createGreeter('Hello');\nconst sayHi = createGreeter('Hi');\n\nconsole.log(sayHello('Eve')); // Hello, Eve!\nconsole.log(sayHi('Eve'));    // Hi, Eve!\n```", thanks: 8 },
        { author: 'eve', content: "Wow, this makes so much sense now! Thank you @alice and @charlie! The examples really helped. 🙏", thanks: 1 },
      ]
    },
    {
      title: 'Best practices for REST API design in 2025',
      category: 'General Discussion',
      author: 'frank',
      views: 256,
      posts: [
        { author: 'frank', content: "I'm designing a new REST API and want to follow current best practices. What are your top recommendations?\n\nSome things I'm already doing:\n- Using proper HTTP methods (GET, POST, PUT, DELETE)\n- Returning appropriate status codes\n- JSON for request/response bodies\n\nWhat else should I consider?", thanks: 3 },
        { author: 'bob', content: "Here are my top REST API best practices:\n\n1. **Use nouns for resources**: `/users`, `/posts`, not `/getUsers`\n2. **Version your API**: `/api/v1/users`\n3. **Use pagination**: `?page=1&limit=20`\n4. **Filter, sort, search**: `?status=active&sort=-created_at`\n5. **HATEOAS**: Include links in responses\n6. **Rate limiting**: Protect your API from abuse\n7. **Consistent error format**:\n```json\n{\n  \"error\": {\n    \"code\": \"VALIDATION_ERROR\",\n    \"message\": \"Email is required\",\n    \"field\": \"email\"\n  }\n}\n```\n8. **Use ETags** for caching\n9. **Document with OpenAPI/Swagger**\n10. **Authentication**: Use JWT or OAuth2", thanks: 10 },
        { author: 'alice', content: "Great list from @bob! I'd add:\n\n- **Use HTTPS always**\n- **Idempotent operations**: PUT and DELETE should be idempotent\n- **Bulk operations**: Allow batch creates/updates for performance\n- **Partial updates with PATCH**: Don't force sending the whole resource\n- **Health check endpoint**: `GET /health` for monitoring", thanks: 6 },
      ]
    },
    {
      title: 'My first web app - a task manager! Feedback welcome',
      category: 'General Discussion',
      author: 'eve',
      views: 98,
      posts: [
        { author: 'eve', content: "After 3 months of learning, I finally built my first web app! It's a simple task manager with:\n\n- Create, edit, delete tasks\n- Categories and priorities\n- Due dates with reminders\n- Dark mode!\n\nBuilt with HTML, CSS, and vanilla JavaScript. No frameworks!\n\nI'd love any feedback or suggestions for improvement. Be gentle - I'm still learning! 😅", thanks: 8 },
        { author: 'diana', content: "This is amazing for 3 months of learning! Some UX suggestions:\n\n1. Add drag-and-drop to reorder tasks\n2. Use color coding for priority levels\n3. Add keyboard shortcuts (e.g., `N` for new task)\n4. The dark mode toggle is really nice!\n\nKeep it up! 🎉", thanks: 4 },
        { author: 'charlie', content: "Nice work @eve! For next steps, you could try:\n\n- Adding localStorage to persist tasks\n- A service worker for offline support\n- Progressive Web App (PWA) features\n\nYou're making great progress!", thanks: 3 },
      ]
    },
    {
      title: 'Docker vs Podman for local development?',
      category: 'General Discussion',
      author: 'frank',
      views: 145,
      posts: [
        { author: 'frank', content: "Our team is debating whether to switch from Docker to Podman for local development. Has anyone made this switch?\n\nPros I've heard about Podman:\n- Daemonless architecture\n- Rootless containers by default\n- Docker-compatible CLI\n- No licensing concerns\n\nBut I'm worried about:\n- docker-compose compatibility\n- IDE integration\n- Team adoption curve", thanks: 4 },
        { author: 'bob', content: "We switched to Podman about 6 months ago. Here's my honest assessment:\n\n**Pros:**\n- Almost 100% Docker CLI compatible\n- `podman-compose` works for most docker-compose files\n- Better security with rootless\n- No background daemon eating resources\n\n**Cons:**\n- Some edge cases with networking\n- Volume mounts can be trickier with rootless\n- Not all CI/CD pipelines support it natively yet\n\nOverall: worth it if you care about security. If your team is comfortable with Docker and has no issues, the switch might not be necessary.", thanks: 7 },
      ]
    },
    {
      title: 'Tips for junior developers - what I wish I knew',
      category: 'General Discussion',
      author: 'alice',
      views: 412,
      posts: [
        { author: 'alice', content: "After 8 years in the industry, here are things I wish someone told me when I started:\n\n1. **Read other people's code** - You learn more from reading than writing\n2. **Don't memorize, understand** - Concepts > syntax\n3. **Git is your friend** - Learn it well, commit often\n4. **Write tests** - Future you will thank present you\n5. **Ask questions** - There are no stupid questions\n6. **Take breaks** - Burnout is real\n7. **Build projects** - Tutorial hell is real too\n8. **Learn debugging** - It's a superpower\n9. **Document your work** - Comments and docs matter\n10. **Be patient** - Nobody becomes an expert overnight\n\nWhat would you add to this list?", thanks: 25 },
        { author: 'bob', content: "Great list! I'd add:\n\n11. **Learn SQL** - Even if you use ORMs\n12. **Understand HTTP** - It's the backbone of the web\n13. **Version control your dotfiles** - Seriously\n14. **Contribute to open source** - Start small, fix typos\n15. **Network with other devs** - Communities like this one!", thanks: 8 },
        { author: 'diana', content: "As someone who transitioned from design:\n\n16. **Learn accessibility (a11y)** - It's not optional\n17. **Performance matters from day 1** - Don't optimize prematurely, but be aware\n18. **Imposter syndrome is normal** - Everyone feels it\n19. **Soft skills matter** - Communication > coding in many situations", thanks: 11 },
        { author: 'hank', content: "From a game dev perspective:\n\n20. **Ship something** - A finished product beats a perfect prototype\n21. **Learn to scope** - Cut features ruthlessly\n22. **Playtest early and often** - Real users find things you never will", thanks: 5 },
        { author: 'eve', content: "As a junior dev, these are all incredibly helpful. Thank you all! Saving this thread. 🙏", thanks: 2 },
      ]
    },
  ];

  db.transaction(() => {
    for (const t of threads) {
      const authorId = userIds[t.author];
      const catId = cats[t.category] || Object.values(cats)[0];
      const lastPostAuthor = t.posts[t.posts.length - 1].author;

      const threadResult = insertThread.run(
        t.title, catId, authorId, userIds[lastPostAuthor], t.posts.length - 1, t.views
      );
      const threadId = threadResult.lastInsertRowid;

      for (const p of t.posts) {
        insertPost.run(threadId, userIds[p.author], p.content, p.thanks || 0);
      }
    }
  })();

  console.log('Threads and posts created.');

  // Award some badges
  const awardBadge = db.prepare('INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)');
  const getBadge = (name) => db.prepare('SELECT id FROM badges WHERE name = ?').get(name);

  db.transaction(() => {
    // Welcome Wagon for early users
    const welcomeBadge = getBadge('Welcome Wagon');
    if (welcomeBadge) {
      for (const uid of Object.values(userIds)) {
        awardBadge.run(uid, welcomeBadge.id);
      }
    }

    // Post badges
    const firstPost = getBadge('First Post');
    const regular = getBadge('Regular Poster');
    const prolific = getBadge('Prolific Writer');
    if (firstPost) for (const uid of Object.values(userIds)) awardBadge.run(uid, firstPost.id);
    if (regular) {
      awardBadge.run(userIds['admin'], regular.id);
      awardBadge.run(userIds['alice'], regular.id);
      awardBadge.run(userIds['bob'], regular.id);
      awardBadge.run(userIds['charlie'], regular.id);
      awardBadge.run(userIds['frank'], regular.id);
    }
    if (prolific) {
      awardBadge.run(userIds['alice'], prolific.id);
      awardBadge.run(userIds['admin'], prolific.id);
    }

    // Thanks badges
    const firstThanksR = getBadge('First Thanks Received');
    const helpful = getBadge('Helpful');
    const superHelpful = getBadge('Super Helpful');
    const convoStarter = getBadge('Conversation Starter');
    if (firstThanksR) for (const uid of Object.values(userIds)) awardBadge.run(uid, firstThanksR.id);
    if (helpful) {
      awardBadge.run(userIds['alice'], helpful.id);
      awardBadge.run(userIds['bob'], helpful.id);
      awardBadge.run(userIds['frank'], helpful.id);
      awardBadge.run(userIds['admin'], helpful.id);
    }
    if (superHelpful) {
      awardBadge.run(userIds['alice'], superHelpful.id);
      awardBadge.run(userIds['admin'], superHelpful.id);
    }
    if (convoStarter) {
      awardBadge.run(userIds['alice'], convoStarter.id);
      awardBadge.run(userIds['admin'], convoStarter.id);
    }

    // First Thanks Given
    const firstThanksG = getBadge('First Thanks Given');
    if (firstThanksG) for (const uid of Object.values(userIds)) awardBadge.run(uid, firstThanksG.id);
  })();

  console.log('Badges awarded.');

  // Add some notifications
  const insertNotif = db.prepare(
    'INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)'
  );

  db.transaction(() => {
    insertNotif.run(userIds['eve'], 'thanks', 'alice thanked your post!');
    insertNotif.run(userIds['eve'], 'reply', 'alice replied to your thread "How do closures work in JavaScript?"');
    insertNotif.run(userIds['eve'], 'badge', 'You earned the "First Post" badge! ✏️');
    insertNotif.run(userIds['eve'], 'badge', 'You earned the "Welcome Wagon" badge! 🎪');
    insertNotif.run(userIds['alice'], 'mention', '@eve mentioned you in a post');
    insertNotif.run(userIds['alice'], 'thanks', 'bob thanked your post!');
  })();

  console.log('Notifications created.');
  console.log('\n✅ Seed complete!\n');
  console.log('Default accounts:');
  console.log('  Admin:     admin / admin123');
  console.log('  Moderator: moderator / user123');
  console.log('  Users:     alice, bob, charlie, diana, eve, frank, grace, hank / user123');
  console.log('\nRun: node server.js');
}

seed().catch(console.error);
