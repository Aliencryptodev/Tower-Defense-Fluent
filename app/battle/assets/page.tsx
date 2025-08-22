'use client';
import { useEffect, useState } from 'react';

type Row = { key: string; img: string; json: string; w?: number; h?: number; frames?: number; ok: boolean; err?: string };

const LIST = [
  { key: 'terrain64',   img: '/assets/terrain_atlas.png',    json: '/assets/terrain_atlas.json' },
  { key: 'ui32',        img: '/assets/ui_atlas.png',         json: '/assets/ui_atlas.json' },
  { key: 'castles',     img: '/assets/castles_atlas.png',    json: '/assets/castles_atlas.json' },
  { key: 'towers',      img: '/assets/towers_atlas.png',     json: '/assets/towers_atlas.json' },
  { key: 'enemies32',   img: '/assets/enemies32_atlas.png',  json: '/assets/enemies32_atlas.json' },
  { key: 'enemies40',   img: '/assets/enemies40_atlas.png',  json: '/assets/enemies40_atlas.json' },
  { key: 'enemies48',   img: '/assets/enemies48_atlas.png',  json: '/assets/enemies48_atlas.json' },
  { key: 'enemies64',   img: '/assets/enemies64_atlas.png',  json: '/assets/enemies64_atlas.json' },
  { key: 'projectiles', img: '/assets/projectiles_atlas.png', json: '/assets/projectiles_atlas.json' },
  { key: 'fx',          img: '/assets/effects_atlas.png',     json: '/assets/effects_atlas.json' }
];

export default function AssetsDiag() {
  const [rows, setRows] = useState<Row[]>(LIST.map((l) => ({ key: l.key, img: l.img, json: l.json, ok: false })));

  useEffect(() => {
    (async () => {
      const out: Row[] = [];
      for (const l of LIST) {
        const r: Row = { key: l.key, img: l.img, json: l.json, ok: false };
        try {
          const dim = await new Promise<{ w: number; h: number }>((res, rej) => {
            const im = new Image();
            im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
            im.onerror = () => rej(new Error('img'));
            im.src = l.img + '?v=' + Date.now();
          });
          r.w = dim.w; r.h = dim.h;

          const j = await fetch(l.json + '?v=' + Date.now()).then((r) => r.json());
          const frames = Object.keys(j.frames || {}).length; r.frames = frames;

          r.ok = true;
        } catch (e: any) {
          r.err = e?.message || 'missing';
        }
        out.push(r);
      }
      setRows(out);
    })();
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>Assets Diagnostics</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={{textAlign:'left'}}>Atlas</th><th>PNG</th><th>Dims</th><th>#Frames</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.key}</td>
              <td><a href={r.img} target="_blank" rel="noreferrer">{r.img}</a></td>
              <td>{r.w ? `${r.w}×${r.h}` : '-'}</td>
              <td>{r.frames ?? '-'}</td>
              <td>{r.ok ? '✅ OK' : `❌ ${r.err || 'missing'}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: 12 }}>Si un atlas falla, confirma que existe en <code>/public/assets</code> después del build.</p>
    </main>
  );
}
