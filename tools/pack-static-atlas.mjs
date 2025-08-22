// tools/pack-static-atlas.mjs
import fg from 'fast-glob';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const [, , inDirArg, outPng, outJson, wStr, hStr, colsStr] = process.argv;

if (!inDirArg || !outPng || !outJson || !wStr || !hStr) {
  console.error('usage: node tools/pack-static-atlas.mjs <inDir> <out.png> <out.json> <frameW> <frameH> [cols]');
  process.exit(1);
}

const FW   = parseInt(wStr, 10);
const FH   = parseInt(hStr, 10);
const COLS = parseInt(colsStr || '8', 10);

// normaliza ruta de entrada y quita barra final
const inDir = inDirArg.replace(/\\/g, '/').replace(/\/+$/, '');

// asegura carpetas de salida
fs.mkdirSync(path.dirname(outPng), { recursive: true });
fs.mkdirSync(path.dirname(outJson), { recursive: true });

(async () => {
  const files = (await fg(`${inDir}/**/*.png`, { onlyFiles: true, caseSensitiveMatch: false })).sort();

  // Si no hay PNGs en esa carpeta → no bloquear el build
  if (!files.length) {
    console.warn(`⚠️  skip: ${inDir} (no pngs)`);
    process.exit(0);
  }

  const rows   = Math.ceil(files.length / COLS);
  const atlasW = COLS * FW;
  const atlasH = rows * FH;

  const composites = [];
  const frames = {};
  let resized = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const col  = i % COLS;
    const row  = Math.floor(i / COLS);
    const left = col * FW;
    const top  = row * FH;

    const meta = await sharp(file).metadata();
    let inputBuffer;

    if (meta.width !== FW || meta.height !== FH) {
      console.warn(`⚠️  ${file}: ${meta.width}x${meta.height} → ${FW}x${FH}`);
      // Reescala manteniendo pixel-art (nearest) y relleno transparente si sobra
      inputBuffer = await sharp(file)
        .resize(FW, FH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: sharp.kernel.nearest })
        .png()
        .toBuffer();
      resized++;
    } else {
      inputBuffer = await sharp(file).png().toBuffer();
    }

    composites.push({ input: inputBuffer, left, top });

    const name = path.basename(file).replace(/\.png$/i, '');
    frames[name] = {
      frame: { x: left, y: top, w: FW, h: FH },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: FW, h: FH },
      sourceSize: { w: FW, h: FH }
    };
  }

  const base = sharp({
    create: {
      width: atlasW,
      height: atlasH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  });

  await base.composite(composites).png().toFile(outPng);

  const json = {
    frames,
    meta: {
      app: 'pack-static-atlas',
      version: '1.0',
      image: path.basename(outPng),
      format: 'RGBA8888',
      size: { w: atlasW, h: atlasH },
      scale: '1'
    }
  };

  fs.writeFileSync(outJson, JSON.stringify(json, null, 2));
  console.log(`✅ atlas: ${outPng}  json: ${outJson}  frames: ${Object.keys(frames).length}  (resized: ${resized})`);
})().catch(e => { console.error(e); process.exit(1); });
