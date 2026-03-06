const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { db, getRank, getEffectiveRank, getRankByTitle, isHighestRank, RANKS } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { scanFields, warningMessage } = require('../utils/profanity');
const { buildOtpAuthUri, generateBackupCodes, generateSecret, verifyTotpCode } = require('../utils/mfa');
const { TRUST_LEVELS, refreshTrustForUser } = require('../utils/trust');
const { validateStrongPassword } = require('../utils/security');

function getUnlockedRanks(thanksReceived) {
  return RANKS.filter(r => (thanksReceived || 0) >= r.min);
}

async function getSettingsState(userId) {
  const settingsUser = await db.prepare(`
    SELECT id, username, email, avatar, bio, thanks_received, selected_rank_title, mfa_enabled, trust_level, trust_score
    FROM users WHERE id = ?
  `).get(userId);
  return {
    settingsUser,
    unlockedRanks: getUnlockedRanks(settingsUser?.thanks_received || 0),
    currentSelectedRankTitle: settingsUser?.selected_rank_title || '',
    trustLevels: TRUST_LEVELS
  };
}

router.get('/profile/:id', async (req, res, next) => {
  try {
    const user = await db.prepare(`
      SELECT id, username, email, avatar, bio, role, thanks_received, thanks_given,
        post_count, thread_count, banned_until, ban_reason, last_active, created_at,
        rank_override_title, rank_override_color, rank_override_reason, rank_override_by, rank_override_at,
        selected_rank_title, trust_level, trust_score
      FROM users WHERE id = ?
    `).get(req.params.id);

    if (!user) return res.status(404).render('error', { title: 'Not Found', message: 'User not found.' });

    const rank = getEffectiveRank(user);
    const currentThanks = user.thanks_received || 0;
    const achievedRank = getRank(currentThanks);
    const nextRank = RANKS.find(r => r.min > currentThanks) || null;
    const requiredThanks = nextRank ? nextRank.min : currentThanks;
    const rangeStart = achievedRank.min;
    const rangeEnd = nextRank ? nextRank.min : currentThanks;
    const rangeSize = Math.max(1, rangeEnd - rangeStart);
    const progressPercent = nextRank
      ? Math.max(0, Math.min(100, ((currentThanks - rangeStart) / rangeSize) * 100))
      : 100;

    const badges = await db.prepare(`
      SELECT b.*, ub.awarded_at FROM badges b
      JOIN user_badges ub ON b.id = ub.badge_id
      WHERE ub.user_id = ?
      ORDER BY ub.awarded_at DESC
    `).all(user.id);

    const recentPosts = await db.prepare(`
      SELECT p.*, t.title as thread_title, t.id as thread_id
      FROM posts p
      JOIN threads t ON p.thread_id = t.id
      WHERE p.author_id = ?
      ORDER BY p.created_at DESC LIMIT 10
    `).all(user.id);

    const recentThreads = await db.prepare(`
      SELECT t.*, c.name as category_name
      FROM threads t
      JOIN categories c ON t.category_id = c.id
      WHERE t.author_id = ?
      ORDER BY t.created_at DESC LIMIT 10
    `).all(user.id);

    const thanksGivenRecent = (await db.prepare(
      "SELECT COUNT(*)::int as c FROM thanks WHERE giver_id = ? AND created_at > NOW() - INTERVAL '30 days'"
    ).get(user.id)).c;

    const postsRecent = (await db.prepare(
      "SELECT COUNT(*)::int as c FROM posts WHERE author_id = ? AND created_at > NOW() - INTERVAL '30 days'"
    ).get(user.id)).c;

    let rankOverrideBy = null;
    if (user.rank_override_by) {
      rankOverrideBy = await db.prepare('SELECT id, username FROM users WHERE id = ?').get(user.rank_override_by);
    }

    res.render('users/profile', {
      title: user.username + "'s Profile",
      profileUser: user,
      rank,
      rankOverrideBy,
      canManageRanks: isHighestRank(res.locals.currentUser),
      rankOptions: RANKS.map(r => r.title),
      trustLevel: user.trust_level || 'new',
      trustScore: user.trust_score || 0,
      badges,
      recentPosts,
      recentThreads,
      thanksGivenRecent,
      postsRecent,
      rankProgress: {
        currentThanks,
        requiredThanks,
        nextRankTitle: nextRank ? nextRank.title : null,
        progressPercent
      },
      getRank
    });
  } catch (error) {
    next(error);
  }
});

