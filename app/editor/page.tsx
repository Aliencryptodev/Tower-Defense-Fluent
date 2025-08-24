'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

// Tipos compatibles con el runtime
type MapPoint = { x: number; y: number };
type MapRect  = { x: number; y: number; w: number; h: number };
type MapDef = {
  name: string;
  tileSize: number; width: number; height: number;
  // Frame base del camino si no hay overrides
  terrain: string;
  // NUEVO: imagen de fondo (puede ser URL absoluta/relativa o dataURL) + opacidad
  preview?: string;
  previewAlpha?: number;
  // NUEVO: skin por carril (frame del atlas terrain_64) y overrides por casilla "x,y" -> frame
  pathSkins?: string[];
  pathFrames?: Record<string, string>;
  // Bloqueos
  buildMask: MapRect[];
  paths: MapPoint[][];
  // Waves igual que ahora
  waves: {
    baseCount: number; countPerWave: number;
    baseHP: number; hpPerWave: number;
    baseSpeed: number; speedPerWave: number;
    spawnDelayMs: number; rewardBase: number;
  }
};

const DEFAULT_MAP: MapDef = {
  name: 'new_map',
  tileSize: 64,
  width: 16,
  height: 10,
  terrain: 'Grass Path',
  preview: '',
  previewAlpha: 0.28,
  pathSkins: ['Grass Path', 'Grass Path'],
  pathFrames: {},
  buildMask: [],
  paths: [[], []],
  waves: {
    baseCount: 10, countPerWave: 2,
    baseHP: 20, hpPerWave: 8,
    baseSpeed: 55, speedPerWave: 2,
    spawnDelayMs: 600, rewardBase: 4,
  }
};

// Frames que vamos a ofrecer del atlas terrain_64
const SUGGESTED_FRAMES = [
  'Grass Path', 'Snow Path', 'Stone Path', 'Lava Path'
];

type Tool = 'pan' | 'path0' | 'path1' | 'mask' | 'erase' | 'override';

