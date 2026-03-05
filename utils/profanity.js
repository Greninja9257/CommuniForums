const fs = require('fs');
const path = require('path');

const WORD_LIST_PATH = path.join(__dirname, '..', 'data', 'profanity-words.txt');

const LEET_MAP = {
  '@': 'a',
  '4': 'a',
  '8': 'b',
  '3': 'e',
  '6': 'g',
  '1': 'i',
  '!': 'i',
  '|': 'i',
  '0': 'o',
  '9': 'g',
  '$': 's',
  '5': 's',
  '7': 't',
  '2': 'z'
};

let cachedRules = null;

function normalizeLeet(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split('')
    .map((ch) => LEET_MAP[ch] || ch)
    .join('');
}

function normalizeWithSpaces(text) {
  return normalizeLeet(text)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCompact(text) {
  return normalizeLeet(text).replace(/[^a-z0-9]/g, '');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getRules() {
  if (cachedRules) return cachedRules;

  let raw = '';
  try {
    raw = fs.readFileSync(WORD_LIST_PATH, 'utf8');
  } catch (err) {
    cachedRules = { phrases: [], compactWords: [] };
    return cachedRules;
  }

  const unique = new Set(
    raw
      .split(/\r?\n/)
      .map((w) => normalizeWithSpaces(w))
      .filter((w) => w.length >= 2)
  );

  const phrases = [];
  const compactWords = [];

  for (const phrase of unique) {
    const compact = phrase.replace(/\s+/g, '');
    if (!compact) continue;

    const regex = new RegExp(`(?:^|[^a-z0-9])${escapeRegex(phrase).replace(/\s+/g, '[^a-z0-9]+')}(?:$|[^a-z0-9])`, 'i');
    phrases.push({ phrase, compact, regex });

    if (compact.length >= 4) {
      compactWords.push(compact);
    }
  }

  cachedRules = { phrases, compactWords };
  return cachedRules;
}

function scanText(text) {
  const str = String(text || '');
  if (!str.trim()) {
    return { flagged: false, matches: [], score: 0, severity: 'none' };
  }

  const rules = getRules();
  const spaced = normalizeWithSpaces(str);
  const compact = normalizeCompact(str);
  const matches = new Set();

  for (const rule of rules.phrases) {
    if (rule.regex.test(spaced)) {
      matches.add(rule.phrase);
      continue;
    }

    // Advanced obfuscation detection for longer terms only (reduces false positives).
    if (rule.compact.length >= 5 && compact.includes(rule.compact)) {
      matches.add(rule.phrase);
    }
  }

  const matchList = [...matches].slice(0, 20);
  const score = matchList.reduce((acc, w) => acc + Math.min(8, Math.max(2, w.length / 2)), 0);

  let severity = 'none';
  if (score >= 24 || matchList.length >= 4) severity = 'high';
  else if (score >= 10 || matchList.length >= 2) severity = 'medium';
  else if (matchList.length > 0) severity = 'low';

  return {
    flagged: matchList.length > 0,
    matches: matchList,
    score,
    severity
  };
}

function scanFields(fields) {
  const flaggedFields = [];
  let totalScore = 0;
  const aggregateMatches = new Set();

  for (const [field, value] of Object.entries(fields || {})) {
    const result = scanText(value);
    if (result.flagged) {
      flaggedFields.push({
        field,
        severity: result.severity,
        matches: result.matches
      });
      totalScore += result.score;
      for (const m of result.matches) aggregateMatches.add(m);
    }
  }

  const totalMatches = [...aggregateMatches];
  let severity = 'none';
  if (totalScore >= 32 || totalMatches.length >= 5) severity = 'high';
  else if (totalScore >= 12 || totalMatches.length >= 2) severity = 'medium';
  else if (totalMatches.length > 0) severity = 'low';

  return {
    flagged: flaggedFields.length > 0,
    severity,
    score: totalScore,
    flaggedFields,
    matches: totalMatches
  };
}

function warningMessage(scan) {
  if (!scan || !scan.flagged) return null;
  const fieldNames = scan.flaggedFields.map(f => f.field).join(', ');
  const level = scan.severity ? scan.severity.toUpperCase() : 'LOW';
  return `Content blocked by profanity filter (${level}) in: ${fieldNames}. Please revise your wording.`;
}

module.exports = {
  scanText,
  scanFields,
  warningMessage
};