router.get('/settings', requireAuth, async (req, res, next) => {
  try {
    const state = await getSettingsState(res.locals.currentUser.id);
    if (state.settingsUser) {
      res.locals.currentUser = { ...res.locals.currentUser, ...state.settingsUser };
    }
    res.render('users/settings', {
      title: 'Settings',
      error: null,
      success: null,
      unlockedRanks: state.unlockedRanks,
      currentSelectedRankTitle: state.currentSelectedRankTitle,
      trustLevels: state.trustLevels,
      mfaSetup: null,
      backupCodes: []
    });
  } catch (error) {
    next(error);
  }
});

router.post('/settings', requireAuth, async (req, res, next) => {
  try {
    const { bio, avatar, current_password, new_password, confirm_password, selected_rank_title } = req.body;
    const renderSettings = async (error, success) => {
      const state = await getSettingsState(res.locals.currentUser.id);
      if (state.settingsUser) {
        res.locals.currentUser = { ...res.locals.currentUser, ...state.settingsUser };
      }
      return res.render('users/settings', {
        title: 'Settings',
        error,
        success,
        unlockedRanks: state.unlockedRanks,
        currentSelectedRankTitle: state.currentSelectedRankTitle,
        trustLevels: state.trustLevels,
        mfaSetup: null,
        backupCodes: []
      });
    };

    if (bio !== undefined) {
      const cleanBio = (bio || '').substring(0, 500);
      const bioScan = scanFields({ bio: cleanBio });
      if (bioScan.flagged) {
        return renderSettings(warningMessage(bioScan), null);
      }
      await db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(cleanBio, res.locals.currentUser.id);
    }

    if (avatar && avatar.match(/^https?:\/\/.+\..+/)) {
      await db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, res.locals.currentUser.id);
    }

    if (current_password && new_password) {
      const user = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(res.locals.currentUser.id);
      const valid = await bcrypt.compare(current_password, user.password_hash);
      if (!valid) {
        return renderSettings('Current password is incorrect.', null);
      }
      const passwordError = validateStrongPassword(new_password);
      if (passwordError) {
        return renderSettings(passwordError, null);
      }
      if (new_password !== confirm_password) {
        return renderSettings('New passwords do not match.', null);
      }
      const hash = await bcrypt.hash(new_password, 12);
      await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, res.locals.currentUser.id);
    }

    if (selected_rank_title !== undefined) {
      const selectedTitle = (selected_rank_title || '').trim();
      if (!selectedTitle) {
        await db.prepare('UPDATE users SET selected_rank_title = NULL WHERE id = ?').run(res.locals.currentUser.id);
      } else {
        const currentUser = await db.prepare('SELECT thanks_received FROM users WHERE id = ?').get(res.locals.currentUser.id);
        const unlocked = getUnlockedRanks(currentUser?.thanks_received || 0);
        const allowedTitles = new Set(unlocked.map(r => r.title));
        if (!allowedTitles.has(selectedTitle)) {
          return renderSettings('You can only select ranks you have already unlocked.', null);
        }
        await db.prepare('UPDATE users SET selected_rank_title = ? WHERE id = ?').run(selectedTitle, res.locals.currentUser.id);
      }
    }

    await refreshTrustForUser(res.locals.currentUser.id);
    return renderSettings(null, 'Settings updated successfully!');
  } catch (error) {
    next(error);
  }
});

router.post('/settings/mfa/setup', requireAuth, async (req, res, next) => {
  try {
    const secret = generateSecret();
    const uri = buildOtpAuthUri({
      issuer: 'CommuniForums',
      username: res.locals.currentUser.username,
      secret
    });

    await db.prepare('UPDATE users SET mfa_secret = ? WHERE id = ?').run(secret, res.locals.currentUser.id);
    const state = await getSettingsState(res.locals.currentUser.id);
    if (state.settingsUser) {
      res.locals.currentUser = { ...res.locals.currentUser, ...state.settingsUser };
    }

    res.render('users/settings', {
      title: 'Settings',
      error: null,
      success: 'Scan the secret and submit one code to enable MFA.',
      unlockedRanks: state.unlockedRanks,
      currentSelectedRankTitle: state.currentSelectedRankTitle,
      trustLevels: state.trustLevels,
      mfaSetup: { secret, uri },
      backupCodes: []
    });
  } catch (error) {
    next(error);
  }
});