export default function MapEditorPage() {
  const [map, setMap] = useState<MapDef>(() => {
    const fromLS = typeof window !== 'undefined' && localStorage.getItem('td_editor_map');
    return fromLS ? JSON.parse(fromLS) as MapDef : DEFAULT_MAP;
  });

  // Estado UI
  const [tool, setTool] = useState<Tool>('path0');
  const [currentSkin, setCurrentSkin] = useState<string>('Grass Path'); // para override/marcar skin de carril
  const [activeLane, setActiveLane] = useState<number>(0); // para path0/path1 toggle rápido
  const [isPanning, setIsPanning] = useState(false);
  const [offset, setOffset] = useState({x:0, y:0});
  const startPan = useRef<{x:number,y:number} | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileBgRef = useRef<HTMLInputElement>(null);
  const fileJsonRef = useRef<HTMLInputElement>(null);

  const pxW = map.width * map.tileSize;
  const pxH = map.height * map.tileSize;

  // Persistencia local
  useEffect(() => {
    localStorage.setItem('td_editor_map', JSON.stringify(map));
  }, [map]);

  // Dibujo
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    cvs.width = pxW; cvs.height = pxH;
    const g = cvs.getContext('2d');
    if (!g) return;

    g.clearRect(0,0,pxW,pxH);

    // fondo (preview)
    if (map.preview) {
      const img = new Image();
      img.onload = () => {
        g.save();
        g.globalAlpha = map.previewAlpha ?? 0.28;
        g.drawImage(img, 0, 0, pxW, pxH);
        g.restore();
        drawGridAndData(g);
      };
      img.src = map.preview;
    } else {
      drawGridAndData(g);
    }

    function drawGridAndData(ctx: CanvasRenderingContext2D) {
      // base
      ctx.fillStyle = '#0c0e12';
      ctx.fillRect(0,0,pxW,pxH);

      // grid
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      for (let x = 0; x <= map.width; x++) {
        ctx.beginPath();
        ctx.moveTo(x*map.tileSize, 0);
        ctx.lineTo(x*map.tileSize, pxH);
        ctx.stroke();
      }
      for (let y = 0; y <= map.height; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y*map.tileSize);
        ctx.lineTo(pxW, y*map.tileSize);
        ctx.stroke();
      }

      // buildMask preview (como celdas)
      ctx.fillStyle = 'rgba(255,80,80,0.25)';
      for (const r of map.buildMask) {
        ctx.fillRect(r.x*map.tileSize, r.y*map.tileSize, r.w*map.tileSize, r.h*map.tileSize);
      }

      // path frames override (tiles distintos)
      Object.entries(map.pathFrames ?? {}).forEach(([key, frame])=>{
        const [tx, ty] = key.split(',').map(Number);
        ctx.fillStyle = frameColor(frame);
        ctx.fillRect(tx*map.tileSize, ty*map.tileSize, map.tileSize, map.tileSize);
      });

      // dibujar paths (por carril)
      for (let lane=0; lane<map.paths.length; lane++) {
        const col = laneColors[lane % laneColors.length];
        const points = map.paths[lane];
        // casillas
        ctx.fillStyle = hexA(col, 0.18);
        for (const p of points) {
          ctx.fillRect(p.x*map.tileSize, p.y*map.tileSize, map.tileSize, map.tileSize);
        }
        // conexión
        ctx.strokeStyle = hexA(col, 0.9);
        ctx.lineWidth = 2;
        ctx.beginPath();
        points.forEach((p,i)=>{
          const cx = p.x*map.tileSize + map.tileSize/2;
          const cy = p.y*map.tileSize + map.tileSize/2;
          if (i===0) ctx.moveTo(cx,cy); else ctx.lineTo(cx,cy);
        });
        ctx.stroke();
      }
    }
  }, [map, pxW, pxH]);

  // Interacción
  const tileFromMouse = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = (ev.target as HTMLCanvasElement).getBoundingClientRect();
    const mx = (ev.clientX - rect.left);
    const my = (ev.clientY - rect.top);
    const tx = Math.floor(mx / map.tileSize);
    const ty = Math.floor(my / map.tileSize);
    if (tx<0 || ty<0 || tx>=map.width || ty>=map.height) return null;
    return {tx, ty};
  };

  const onCanvasDown = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool === 'pan') {
      setIsPanning(true);
      startPan.current = {x: ev.clientX - offset.x, y: ev.clientY - offset.y};
      return;
    }

    const t = tileFromMouse(ev);
    if (!t) return;

    if (tool === 'path0' || tool === 'path1') {
      const lane = tool === 'path0' ? 0 : 1;
      addPointToPath(lane, t.tx, t.ty);
    } else if (tool === 'mask') {
      toggleMaskCell(t.tx, t.ty);
    } else if (tool === 'erase') {
      eraseAt(t.tx, t.ty);
    } else if (tool === 'override') {
      setMap(m => {
        const key = `${t.tx},${t.ty}`;
        const next = {...m, pathFrames: {...(m.pathFrames||{})} };
        if (currentSkin) next.pathFrames![key] = currentSkin;
        return next;
      });
    }
  };

  const onCanvasMove = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning && startPan.current) {
      setOffset({x: ev.clientX - startPan.current.x, y: ev.clientY - startPan.current.y});
      return;
    }
    if (ev.buttons !== 1) return;
    const t = tileFromMouse(ev);
    if (!t) return;
    if (tool === 'mask') toggleMaskCell(t.tx, t.ty, true);
    if (tool === 'override') {
      setMap(m => {
        const key = `${t.tx},${t.ty}`;
        const next = {...m, pathFrames: {...(m.pathFrames||{})} };
        if (currentSkin) next.pathFrames![key] = currentSkin;
        return next;
      });
    }
  };
  const onCanvasUp = () => { setIsPanning(false); startPan.current = null; };

  function addPointToPath(lane: number, x:number, y:number) {
    setMap(m => {
      const paths = m.paths.map(p => [...p]);
      // Evita duplicados consecutivos
      const last = paths[lane][paths[lane].length-1];
      if (!last || last.x !== x || last.y !== y) {
        paths[lane].push({x,y});
      }
      // Asegura pathSkins length
      const pathSkins = (m.pathSkins && m.pathSkins.length>=m.paths.length)
        ? [...m.pathSkins]
        : Array.from({length: m.paths.length}, (_,i)=> m.pathSkins?.[i] ?? m.terrain);
      return {...m, paths, pathSkins};
    });
  }

  function toggleMaskCell(x:number,y:number, dragging=false) {
    // Guardamos como rects; para edición simple usamos "celda=rect de 1x1"
    setMap(m => {
      const bm = [...m.buildMask];
      const idx = bm.findIndex(r => r.x===x && r.y===y && r.w===1 && r.h===1);
      if (idx>=0) { bm.splice(idx,1); } else { bm.push({x,y,w:1,h:1}); }
      return {...m, buildMask: bm};
    });
  }

  function eraseAt(x:number, y:number) {
    setMap(m=>{
      const paths = m.paths.map(p=> p.filter(pt => !(pt.x===x && pt.y===y)));
      const bm = m.buildMask.filter(r => !(r.x===x && r.y===y && r.w===1 && r.h===1));
      const key = `${x},${y}`;
      const pf = {...(m.pathFrames||{})};
      if (pf[key]) delete pf[key];
      return {...m, paths, buildMask: bm, pathFrames: pf};
    });
  }

  // Export JSON (comprime los buildMask 1x1 en rectángulos más grandes por filas)
  const exportJSON = () => {
    const merged = mergeRects(map.buildMask, map.width, map.height);
    const data: MapDef = {...map, buildMask: merged};
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${map.name}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Export PNG de la vista (con fondo si hay)
  const exportPNG = () => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    cvs.toBlob((blob)=>{
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${map.name}_preview.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  };

  // Import JSON
  const onImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const obj = JSON.parse(rd.result as string) as MapDef;
        // sanity
        setMap(prev => ({
          ...prev,
          ...obj,
          pathFrames: obj.pathFrames || {},
          pathSkins: obj.pathSkins || obj.paths.map(()=>obj.terrain)
        }));
      } catch {}
      e.target.value = '';
    };
    rd.readAsText(f);
  };

  // Cargar imagen de fondo como dataURL
  const onImportBg = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => setMap(m => ({...m, preview: rd.result as string}));
    rd.readAsDataURL(f);
  };

  return (
    <div style={{display:'grid', gridTemplateColumns:'320px 1fr', height:'100%', minHeight:'100vh'}}>
      {/* Sidebar */}
      <div style={{padding:12, background:'#0b1220', color:'#e8f4ff', fontFamily:'monospace', borderRight:'1px solid #162033'}}>
        <h2 style={{margin:'6px 0'}}>Editor de Mapas</h2>

        <label>Nombre<br/>
          <input value={map.name} onChange={e=>setMap(m=>({...m,name:e.target.value}))} />
        </label>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginTop:8}}>
          <label>TileSize<br/>
            <input type="number" value={map.tileSize} onChange={e=>setMap(m=>({...m, tileSize: +e.target.value || 1}))}/>
          </label>
          <label>Ancho (tiles)<br/>
            <input type="number" value={map.width} onChange={e=>setMap(m=>({...m, width: Math.max(1, +e.target.value||1)}))}/>
          </label>
          <label>Alto (tiles)<br/>
            <input type="number" value={map.height} onChange={e=>setMap(m=>({...m, height: Math.max(1, +e.target.value||1)}))}/>
          </label>
        </div>

        <div style={{marginTop:8}}>
          <div>Frame base de camino</div>
          <select value={map.terrain} onChange={e=>setMap(m=>({...m, terrain: e.target.value}))}>
            {SUGGESTED_FRAMES.map(f=><option key={f} value={f}>{f}</option>)}
          </select>
        </div>

        <div style={{marginTop:8}}>
          <div>Skins por carril</div>
          {map.paths.map((_,i)=>(
            <div key={i} style={{display:'flex', gap:6, alignItems:'center', margin:'4px 0'}}>
              <span>Lane {i+1}</span>
              <select
                value={map.pathSkins?.[i] ?? map.terrain}
                onChange={e=>{
                  setMap(m=>{
                    const ps = [...(m.pathSkins||[])];
                    ps[i] = e.target.value;
                    return {...m, pathSkins: ps};
                  });
                }}
              >
                {SUGGESTED_FRAMES.map(f=><option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          ))}
          <button onClick={()=>setMap(m=>({...m, paths:[...m.paths, []], pathSkins:[...(m.pathSkins||[]), m.terrain]}))}>
            + Añadir carril
          </button>
        </div>

        <div style={{marginTop:8}}>
          <div>Herramientas</div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:6}}>
            <button onClick={()=>setTool('path0')}>Path 1</button>
            <button onClick={()=>setTool('path1')}>Path 2</button>
            <button onClick={()=>setTool('mask')}>Mask</button>
            <button onClick={()=>setTool('erase')}>Borrar</button>
            <button onClick={()=>setTool('override')}>Override</button>
            <button onClick={()=>setTool('pan')}>Pan</button>
          </div>
          <div style={{marginTop:6}}>
            Skin override:
            <select value={currentSkin} onChange={e=>setCurrentSkin(e.target.value)}>
              {SUGGESTED_FRAMES.map(f=><option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div style={{marginTop:6}}>
            Opacidad fondo:
            <input type="range" min={0} max={1} step={0.01}
              value={map.previewAlpha ?? 0.28}
              onChange={e=>setMap(m=>({...m, previewAlpha: +e.target.value}))}
            />
          </div>
        </div>

        <div style={{marginTop:8}}>
          <div>Fondo (imagen)</div>
          <div style={{display:'flex', gap:6}}>
            <input ref={fileBgRef} type="file" accept="image/*" onChange={onImportBg}/>
            <button onClick={()=>{ setMap(m=>({...m, preview:''})); if (fileBgRef.current) fileBgRef.current.value=''; }}>Quitar</button>
          </div>
          <div style={{marginTop:6}}>
            o URL:
            <input placeholder="/previews/mi_mapa.png"
                   value={map.preview ?? ''}
                   onChange={e=>setMap(m=>({...m, preview:e.target.value}))}/>
          </div>
        </div>

        <div style={{marginTop:10, display:'grid', gridTemplateColumns:'1fr 1fr', gap:6}}>
          <button onClick={exportJSON}>Export JSON</button>
          <button onClick={exportPNG}>Export PNG</button>
          <button onClick={()=>fileJsonRef.current?.click()}>Import JSON</button>
          <input ref={fileJsonRef} type="file" accept="application/json" style={{display:'none'}} onChange={onImportJSON}/>
        </div>

        <div style={{marginTop:12, fontSize:12, opacity:0.8}}>
          Consejos: Click para añadir steps del camino (en orden). “Mask” marca celdas no construibles.
          “Override” te deja mezclar frames de camino por casilla para efectos estéticos.
        </div>
      </div>

      {/* Lienzo */}
      <div style={{position:'relative', overflow:'auto', background:'#04070f'}}>
        <div style={{width:pxW, height:pxH, transform:`translate(${offset.x}px,${offset.y}px)`}}>
          <canvas
            ref={canvasRef}
            style={{display:'block', imageRendering:'pixelated', cursor: tool==='pan' ? 'grab' : 'crosshair'}}
            onMouseDown={onCanvasDown}
            onMouseMove={onCanvasMove}
            onMouseUp={onCanvasUp}
            onMouseLeave={onCanvasUp}
          />
        </div>
      </div>
    </div>
  );
}

