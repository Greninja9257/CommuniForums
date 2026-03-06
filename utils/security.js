const escapeMap = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => escapeMap[ch]);
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function escapeJs(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function safeRedirect(value, fallback = '/') {
  if (!value || typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) return fallback;
  if (trimmed.startsWith('//')) return fallback;
  if (trimmed.includes('://')) return fallback;
  return trimmed;
}

function validateStrongPassword(password) {
  const value = String(password || '');
  if (value.length < 10) {
    return 'Password must be at least 10 characters.';
  }
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)) {
    return 'Password must include uppercase, lowercase, and a number.';
  }
  return null;
}

module.exports = { escapeHtml, escapeAttr, escapeJs, safeRedirect, validateStrongPassword };