router.post('/settings/mfa/enable', requireAuth, async (req, res, next) => {
  try {
    const token = (req.body.mfa_token || '').trim();
    const user = await db.prepare('SELECT id, mfa_secret FROM users WHERE id = ?').get(res.locals.currentUser.id);
    if (!user?.mfa_secret || !verifyTotpCode(token, user.mfa_secret)) {
      req.flash('error', 'Invalid MFA verification code.');
      return res.redirect('/users/settings');
    }

    const { codes, hashes } = generateBackupCodes();
    await db.prepare(
      'UPDATE users SET mfa_enabled = true, mfa_backup_codes = ? WHERE id = ?'
    ).run(JSON.stringify(hashes), user.id);
    await refreshTrustForUser(user.id);

    const state = await getSettingsState(user.id);
    if (state.settingsUser) {
      res.locals.currentUser = { ...res.locals.currentUser, ...state.settingsUser };
    }

    return res.render('users/settings', {
      title: 'Settings',
      error: null,
      success: 'MFA enabled. Save your backup codes.',
      unlockedRanks: state.unlockedRanks,
      currentSelectedRankTitle: state.currentSelectedRankTitle,
      trustLevels: state.trustLevels,
      mfaSetup: null,
      backupCodes: codes
    });
  } catch (error) {
    next(error);
  }
});

router.post('/settings/mfa/disable', requireAuth, async (req, res, next) => {
  try {
    const user = await db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(res.locals.currentUser.id);
    const password = req.body.current_password_for_mfa || '';
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      req.flash('error', 'Password required to disable MFA.');
      return res.redirect('/users/settings');
    }

    await db.prepare(
      'UPDATE users SET mfa_enabled = false, mfa_secret = NULL, mfa_backup_codes = NULL WHERE id = ?'
    ).run(user.id);
    await refreshTrustForUser(user.id);
    req.flash('success', 'MFA disabled.');
    return res.redirect('/users/settings');
  } catch (error) {
    next(error);
  }
});

router.get('/members', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = 20;
    const offset = (page - 1) * perPage;
    const sort = req.query.sort || 'thanks';

    let orderBy = 'thanks_received DESC';
    if (sort === 'posts') orderBy = 'post_count DESC';
    if (sort === 'newest') orderBy = 'created_at DESC';
    if (sort === 'oldest') orderBy = 'created_at ASC';
    if (sort === 'active') orderBy = 'last_active DESC';

    const totalUsers = (await db.prepare('SELECT COUNT(*)::int as c FROM users').get()).c;
    const totalPages = Math.ceil(totalUsers / perPage);

    const users = await db.prepare(`
      SELECT id, username, avatar, role, thanks_received, post_count, created_at, last_active,
        rank_override_title, rank_override_color, selected_rank_title
      FROM users ORDER BY ${orderBy} LIMIT ? OFFSET ?
    `).all(perPage, offset);

    const usersWithRanks = users.map(u => ({ ...u, rank: getEffectiveRank(u) }));

    res.render('users/members', {
      title: 'Members',
      members: usersWithRanks,
      page,
      totalPages,
      totalUsers,
      sort
    });
  } catch (error) {
    next(error);
  }
});

router.post('/profile/:id/rank', requireAuth, async (req, res, next) => {
  try {
    if (!isHighestRank(res.locals.currentUser)) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'Rank management requires highest rank.' });
    }

    const target = await db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
    if (!target) return res.status(404).render('error', { title: 'Not Found', message: 'User not found.' });

    const action = req.body.action || 'set';
    if (action === 'clear') {
      await db.prepare(
        'UPDATE users SET rank_override_title = NULL, rank_override_color = NULL, rank_override_reason = NULL, rank_override_by = NULL, rank_override_at = NULL WHERE id = ?'
      ).run(target.id);

      await db.prepare('INSERT INTO mod_actions (mod_id, target_user_id, action_type, reason) VALUES (?, ?, ?, ?)')
        .run(res.locals.currentUser.id, target.id, 'rank_revoke', 'Rank override revoked');

      await db.prepare('INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)')
        .run(target.id, 'moderation', 'Your special rank has been revoked.');

      req.flash('success', 'Rank override revoked.');
      return res.redirect(`/users/profile/${target.id}`);
    }

    const title = (req.body.rank_title || '').trim();
    const reason = (req.body.reason || '').trim();
    const rank = getRankByTitle(title);
    if (!rank) {
      req.flash('error', 'Invalid rank selected.');
      return res.redirect(`/users/profile/${target.id}`);
    }

    await db.prepare(
      'UPDATE users SET rank_override_title = ?, rank_override_color = ?, rank_override_reason = ?, rank_override_by = ?, rank_override_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(rank.title, rank.color, reason || null, res.locals.currentUser.id, target.id);

    await db.prepare('INSERT INTO mod_actions (mod_id, target_user_id, action_type, reason) VALUES (?, ?, ?, ?)')
      .run(res.locals.currentUser.id, target.id, 'rank_grant', `Assigned rank: ${rank.title}${reason ? ' - ' + reason : ''}`);

    await db.prepare('INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)')
      .run(target.id, 'moderation', `You have been granted the "${rank.title}" rank.`);

    req.flash('success', 'Rank override saved.');
    res.redirect(`/users/profile/${target.id}`);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