/* ---------- helpers de editor ---------- */

const laneColors = ['#4cc2ff', '#ff8a4c', '#9dff6b', '#fef45d'];

function hexA(hex: string, a: number) {
  const c = hex.replace('#','');
  const r = parseInt(c.substring(0,2),16);
  const g = parseInt(c.substring(2,4),16);
  const b = parseInt(c.substring(4,6),16);
  return `rgba(${r},${g},${b},${a})`;
}

function frameColor(frame: string) {
  switch (frame) {
    case 'Grass Path': return 'rgba(50,200,120,0.25)';
    case 'Snow Path':  return 'rgba(200,230,255,0.25)';
    case 'Stone Path': return 'rgba(180,180,180,0.25)';
    case 'Lava Path':  return 'rgba(255,110,60,0.25)';
    default:           return 'rgba(140,160,200,0.25)';
  }
}

// Une rectángulos 1x1 en franjas por fila (simple y suficiente)
function mergeRects(cells: MapRect[], width:number, height:number): MapRect[] {
  // Creamos mapa de celdas booleanas
  const grid:boolean[][] = Array.from({length:height}, ()=> Array.from({length:width}, ()=>false));
  for (const r of cells) {
    for (let x=r.x; x<r.x+r.w; x++) for (let y=r.y; y<r.y+r.h; y++) {
      if (x>=0 && x<width && y>=0 && y<height) grid[y][x] = true;
    }
  }
  const out: MapRect[] = [];
  for (let y=0; y<height; y++) {
    let x=0;
    while (x<width) {
      if (!grid[y][x]) { x++; continue; }
      let x0 = x;
      while (x<width && grid[y][x]) x++;
      out.push({x:x0, y, w:x-x0, h:1});
    }
  }
  return out;
}
