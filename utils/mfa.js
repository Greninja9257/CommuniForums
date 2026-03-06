const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(input) {
  const clean = String(input || '').toUpperCase().replace(/=+$/g, '').replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];

  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function normalizeCode(code) {
  return String(code || '').replace(/\s+/g, '').replace(/-/g, '');
}

function generateSecret(size = 20) {
  return base32Encode(crypto.randomBytes(size));
}

function generateTotpCode(secret, timestamp = Date.now(), period = 30, digits = 6) {
  const key = base32Decode(secret);
  const counter = Math.floor(timestamp / 1000 / period);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);

  const digest = crypto.createHmac('sha1', key).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(code % (10 ** digits)).padStart(digits, '0');
}

function verifyTotpCode(token, secret, window = 1, timestamp = Date.now()) {
  const normalized = normalizeCode(token);
  if (!/^\d{6}$/.test(normalized) || !secret) return false;

  for (let i = -window; i <= window; i += 1) {
    const testTime = timestamp + i * 30000;
    if (generateTotpCode(secret, testTime) === normalized) {
      return true;
    }
  }
  return false;
}

function buildOtpAuthUri({ issuer, username, secret }) {
  const label = encodeURIComponent(`${issuer}:${username}`);
  return `otpauth://totp/${label}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

function generateBackupCodes(count = 8) {
  const codes = [];
  const hashes = [];
  for (let i = 0; i < count; i += 1) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    const human = `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
    codes.push(human);
    hashes.push(hashBackupCode(human));
  }
  return { codes, hashes };
}

function hashBackupCode(code) {
  return crypto.createHash('sha256').update(normalizeCode(code)).digest('hex');
}

module.exports = {
  buildOtpAuthUri,
  generateBackupCodes,
  generateSecret,
  hashBackupCode,
  normalizeCode,
  verifyTotpCode
};
