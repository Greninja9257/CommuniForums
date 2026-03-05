const fs = require('fs');

const SOURCES = [
  {
    name: 'ldnoobw_en',
    url: 'https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en',
    parser: (text) => text.split(/\r?\n/)
  },
  {
    name: 'web_mech_words',
    url: 'https://raw.githubusercontent.com/web-mech/badwords/master/lib/lang.json',
    parser: (text) => {
      const json = JSON.parse(text);
      return Array.isArray(json.words) ? json.words : [];
    }
  }
];

const normalize = (w) => String(w || '')
  .toLowerCase()
  .normalize('NFKC')
  .trim()
  .replace(/\s+/g, ' ')
  .replace(/[“”]/g, '"')
  .replace(/[‘’]/g, "'");

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function build() {
  const words = new Set();

  for (const source of SOURCES) {
    const text = await fetchText(source.url);
    const parsed = source.parser(text);
    for (const word of parsed) {
      const w = normalize(word);
      if (!w) continue;
      if (w.length < 2) continue;
      words.add(w);
    }
    console.log(`loaded ${source.name}`);
  }

  const out = [...words].sort();
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync('data/profanity-words.txt', out.join('\n') + '\n');
  console.log(`wrote ${out.length} words to data/profanity-words.txt`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
