#!/usr/bin/env ts-node
import fs from 'fs';
import path from 'path';

const dir = process.argv[2] || 'public/assets';
if (!fs.existsSync(dir)) {
  console.error('no such dir', dir); process.exit(1);
}

const pairs: { png: string; json: string }[] = [];
for (const f of fs.readdirSync(dir)) {
  if (f.endsWith('_atlas.png')) {
    const base = f.replace(/\.png$/, '');
    const json = path.join(dir, base + '.json');
    const png = path.join(dir, f);
    pairs.push({ png, json });
  }
}

if (!pairs.length) { console.log('no atlases'); process.exit(0); }

let ok = true;
for (const p of pairs) {
  const pngOK = fs.existsSync(p.png);
  const jsonOK = fs.existsSync(p.json);
  if (!pngOK || !jsonOK) { console.log('❌', path.basename(p.png), 'missing pair'); ok = false; continue; }

  try {
    const j = JSON.parse(fs.readFileSync(p.json, 'utf8'));
    const frames = Object.keys(j.frames || {}).length;
    console.log('✅', path.basename(p.png), `frames=${frames}`);
  } catch (e) {
    console.log('❌', path.basename(p.png), 'bad JSON'); ok = false;
  }
}

process.exit(ok ? 0 : 1);
