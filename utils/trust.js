const { db } = require('../database');

const TRUST_LEVELS = [
  { key: 'new', min: -99999, label: 'New' },
  { key: 'basic', min: 40, label: 'Basic' },
  { key: 'trusted', min: 140, label: 'Trusted' },
  { key: 'core', min: 260, label: 'Core' },
];

function getTrustLevelFromScore(score) {
  let current = TRUST_LEVELS[0];
  for (const level of TRUST_LEVELS) {
    if (score >= level.min) current = level;
  }
  return current;
}

function computeTrustScore(metrics) {
  const thanks = Math.min((metrics.thanks_received || 0) * 2, 300);
  const posts = Math.min(metrics.post_count || 0, 150);
  const threads = Math.min((metrics.thread_count || 0) * 4, 120);
  const ageDays = Math.min(metrics.account_age_days || 0, 365);
  const mfaBonus = metrics.mfa_enabled ? 20 : 0;
  const reportsConfirmed = Math.min((metrics.confirmed_reports || 0) * 8, 120);
  const reportsDismissedPenalty = Math.min((metrics.dismissed_reports || 0) * 5, 50);
  const bansPenalty = Math.min((metrics.ban_count || 0) * 45, 200);

  let score = thanks + posts + threads + ageDays + mfaBonus + reportsConfirmed;
  score -= reportsDismissedPenalty;
  score -= bansPenalty;

  if (metrics.role === 'moderator') score = Math.max(score, 320);
  if (metrics.role === 'admin') score = Math.max(score, 420);
  return score;
}

async function loadTrustMetrics(userId) {
  const user = await db.prepare(`
    SELECT id, role, thanks_received, post_count, thread_count, ban_count, mfa_enabled,
      EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400 as account_age_days
    FROM users WHERE id = ?
  `).get(userId);
  if (!user) return null;

  const reportStats = await db.prepare(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'resolved' AND resolved_action IS NOT NULL AND resolved_action <> 'dismissed')::int as confirmed_reports,
      COUNT(*) FILTER (WHERE status = 'dismissed')::int as dismissed_reports
    FROM reports
    WHERE reporter_id = ?
  `).get(userId);

  return {
    ...user,
    account_age_days: Math.floor(Number(user.account_age_days || 0)),
    confirmed_reports: reportStats?.confirmed_reports || 0,
    dismissed_reports: reportStats?.dismissed_reports || 0
  };
}

async function refreshTrustForUser(userId) {
  const metrics = await loadTrustMetrics(userId);
  if (!metrics) return null;
  const trust_score = computeTrustScore(metrics);
  const trust_level = getTrustLevelFromScore(trust_score).key;

  await db.prepare(
    'UPDATE users SET trust_score = ?, trust_level = ? WHERE id = ?'
  ).run(trust_score, trust_level, userId);

  return { trust_score, trust_level };
}

function getCapabilities(user) {
  const role = user?.role || 'user';
  const trust = user?.trust_level || 'new';
  const staff = role === 'moderator' || role === 'admin';

  if (staff) {
    return {
      canCreateCategory: true,
      canCreateThread: true,
      canReply: true,
      canSendDirectMessage: true,
      canReportPost: true,
      canBypassSlowMode: true
    };
  }

  const byTrust = {
    new: {
      canCreateCategory: false,
      canCreateThread: true,
      canReply: true,
      canSendDirectMessage: false,
      canReportPost: true,
      canBypassSlowMode: false
    },
    basic: {
      canCreateCategory: false,
      canCreateThread: true,
      canReply: true,
      canSendDirectMessage: true,
      canReportPost: true,
      canBypassSlowMode: false
    },
    trusted: {
      canCreateCategory: true,
      canCreateThread: true,
      canReply: true,
      canSendDirectMessage: true,
      canReportPost: true,
      canBypassSlowMode: false
    },
    core: {
      canCreateCategory: true,
      canCreateThread: true,
      canReply: true,
      canSendDirectMessage: true,
      canReportPost: true,
      canBypassSlowMode: true
    }
  };

  return byTrust[trust] || byTrust.new;
}

module.exports = {
  TRUST_LEVELS,
  getCapabilities,
  getTrustLevelFromScore,
  refreshTrustForUser
};
