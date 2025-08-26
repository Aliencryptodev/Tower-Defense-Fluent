'use client';

import React, { useEffect, useRef, useState } from "react";

type MapPoint = { x:number; y:number };
type MapRect  = { x:number; y:number; w:number; h:number };
type MapDef = {
  name:string;
  tileSize:number; width:number; height:number;
  terrain:string;
  buildMask: MapRect[];
  paths: MapPoint[][];
  waves: {
    baseCount:number; countPerWave:number;
    baseHP:number; hpPerWave:number;
    baseSpeed:number; speedPerWave:number;
    spawnDelayMs:number; rewardBase:number;
  }
};

const DEFAULT: MapDef = {
  name:"custom",
  tileSize: 64, width: 14, height: 10,
  terrain: "Grass Path", // usa el frame exacto del atlas de terreno
  buildMask: [],
  paths: [[],[]],
  waves: {
    baseCount: 5, countPerWave: 2,
    baseHP: 40, hpPerWave: 14,
    baseSpeed: 60, speedPerWave: 4,
    spawnDelayMs: 420, rewardBase: 6
  }
};

export default function EditorPage(){
  const [map,setMap] = useState<MapDef>(structuredClone(DEFAULT));
  const [mode,setMode] = useState<'laneA'|'laneB'|'block'>('laneA');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const W = map.width, H = map.height, S = map.tileSize;

  useEffect(()=>{
    const cvs = canvasRef.current!;
    const ctx = cvs.getContext('2d')!;
    cvs.width = W*S; cvs.height = H*S;

    ctx.fillStyle = "#0c0e12"; ctx.fillRect(0,0,cvs.width,cvs.height);

    // grid
    for(let x=0;x<=W;x++){
      ctx.strokeStyle = "rgba(120,140,200,.12)";
      ctx.beginPath(); ctx.moveTo(x*S,0); ctx.lineTo(x*S,H*S); ctx.stroke();
    }
    for(let y=0;y<=H;y++){
      ctx.strokeStyle = "rgba(120,140,200,.12)";
      ctx.beginPath(); ctx.moveTo(0,y*S); ctx.lineTo(W*S,y*S); ctx.stroke();
    }

    // blocked
    ctx.fillStyle = "rgba(240,78,60,0.28)";
    for(const r of map.buildMask){
      for(let x=r.x;x<r.x+r.w;x++)
        for(let y=r.y;y<r.y+r.h;y++){
          ctx.fillRect(x*S+1, y*S+1, S-2, S-2);
        }
    }

    // paths
    const drawPath = (pts:MapPoint[], col:string) => {
      if(!pts.length) return;
      // tiles
      ctx.fillStyle = col;
      pts.forEach(p=>{
        ctx.fillRect(p.x*S+6, p.y*S+6, S-12, S-12);
      });
      // líneas
      ctx.strokeStyle = col; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(pts[0].x*S + S/2, pts[0].y*S + S/2);
      for(let i=1;i<pts.length;i++){
        ctx.lineTo(pts[i].x*S + S/2, pts[i].y*S + S/2);
      }
      ctx.stroke();
    };

    drawPath(map.paths[0], "rgba(255,182,66,0.9)"); // A
    drawPath(map.paths[1], "rgba(106,187,255,0.9)"); // B
  }, [map]);

  function toggleBlock(tx:number, ty:number){
    const key = (r:MapRect)=> `${r.x},${r.y},${r.w},${r.h}`;
    // usamos blocks 1x1 por simplicidad
    const block:MapRect = {x:tx,y:ty,w:1,h:1};
    const k = key(block);
    const found = map.buildMask.find(r=>key(r)===k);
    const next = {...map};
    if(found) next.buildMask = next.buildMask.filter(r=>key(r)!==k);
    else next.buildMask.push(block);
    setMap(next);
  }

  function addToLane(ix:number, tx:number, ty:number){
    const next = {...map, paths: map.paths.map(a=>[...a])};
    // evitar duplicar consecutivos iguales
    const arr = next.paths[ix];
    const last = arr[arr.length-1];
    if(!last || last.x!==tx || last.y!==ty) arr.push({x:tx,y:ty});
    setMap(next);
  }

  function handleClick(ev:React.MouseEvent<HTMLCanvasElement>){
    const rect = (ev.target as HTMLCanvasElement).getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const tx = Math.floor(x/S), ty = Math.floor(y/S);
    if (tx<0 || ty<0 || tx>=W || ty>=H) return;

    if (mode==='block') toggleBlock(tx,ty);
    else if (mode==='laneA') addToLane(0,tx,ty);
    else addToLane(1,tx,ty);
  }

  function exportJSON(){
    const data = JSON.stringify(map, null, 2);
    const blob = new Blob([data], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${map.name || 'custom'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJSON(file:File){
    file.text().then(txt=>{
      try{
        const obj = JSON.parse(txt);
        // validación mínima
        if (!obj || typeof obj!=='object' || !obj.paths) throw new Error("Formato inválido");
        setMap(obj);
      }catch(e){ alert(`No se pudo leer JSON: ${(e as any).message}`); }
    });
  }

  return (
    <div style={{padding:16, fontFamily:"Inter, system-ui, sans-serif"}}>
      <h2 style={{color:"#e8f4ff", marginTop:0}}>Editor de Mapas JSON</h2>

      <div style={{display:"grid", gridTemplateColumns:"280px 1fr", gap:16}}>
        <div style={{background:"#0f1320", border:"1px solid #202a3f", borderRadius:12, padding:12}}>
          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8}}>
            <label style={{color:"#9db3ff", fontSize:12}}>Nombre
              <input value={map.name} onChange={e=>setMap({...map, name:e.target.value})}
                     style={{width:"100%", marginTop:4}} />
            </label>
            <label style={{color:"#9db3ff", fontSize:12}}>TileSize
              <input type="number" value={map.tileSize} min={16} max={96}
                     onChange={e=>setMap({...map, tileSize: Number(e.target.value) || 64})}
                     style={{width:"100%", marginTop:4}} />
            </label>
            <label style={{color:"#9db3ff", fontSize:12}}>Width
              <input type="number" value={map.width} min={6} max={30}
                     onChange={e=>setMap({...map, width: Number(e.target.value)||map.width})}
                     style={{width:"100%", marginTop:4}} />
            </label>
            <label style={{color:"#9db3ff", fontSize:12}}>Height
              <input type="number" value={map.height} min={6} max={24}
                     onChange={e=>setMap({...map, height: Number(e.target.value)||map.height})}
                     style={{width:"100%", marginTop:4}} />
            </label>
            <label style={{gridColumn:"1 / span 2", color:"#9db3ff", fontSize:12}}>Terrain (frame del atlas)
              <input value={map.terrain} onChange={e=>setMap({...map, terrain:e.target.value})}
                     style={{width:"100%", marginTop:4}} placeholder="p.ej. Grass Path" />
            </label>
          </div>

          <div style={{marginTop:12, color:"#9db3ff", fontSize:12}}>Waves (base / por oleada)</div>
          <div style={{display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:8, marginTop:6}}>
            <label style={{color:"#9db3ff", fontSize:12}}>baseCount
              <input type="number" value={map.waves.baseCount}
                onChange={e=>setMap({...map, waves:{...map.waves, baseCount:Number(e.target.value)||0}})}
                style={{width:"100%", marginTop:4}} />
            </label>
            <label style={{color:"#9db3ff", fontSize:12}}>countPerWave
              <input type="number" value={map.waves.countPerWave}
                onChange={e=>setMap({...map, waves:{...map.waves, countPerWave:Number(e.target.value)||0}})}
                style={{width:"100%", marginTop:4}} />
            </label>
            <label style={{color:"#9db3ff", fontSize:12}}>baseHP
              <input type="number" value={map.waves.baseHP}
                onChange={e=>setMap({...map, waves:{...map.waves, baseHP:Number(e.target.value)||0}})}
                style={{width:"100%", marginTop:4}} />
            </label>
            <label style={{color:"#9db3ff", fontSize:12}}>hpPerWave
              <input type="number" value={map.waves.hpPerWave}
                onChange={e=>setMap({...map, waves:{...map.waves, hpPerWave:Number(e.target.value)||0}})}
                style={{width:"100%", marginTop:4}} />
            </label>
            <label style={{color:"#9db3ff", fontSize:12}}>baseSpeed
              <input type="number" value={map.waves.baseSpeed}
                onChange={e=>setMap({...map, waves:{...map.waves, baseSpeed:Number(e.target.value)||0}})}
                style={{width:"100%", marginTop:4}} />
            </label>
            <label style={{color:"#9db3ff", fontSize:12}}>speedPerWave
              <input type="number" value={map.waves.speedPerWave}
                onChange={e=>setMap({...map, waves:{...map.waves, speedPerWave:Number(e.target.value)||0}})}
                style={{width:"100%", marginTop:4}} />
            </label>
            <label style={{color:"#9db3ff", fontSize:12}}>spawnDelayMs
              <input type="number" value={map.waves.spawnDelayMs}
                onChange={e=>setMap({...map, waves:{...map.waves, spawnDelayMs:Number(e.target.value)||400}})}
                style={{width:"100%", marginTop:4}} />
            </label>
            <label style={{color:"#9db3ff", fontSize:12}}>rewardBase
              <input type="number" value={map.waves.rewardBase}
                onChange={e=>setMap({...map, waves:{...map.waves, rewardBase:Number(e.target.value)||6}})}
                style={{width:"100%", marginTop:4}} />
            </label>
          </div>

          <div style={{marginTop:12, display:"flex", gap:8}}>
            <button onClick={()=>setMode('laneA')} style={{padding:"8px 10px", borderRadius:8, border:"1px solid #2a3658", background: mode==='laneA'?"#1b2542":"#12192b", color:"#cde0ff"}}>Editar Lane A</button>
            <button onClick={()=>setMode('laneB')} style={{padding:"8px 10px", borderRadius:8, border:"1px solid #2a3658", background: mode==='laneB'?"#1b2542":"#12192b", color:"#cde0ff"}}>Editar Lane B</button>
            <button onClick={()=>setMode('block')} style={{padding:"8px 10px", borderRadius:8, border:"1px solid #2a3658", background: mode==='block'?"#1b2542":"#12192b", color:"#cde0ff"}}>Bloquear tiles</button>
          </div>

          <div style={{marginTop:12, display:"flex", gap:8}}>
            <button onClick={exportJSON} style={{padding:"8px 10px", borderRadius:8, border:"1px solid #2a3658", background:"#17203a", color:"#cde0ff"}}>Export JSON</button>
            <label style={{padding:"8px 10px", borderRadius:8, border:"1px solid #2a3658", background:"#17203a", color:"#cde0ff", cursor:"pointer"}}>
              Import JSON
              <input type="file" accept="application/json" onChange={e=>e.target.files && importJSON(e.target.files[0])} style={{display:"none"}} />
            </label>
            <button onClick={()=>setMap(structuredClone(DEFAULT))} style={{padding:"8px 10px", borderRadius:8, border:"1px solid #2a3658", background:"#281626", color:"#ffd6f0"}}>Reset</button>
          </div>

          <p style={{color:"#7483a8", fontSize:12, marginTop:10}}>
            CONSEJO: Coloca los primeros puntos del path en el borde del mapa (entrada).
          </p>
        </div>

        <div style={{overflow:"auto", border:"1px solid #202a3f", borderRadius:12}}>
          <canvas ref={canvasRef} onClick={handleClick} style={{display:"block"}} />
        </div>
      </div>
    </div>
  );
}
