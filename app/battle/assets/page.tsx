'use client';
export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';

const ROWS = [
  {key:'terrain64', png:'/assets/terrain_atlas.png', json:'/assets/terrain_atlas.json'},
  {key:'ui32',      png:'/assets/ui_atlas.png',      json:'/assets/ui_atlas.json'},
  {key:'towers',    png:'/assets/towers_atlas.png',  json:'/assets/towers_atlas.json'},
  {key:'enemies32', png:'/assets/enemies32_atlas.png',json:'/assets/enemies32_atlas.json'},
  {key:'enemies40', png:'/assets/enemies40_atlas.png',json:'/assets/enemies40_atlas.json'},
  {key:'enemies48', png:'/assets/enemies48_atlas.png',json:'/assets/enemies48_atlas.json'},
  {key:'enemies64', png:'/assets/enemies64_atlas.png',json:'/assets/enemies64_atlas.json'},
  {key:'projectiles', png:'/assets/projectiles_atlas.png', json:'/assets/projectiles_atlas.json'},
  {key:'fx',        png:'/assets/effects_atlas.png', json:'/assets/effects_atlas.json'},
];

export default function AssetsDiag(){
  const [rows, setRows] = useState<any[]>([]);
  useEffect(()=>{
    (async ()=>{
      const out:any[]=[];
      for (const r of ROWS){
        try{
          const j = await fetch(r.json).then(x=>x.json());
          const img = new Image();
          await new Promise(res=>{
            img.onload = res;
            img.onerror = res;
            (img as any).src = r.png;
          });
          out.push({ ...r, ok:true, w: img.width||0, h: img.height||0, frames: Object.keys(j.frames||{}).length });
        }catch(_){
          out.push({ ...r, ok:false, w:0, h:0, frames:0 });
        }
      }
      setRows(out);
    })();
  },[]);

  return (
    <div style={{fontFamily:'monospace',color:'#e8f4ff',padding:16}}>
      <h2>Assets Diagnostics</h2>
      <table cellPadding={6} style={{borderCollapse:'collapse'}}>
        <thead>
          <tr><th align="left">Atlas</th><th align="left">PNG</th><th>Dims</th><th>#Frames</th><th>Status</th></tr>
        </thead>
        <tbody>
          {rows.map(r=>(
            <tr key={r.key}>
              <td>{r.key}</td>
              <td><a href={r.png} style={{color:'#8ad'}}>{r.png}</a></td>
              <td>{r.w}×{r.h}</td>
              <td>{r.frames}</td>
              <td>{r.ok?'✅ OK':'❌'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{marginTop:12,color:'#a9b7ff'}}>Si un atlas falla, confirma que existe en <code>/public/assets</code> después del build.</p>
    </div>
  );
}
