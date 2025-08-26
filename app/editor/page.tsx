"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

// --- Types (compatible with current maps, leaning toward the `cliffs_long.json` schema) ---
export type GridPoint = { x: number; y: number };
export type MapSchema = {
  name: string;
  tileSize: number; // pixels per tile
  width: number; // tiles
  height: number; // tiles
  terrain?: string; // optional label/biome
  background?: string; // optional data URL of the background image (PNG)
  buildMask: GridPoint[]; // cells where building is forbidden
  paths: GridPoint[][]; // array of polylines (each an array of points in tile coords)
  waves?: unknown; // keep door open for game-side
};

// --- Helpers ---
function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function downloadBlob(filename: string, data: Blob) {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function cellKey(p: GridPoint) {
  return `${p.x},${p.y}`;
}

function snapToGrid(px: number, py: number, tile: number): [number, number] {
  return [Math.floor(px / tile), Math.floor(py / tile)];
}

// Brush tools
type Tool = "path" | "block" | "erase" | "hand";

// Presets to keep dimensions uniform in the project
const PRESETS = [
  { label: "16×9 (tile 64)", width: 16, height: 9, tileSize: 64 },
  { label: "14×10 (tile 64)", width: 14, height: 10, tileSize: 64 },
  { label: "18×9 (tile 64)", width: 18, height: 9, tileSize: 64 },
  { label: "20×11 (tile 48)", width: 20, height: 11, tileSize: 48 },
];

export default function MapEditor() {
  // --- State ---
  const [name, setName] = useState("new_map");
  const [width, setWidth] = useState(16);
  const [height, setHeight] = useState(9);
  const [tileSize, setTileSize] = useState(64);
  const [terrain, setTerrain] = useState("Grass");

  const [tool, setTool] = useState<Tool>("path");
  const [activePathIndex, setActivePathIndex] = useState(0);
  const [paths, setPaths] = useState<GridPoint[][]>([[]]);
  const [buildMask, setBuildMask] = useState<Set<string>>(new Set());

  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panning = useRef(false);
  const lastPan = useRef({ x: 0, y: 0 });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const pixelW = width * tileSize;
  const pixelH = height * tileSize;

  // --- Import JSON handler ---
  function importJSON(text: string) {
    try {
      const data = JSON.parse(text) as Partial<MapSchema>;
      if (!data.width || !data.height || !data.tileSize) throw new Error("Mapa inválido: faltan dimensiones");
      setName((data as any).name ?? "imported_map");
      setWidth(data.width);
      setHeight(data.height);
      setTileSize(data.tileSize);
      setTerrain(data.terrain ?? "");
      setPaths((data.paths ?? [[]]).map(pl => pl.map(p => ({ x: p.x|0, y: p.y|0 }))));
      setBuildMask(new Set((data.buildMask ?? []).map(cellKey)));

      if ((data as any).background) {
        const img = new Image();
        img.onload = () => setBgImage(img);
        img.src = (data as any).background as string;
      }
    } catch (e) {
      alert("No se pudo importar JSON: " + (e as Error).message);
    }
  }

  // --- Export JSON handler ---
  function handleExportJSON() {
    const schema: MapSchema = {
      name,
      tileSize,
      width,
      height,
      terrain,
      background: bgImage ? drawBackgroundToDataURL() : undefined,
      buildMask: Array.from(buildMask).map(s => {
        const [x, y] = s.split(",").map(Number);
        return { x, y };
      }),
      paths: paths.map(pl => pl.map(p => ({ x: clamp(p.x, 0, width-1), y: clamp(p.y, 0, height-1) }))),
    };
    const blob = new Blob([JSON.stringify(schema, null, 2)], { type: "application/json" });
    downloadBlob(`${name}.json`, blob);
  }

  function handleExportPNG() {
    const c = document.createElement("canvas");
    c.width = pixelW; c.height = pixelH;
    const g = c.getContext("2d")!;
    // Fondo
    if (bgImage) {
      g.drawImage(bgImage, 0, 0, pixelW, pixelH);
    } else {
      g.fillStyle = "#2b2b2b"; g.fillRect(0, 0, pixelW, pixelH);
    }
    // Rejilla ligera
    drawGrid(g, width, height, tileSize, 0.15);
    // Ruta principal
    g.strokeStyle = "#ffde59"; g.lineWidth = Math.max(2, tileSize * 0.08);
    paths.forEach(pl => {
      if (pl.length < 2) return;
      g.beginPath();
      g.moveTo(pl[0].x * tileSize + tileSize/2, pl[0].y * tileSize + tileSize/2);
      for (let i=1;i<pl.length;i++) {
        g.lineTo(pl[i].x * tileSize + tileSize/2, pl[i].y * tileSize + tileSize/2);
      }
      g.stroke();
    });
    // Celdas bloqueadas
    g.fillStyle = "rgba(255,62,62,0.35)";
    buildMask.forEach(s => {
      const [x,y] = s.split(",").map(Number);
      g.fillRect(x*tileSize, y*tileSize, tileSize, tileSize);
    });

    c.toBlob(b => b && downloadBlob(`${name}.png`, b!), "image/png");
  }

  function drawBackgroundToDataURL(): string {
    const c = document.createElement("canvas");
    c.width = pixelW; c.height = pixelH;
    const g = c.getContext("2d")!;
    if (bgImage) g.drawImage(bgImage, 0, 0, pixelW, pixelH);
    return c.toDataURL("image/png");
  }

  // --- Canvas drawing ---
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;

    const W = pixelW * zoom, H = pixelH * zoom;
    canvas.width = W; canvas.height = H;
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // background
    if (bgImage) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bgImage, 0, 0, pixelW, pixelH);
    } else {
      ctx.fillStyle = "#1b1f2a"; ctx.fillRect(0, 0, pixelW, pixelH);
    }

    // grid
    drawGrid(ctx, width, height, tileSize, 0.25);

    // build mask
    ctx.fillStyle = "rgba(255,62,62,0.35)";
    buildMask.forEach(s => {
      const [x, y] = s.split(",").map(Number);
      ctx.fillRect(x*tileSize, y*tileSize, tileSize, tileSize);
    });

    // paths
    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = Math.max(2, tileSize * 0.08);
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    paths.forEach((pl, idx) => {
      if (pl.length < 2) return;
      ctx.globalAlpha = idx === activePathIndex ? 1 : 0.55;
      ctx.beginPath();
      ctx.moveTo(pl[0].x*tileSize + tileSize/2, pl[0].y*tileSize + tileSize/2);
      for (let i=1;i<pl.length;i++) ctx.lineTo(pl[i].x*tileSize + tileSize/2, pl[i].y*tileSize + tileSize/2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // points
      pl.forEach((p,i) => {
        ctx.fillStyle = i===0?"#4ade80":(i===pl.length-1?"#60a5fa":"#ffd166");
        ctx.beginPath();
        ctx.arc(p.x*tileSize+tileSize/2, p.y*tileSize+tileSize/2, Math.max(3, tileSize*0.12), 0, Math.PI*2);
        ctx.fill();
      });
    });

    ctx.restore();
  }, [bgImage, width, height, tileSize, paths, buildMask, zoom, pan, activePathIndex, pixelW, pixelH]);

  // --- Pointer interactions ---
  function canvasToWorld(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left - pan.x) / zoom;
    const y = (e.clientY - rect.top - pan.y) / zoom;
    return { x, y };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "hand" || e.button === 1) {
      panning.current = true;
      lastPan.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      return;
    }
    const { x, y } = canvasToWorld(e);
    const [gx, gy] = snapToGrid(x, y, tileSize);
    if (gx<0||gy<0||gx>=width||gy>=height) return;

    if (tool === "path") {
      setPaths(prev => {
        const next = prev.map(pl => [...pl]);
        next[activePathIndex].push({ x: gx, y: gy });
        return next;
      });
    } else if (tool === "block") {
      setBuildMask(prev => new Set(prev).add(cellKey({x:gx,y:gy})));
    } else if (tool === "erase") {
      const key = cellKey({x:gx,y:gy});
      setBuildMask(prev => {
        const n = new Set(prev); n.delete(key); return n;
      });
    }
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (panning.current) {
      setPan({ x: e.clientX - lastPan.current.x, y: e.clientY - lastPan.current.y });
      return;
    }
    if (e.buttons === 1 && (tool === "block" || tool === "erase")) {
      const { x, y } = canvasToWorld(e);
      const [gx, gy] = snapToGrid(x, y, tileSize);
      if (gx<0||gy<0||gx>=width||gy>=height) return;
      if (tool === "block") setBuildMask(prev => new Set(prev).add(cellKey({x:gx,y:gy})));
      if (tool === "erase") setBuildMask(prev => { const n = new Set(prev); n.delete(cellKey({x:gx,y:gy})); return n; });
    }
  }
  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    panning.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    if (e.ctrlKey) {
      const before = zoom;
      const next = clamp(zoom * (e.deltaY > 0 ? 0.9 : 1.1), 0.5, 3);
      setZoom(next);
      // keep cursor in place
      const rect = e.currentTarget.getBoundingClientRect();
      const cx = e.clientX - rect.left; const cy = e.clientY - rect.top;
      setPan(p => ({ x: cx - (cx - p.x) * (next / before), y: cy - (cy - p.y) * (next / before) }));
      e.preventDefault();
    }
  }

  // --- Image upload ---
  function handleImageFile(file: File) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Fit/crop to exact canvas dimensions keeping uniform maps
      const c = document.createElement("canvas");
      c.width = pixelW; c.height = pixelH;
      const g = c.getContext("2d")!;
      // cover behavior
      const ratio = Math.max(pixelW / img.width, pixelH / img.height);
      const w = Math.floor(img.width * ratio);
      const h = Math.floor(img.height * ratio);
      const ox = Math.floor((pixelW - w) / 2);
      const oy = Math.floor((pixelH - h) / 2);
      g.imageSmoothingEnabled = false;
      g.drawImage(img, ox, oy, w, h);
      const fitted = new Image();
      fitted.onload = () => setBgImage(fitted);
      fitted.src = c.toDataURL("image/png");
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  // --- UI layout ---
  return (
    <div className="min-h-[100dvh] bg-slate-950 text-slate-50 grid grid-cols-12 gap-4 p-4">
      {/* Sidebar */}
      <motion.aside initial={{ x: -12, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="col-span-12 md:col-span-3 lg:col-span-2 space-y-4">
        <div className="rounded-2xl bg-slate-900/60 p-4 shadow">
          <h2 className="text-lg font-semibold mb-3">🔧 Ajustes</h2>
          <label className="block text-sm opacity-80 mb-1">Nombre</label>
          <input value={name} onChange={e=>setName(e.target.value)} className="w-full bg-slate-800 rounded-xl px-3 py-2 mb-3" />

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm opacity-80 mb-1">Ancho (tiles)</label>
              <input type="number" min={6} max={60} value={width} onChange={e=>setWidth(+e.target.value||width)} className="w-full bg-slate-800 rounded-xl px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm opacity-80 mb-1">Alto (tiles)</label>
              <input type="number" min={6} max={60} value={height} onChange={e=>setHeight(+e.target.value||height)} className="w-full bg-slate-800 rounded-xl px-3 py-2" />
            </div>
          </div>
          <div className="mt-2">
            <label className="block text-sm opacity-80 mb-1">Tamaño tile (px)</label>
            <input type="number" min={16} max={128} step={8} value={tileSize} onChange={e=>setTileSize(+e.target.value||tileSize)} className="w-full bg-slate-800 rounded-xl px-3 py-2" />
          </div>

          <div className="mt-3">
            <label className="block text-sm opacity-80 mb-1">Preset</label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map(p => (
                <button key={p.label} className="px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm" onClick={()=>{setWidth(p.width); setHeight(p.height); setTileSize(p.tileSize);}}>{p.label}</button>
              ))}
            </div>
          </div>

          <div className="mt-3">
            <label className="block text-sm opacity-80 mb-1">Terreno/Bioma</label>
            <input value={terrain} onChange={e=>setTerrain(e.target.value)} className="w-full bg-slate-800 rounded-xl px-3 py-2" />
          </div>
        </div>

        <div className="rounded-2xl bg-slate-900/60 p-4 shadow space-y-3">
          <h2 className="text-lg font-semibold">🖼️ Fondo</h2>
          <input type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0]; if (f) handleImageFile(f);}} />
          <p className="text-xs opacity-70">La imagen se ajusta por <em>cover</em> al lienzo para mantener <strong>dimensiones uniformes</strong>.</p>
          <div className="flex gap-2">
            <button className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700" onClick={handleExportPNG}>Export PNG</button>
            <button className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700" onClick={()=>setBgImage(null)}>Quitar fondo</button>
          </div>
        </div>

        <div className="rounded-2xl bg-slate-900/60 p-4 shadow space-y-3">
          <h2 className="text-lg font-semibold">💾 Importar / Exportar</h2>
          <div className="flex gap-2">
            <button className="px-3 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600" onClick={handleExportJSON}>Export JSON</button>
            <label className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 cursor-pointer">Import JSON
              <input type="file" accept="application/json" className="hidden" onChange={async e=>{const f=e.target.files?.[0]; if(!f)return; const text=await f.text(); importJSON(text);}} />
            </label>
          </div>
        </div>
      </motion.aside>

      {/* Main */}
      <div className="col-span-12 md:col-span-9 lg:col-span-10 grid grid-rows-[auto_1fr_auto] gap-3">
        {/* Toolbar */}
        <motion.div initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="rounded-2xl bg-slate-900/60 p-3 shadow flex flex-wrap items-center gap-2">
          <ToolButton active={tool==="path"} onClick={()=>setTool("path")} label="Ruta" shortcut="1"/>
          <ToolButton active={tool==="block"} onClick={()=>setTool("block")} label="Bloquear" shortcut="2"/>
          <ToolButton active={tool==="erase"} onClick={()=>setTool("erase")} label="Borrar" shortcut="3"/>
          <ToolButton active={tool==="hand"} onClick={()=>setTool("hand")} label="Mover" shortcut="Espacio"/>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="opacity-70">Zoom</span>
            <input type="range" min={50} max={300} value={Math.round(zoom*100)} onChange={e=>setZoom(+e.target.value/100)} />
            <button className="px-2 py-1 rounded-lg bg-slate-800" onClick={()=>{setZoom(1); setPan({x:0,y:0});}}>Reset</button>
          </div>
        </motion.div>

        {/* Canvas wrapper */}
        <div className="rounded-2xl bg-slate-900/60 p-2 shadow overflow-auto relative">
          <canvas
            ref={canvasRef}
            className="w-full h-full touch-none rounded-xl bg-black/30"
            style={{ width: pixelW * zoom + "px", height: pixelH * zoom + "px" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onWheel={onWheel}
          />
        </div>

        {/* Paths & info */}
        <motion.div initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="rounded-2xl bg-slate-900/60 p-3 shadow flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm opacity-80">Rutas:</span>
            {paths.map((_, i) => (
              <button key={i} onClick={()=>setActivePathIndex(i)} className={`px-3 py-1 rounded-xl text-sm ${i===activePathIndex?"bg-amber-700":"bg-slate-800 hover:bg-slate-700"}`}>#{i+1}</button>
            ))}
            <button className="px-3 py-1 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-sm" onClick={()=>setPaths(p=>[...p, []])}>+ Añadir ruta</button>
            {paths.length>1 && (
              <button className="px-3 py-1 rounded-xl bg-rose-700 hover:bg-rose-600 text-sm" onClick={()=>{
                setPaths(prev => prev.filter((_,i)=>i!==activePathIndex));
                setActivePathIndex(i=>clamp(i-1,0,Math.max(0,paths.length-2)));
              }}>Eliminar ruta activa</button>
            )}
          </div>

          <div className="ml-auto text-xs opacity-70">
            <span>Dimensiones: {width}×{height} tiles • {tileSize}px • {pixelW}×{pixelH}px</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function ToolButton({ active, onClick, label, shortcut }:{active:boolean; onClick:()=>void; label:string; shortcut:string}) {
  return (
    <button onClick={onClick} className={`px-3 py-2 rounded-xl text-sm shadow-sm ${active?"bg-amber-700":"bg-slate-800 hover:bg-slate-700"}`}>
      {label} <span className="opacity-70">[{shortcut}]</span>
    </button>
  );
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number, tileSize: number, alpha=0.25) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x++) {
    ctx.beginPath();
    ctx.moveTo(x * tileSize + 0.5, 0);
    ctx.lineTo(x * tileSize + 0.5, height * tileSize);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * tileSize + 0.5);
    ctx.lineTo(width * tileSize, y * tileSize + 0.5);
    ctx.stroke();
  }
  ctx.restore();
}
