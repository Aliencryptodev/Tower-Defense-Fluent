"use client";

import React, { useEffect, useRef, useState } from "react";

// ================= CONFIGURACIÓN (dimensiones uniformes) =================
const WIDTH_TILES = 16;
const HEIGHT_TILES = 9;
const TILE_PX = 64;
// ========================================================================

type P = { x: number; y: number };
type MapExport = {
  name: string;
  tileSize: number;
  width: number;
  height: number;
  paths: P[][];
  backgroundFile?: string; // p.ej. "<name>.png"
};

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const snapToGrid = (px: number, py: number, tile: number): [number, number] => [
  Math.floor(px / tile),
  Math.floor(py / tile),
];

export const dynamic = "force-static";

export default function Page() {
  // Estado base
  const [name, setName] = useState("new_map");
  const [paths, setPaths] = useState<P[][]>([[]]); // múltiples carriles
  const [lane, setLane] = useState(0);             // carril activo

  // Fondo (para guiarte visualmente)
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [bgFileName, setBgFileName] = useState<string | undefined>(undefined);

  // Pan/zoom
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panning = useRef(false);
  const lastPan = useRef({ x: 0, y: 0 });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const pixelW = WIDTH_TILES * TILE_PX;
  const pixelH = HEIGHT_TILES * TILE_PX;

  // Dibujo del editor
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const g = c.getContext("2d"); if (!g) return;
    c.width = pixelW * zoom; c.height = pixelH * zoom;

    g.save();
    g.translate(pan.x, pan.y);
    g.scale(zoom, zoom);

    // Fondo
    if (bgImage) g.drawImage(bgImage, 0, 0, pixelW, pixelH);
    else { g.fillStyle = "#1b1f2a"; g.fillRect(0, 0, pixelW, pixelH); }

    // Grid
    g.globalAlpha = 0.25; g.strokeStyle = "#ffffff"; g.lineWidth = 1;
    for (let x = 0; x <= WIDTH_TILES; x++) { g.beginPath(); g.moveTo(x*TILE_PX+0.5, 0); g.lineTo(x*TILE_PX+0.5, pixelH); g.stroke(); }
    for (let y = 0; y <= HEIGHT_TILES; y++) { g.beginPath(); g.moveTo(0, y*TILE_PX+0.5); g.lineTo(pixelW, y*TILE_PX+0.5); g.stroke(); }
    g.globalAlpha = 1;

    // Rutas (la activa más brillante)
    paths.forEach((path, i) => {
      if (path.length < 1) return;
      g.globalAlpha = i === lane ? 1 : 0.6;
      g.strokeStyle = "#ffd166"; g.lineJoin = "round"; g.lineCap = "round";
      g.lineWidth = Math.max(2, TILE_PX * 0.08);
      g.beginPath();
      g.moveTo(path[0].x*TILE_PX + TILE_PX/2, path[0].y*TILE_PX + TILE_PX/2);
      for (let k = 1; k < path.length; k++) {
        g.lineTo(path[k].x*TILE_PX + TILE_PX/2, path[k].y*TILE_PX + TILE_PX/2);
      }
      g.stroke();
      // puntos
      path.forEach((p, idx) => {
        g.fillStyle = idx===0 ? "#4ade80" : (idx===path.length-1 ? "#60a5fa" : "#ffd166");
        g.beginPath();
        g.arc(p.x*TILE_PX+TILE_PX/2, p.y*TILE_PX+TILE_PX/2, Math.max(3, TILE_PX*0.12), 0, Math.PI*2);
        g.fill();
      });
    });

    g.restore();
  }, [bgImage, paths, lane, zoom, pan]);

  // Interacciones
  function canvasToWorld(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left - pan.x) / zoom;
    const y = (e.clientY - rect.top - pan.y) / zoom;
    return { x, y };
  }
  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.shiftKey) { // botón central o shift -> mover
      panning.current = true;
      lastPan.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      return;
    }
    const { x, y } = canvasToWorld(e);
    const [gx, gy] = snapToGrid(x, y, TILE_PX);
    if (gx<0||gy<0||gx>=WIDTH_TILES||gy>=HEIGHT_TILES) return;
    setPaths(prev => {
      const next = prev.map(p => [...p]);
      next[lane].push({ x: gx, y: gy });
      return next;
    });
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (panning.current) { setPan({ x: e.clientX - lastPan.current.x, y: e.clientY - lastPan.current.y }); }
  }
  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    panning.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }
  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    if (e.ctrlKey) {
      const before = zoom; const next = clamp(zoom * (e.deltaY>0?0.9:1.1), 0.5, 3);
      setZoom(next);
      const rect = e.currentTarget.getBoundingClientRect();
      const cx = e.clientX - rect.left; const cy = e.clientY - rect.top;
      setPan(p => ({ x: cx - (cx - p.x) * (next / before), y: cy - (cy - p.y) * (next / before) }));
      e.preventDefault();
    }
  }

  // Auxiliares
  function isOnBorder(p: P) {
    return p.x === 0 || p.y === 0 || p.x === WIDTH_TILES-1 || p.y === HEIGHT_TILES-1;
  }
  function undoLast() {
    setPaths(prev => {
      const next = prev.map(p => [...p]);
      next[lane] = next[lane].slice(0, -1);
      return next;
    });
  }
  function clearLane() {
    setPaths(prev => {
      const next = prev.map(p => [...p]);
      next[lane] = [];
      return next;
    });
  }
  function addLane() {
    setPaths(prev => [...prev, []]);
    setLane(paths.length);
  }
  function deleteLane() {
    if (paths.length <= 1) return;
    setPaths(prev => prev.filter((_, i) => i !== lane));
    setLane(l => Math.max(0, l - 1));
  }

  // Imagen
  function onChooseImage(file: File) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Ajuste cover a tamaño fijo
      const c = document.createElement("canvas"); c.width = pixelW; c.height = pixelH;
      const g = c.getContext("2d")!;
      const r = Math.max(pixelW / img.width, pixelH / img.height);
      const w = Math.floor(img.width * r), h = Math.floor(img.height * r);
      const ox = Math.floor((pixelW - w) / 2), oy = Math.floor((pixelH - h) / 2);
      g.imageSmoothingEnabled = false; g.drawImage(img, ox, oy, w, h);
      const fitted = new Image();
      fitted.onload = () => setBgImage(fitted);
      fitted.src = c.toDataURL("image/png");
      URL.revokeObjectURL(url);
      // Forzar nombre del PNG = <name>.png
      setBgFileName(`${name}.png`);
    };
    img.src = url;
  }

  // Importar/exportar
  async function importJSON(file: File) {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as Partial<MapExport>;
      if (!Array.isArray(data.paths)) throw new Error("El JSON debe tener 'paths: P[][]'");
      setPaths(data.paths.map(pl => pl.map(p => ({ x: p.x|0, y: p.y|0 }))));
      if (typeof data.name === "string") setName(data.name);
      if (typeof data.backgroundFile === "string") setBgFileName(data.backgroundFile);
      alert("Mapa importado.");
    } catch (e: any) {
      alert("No se pudo importar JSON: " + e.message);
    }
  }

  function exportJSON() {
    // Validación: cada carril con >= 2 puntos y empieza/termina en borde
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i];
      if (p.length < 2) return alert(`Carril #${i+1}: al menos 2 puntos`);
      if (!isOnBorder(p[0]) || !isOnBorder(p[p.length-1])) {
        return alert(`Carril #${i+1}: debe empezar y terminar en el borde`);
      }
    }
    const data: MapExport = {
      name,
      tileSize: TILE_PX,
      width: WIDTH_TILES,
      height: HEIGHT_TILES,
      paths: paths.map(pl => pl.map(pt => ({
        x: clamp(pt.x, 0, WIDTH_TILES-1),
        y: clamp(pt.y, 0, HEIGHT_TILES-1)
      }))),
      backgroundFile: bgFileName,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${name}.json`; a.click(); URL.revokeObjectURL(url);
  }

  function exportPNG() {
    if (!bgImage) return alert("No hay fondo cargado.");
    const c = document.createElement("canvas"); c.width = pixelW; c.height = pixelH;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false; g.drawImage(bgImage, 0, 0, pixelW, pixelH);
    c.toBlob(b => { if (!b) return;
      const url = URL.createObjectURL(b);
      const a = document.createElement("a"); a.href = url; a.download = `${name}.png`; a.click(); URL.revokeObjectURL(url);
    }, "image/png");
  }

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-slate-50 grid grid-cols-12 gap-4 p-4">
      {/* Sidebar */}
      <aside className="col-span-12 md:col-span-3 lg:col-span-2 space-y-4">
        <div className="rounded-2xl bg-slate-900/60 p-4 shadow">
          <h2 className="text-lg font-semibold mb-3">🗺️ Editor de Mapas (Lite)</h2>
          <label className="block text-sm opacity-80 mb-1">Nombre</label>
          <input value={name} onChange={e=>setName(e.target.value)} className="w-full bg-slate-800 rounded-xl px-3 py-2 mb-3" />
          <p className="text-xs opacity-70">Dimensiones fijas: {WIDTH_TILES}×{HEIGHT_TILES} tiles • {TILE_PX}px • {pixelW}×{pixelH}px</p>
        </div>

        <div className="rounded-2xl bg-slate-900/60 p-4 shadow space-y-3">
          <h3 className="font-semibold">🖼️ Fondo</h3>
          <input type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0]; if (f) onChooseImage(f);}} />
          <div className="flex gap-2 flex-wrap">
            <button className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700" onClick={()=>setBgImage(null)}>Quitar fondo</button>
            <button className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700" onClick={exportPNG} disabled={!bgImage}>Export PNG</button>
          </div>
          <p className="text-xs opacity-70">Archivo: {bgFileName ?? "(se usará <name>.png al exportar)"}</p>
        </div>

        <div className="rounded-2xl bg-slate-900/60 p-4 shadow space-y-3">
          <h3 className="font-semibold">🛤️ Carriles</h3>
          <div className="flex flex-wrap gap-2">
            {paths.map((_, i) => (
              <button key={i} onClick={()=>setLane(i)}
                className={`px-3 py-1 rounded-xl text-sm ${i===lane?'bg-amber-700':'bg-slate-800 hover:bg-slate-700'}`}>
                #{i+1}
              </button>
            ))}
            <button className="px-3 py-1 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-sm" onClick={addLane}>+ Añadir</button>
            {paths.length>1 && (
              <button className="px-3 py-1 rounded-xl bg-rose-700 hover:bg-rose-600 text-sm" onClick={deleteLane}>Eliminar</button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm" onClick={undoLast}>↶ Deshacer punto</button>
            <button className="px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm" onClick={clearLane}>🧹 Vaciar carril</button>
          </div>
        </div>

        <div className="rounded-2xl bg-slate-900/60 p-4 shadow space-y-3">
          <h3 className="font-semibold">💾 Importar / Exportar</h3>
          <div className="flex gap-2 flex-wrap">
            <button className="px-3 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600" onClick={exportJSON}>Export JSON</button>
            <label className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 cursor-pointer">Import JSON
              <input type="file" accept="application/json" className="hidden" onChange={e=>{const f=e.target.files?.[0]; if (f) importJSON(f);}} />
            </label>
          </div>
          <p className="text-xs opacity-70">La ruta debe <b>empezar y terminar en el borde</b> del mapa.</p>
        </div>

        <div className="rounded-2xl bg-slate-900/60 p-4 shadow text-xs opacity-80">
          <p><b>Cómo usar:</b> sube un fondo, selecciona carril, haz click en la rejilla para añadir puntos. Shift o botón central para mover. Ctrl + rueda para zoom.</p>
        </div>
      </aside>

      {/* Lienzo */}
      <div className="col-span-12 md:col-span-9 lg:col-span-10 rounded-2xl bg-slate-900/60 p-2 shadow overflow-auto">
        <canvas
          ref={canvasRef}
          className="w-full h-full touch-none rounded-xl bg-black/30"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
          onContextMenu={(e)=>e.preventDefault()}
          style={{ width: pixelW*zoom+"px", height: pixelH*zoom+"px" }}
        />
      </div>
    </div>
  );
}
