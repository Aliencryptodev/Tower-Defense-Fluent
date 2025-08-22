#!/usr/bin/env ts-node
import fg from 'fast-glob';
import sharp from 'sharp';
import fs from 'fs';

const [,, inDir, outPng, outJson, wStr, hStr, colsStr] = process.argv;
if (!inDir || !outPng || !outJson || !wStr || !hStr) {
  console.error('usage: pack-static-atlas <inDir> <out.png> <out.json> <frameW> <frameH> [cols]');
  process.exit(1);
}
const FW = parseInt(wStr,10), FH = parseInt(hStr,10), COLS = parseInt(colsStr||'8',10);

(async () => {
  const files = (await fg(`${inDir.replace(/\\/$/,'')}/**/*.png`)).sort();
  if (!files.length) throw new Error('no pngs');
  const rows = Math.ceil(files.length / COLS);
  const atlasW = COLS * FW, atlasH = rows * FH;

  const composites: sharp.OverlayOptions[] = [];
  const frames: Record<string, any> = {};

  for (let i=0;i<files.length;i++){
    const file = files[i];
    const col = i % COLS; const row = Math.floor(i / COLS);
    const left = col * FW; const top = row * FH;
    composites.push({ input: file, left, top });
    const name = file.split('/').pop()!.replace(/\.png$/,'');
    frames[name] = { frame:{ x:left, y:top, w:FW, h:FH }, rotated:false, trimmed:false, spriteSourceSize:{ x:0,y:0,w:FW,h:FH }, sourceSize:{ w:FW, h:FH } };
  }

  const img = sharp({ create:{ width:atlasW, height:atlasH, channels:4, background:{ r:0,g:0,b:0,alpha:0 } } });
  await img.composite(composites).png().toFile(outPng);

  const json = { frames, meta:{ app:'pack-static-atlas', version:'1.0', image: outPng.split('/').pop(), format:'RGBA8888', size:{ w: atlasW, h: atlasH }, scale:'1' } };
  fs.writeFileSync(outJson, JSON.stringify(json, null, 2));
  console.log(`✅ atlas: ${outPng}  json: ${outJson}  frames: ${files.length}`);
})().catch(e=>{ console.error(e); process.exit(1); });
