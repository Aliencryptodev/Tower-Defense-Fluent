"use client";

import React, { useEffect, useRef, useState } from "react";

type P = { x: number; y: number };
type MapLite = {
  name: string;
  tileSize: number;
  width: number;
  height: number;
  path: P[];             // una sola ruta
  backgroundFile?: string; // ej: "mi_mapa.png" (subido al repo)
};

// ======= CONFIGURACIÓN FIJA (dimensiones uniformes) =======
const WIDTH_TILES = 16;
const HEIGHT_TILES = 9;
const TILE_PX = 64;
// ===========================================================

const clamp = (n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const snapToGrid = (px:number,py:number,tile:number):[number,number]=>[Math.floor(px/tile),Math.floor(py/tile)];

export default function Page() {
  const [name, setName] = useState("new_map");
  const [path, setPath] = useState<P[]>([]);
  const [bgImage, setBgImage] = useState<HTMLImageElement|null>(null);
  const [bgFileName, setBgFileName] = useState<string|undefined>();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({x:0,y:0});
  const panning = useRef(false);
  const lastPan = useRef({x:0,y:0});
  const canvasRef = useRef<HTMLCanvasElement|null>(null);

  const pixelW = WIDTH_TILES * TILE_PX;
  const pixelH = HEIGHT_TILES * TILE_PX;

  // Dibujo
  useEffect(()=>{
    const c = canvasRef.current; if(!c) return;
    const g = c.getContext("2d"); if(!g) return;
    c.width = pixelW*zoom; c.height = pixelH*zoom;
    g.save(); g.translate(pan.x, pan.y); g.scale(zoom, zoom);

    // Fondo
    if (bgImage) g.drawImage(bgImage, 0, 0, pixelW, pixelH);
    else { g.fillStyle = "#1b1f2a"; g.fillRect(0,0,pixelW,pixelH); }

    // Grid ligera
    g.globalAlpha = 0.25; g.strokeStyle = "#ffffff"; g.lineWidth = 1;
    for (let x=0; x<=WIDTH_TILES; x++){ g.beginPath(); g.moveTo(x*TILE_PX+0.5,0); g.lineTo(x*TILE_PX+0.5,pixelH); g.stroke(); }
    for (let y=0; y<=HEIGHT_TILES; y++){ g.beginPath(); g.moveTo(0,y*TILE_PX+0.5); g.lineTo(pixelW,y*TILE_PX+0.5); g.stroke(); }
    g.globalAlpha = 1;

    // Ruta
    if (path.length >= 1) {
      g.strokeStyle = "#ffd166"; g.lineWidth = Math.max(2, TILE_PX*0.08);
      g.lineJoin = "round"; g.lineCap = "round";
      g.beginPath();
      g.moveTo(path[0].x*TILE_PX + TILE_PX/2, path[0].y*TILE_PX + TILE_PX/2);
      for (let i=1;i<path.length;i++){
        g.lineTo(path[i].x*TILE_PX + TILE_PX/2, path[i].y*TILE_PX + TILE_PX/2);
      }
      g.stroke();
      // puntos (verde inicio, azul fin, amarillos intermedios)
      path.forEach((p,i)=>{
        g.fillStyle = i===0 ? "#4ade80" : (i===path.length-1 ? "#60a5fa" : "#ffd166");
        g.beginPath();
        g.arc(p.x*TILE_PX+TILE_PX/2, p.y*TILE_PX+TILE_PX/2, Math.max(3,TILE_PX*0.12), 0, Math.PI*2);
        g.fill();
      });
    }
    g.restore();
  },[bgImage, path, zoom, pan]);

  // Interacción
  function canvasToWorld(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left - pan.x) / zoom;
    const y = (e.clientY - rect.top - pan.y) / zoom;
    return { x, y };
  }
  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.shiftKey) { // botón central o shift = mover
      panning.current = true;
      lastPan.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      return;
    }
    const { x, y } = canvasToWorld(e);
    const [gx, gy] = snapToGrid(x, y, TILE_PX);
    if (gx<0||gy<0||gx>=WIDTH_TILES||gy>=HEIGHT_TILES) return;
    setPath(prev => [...prev, { x: gx, y: gy }]);
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (panning.current) { setPan({ x: e.clientX - lastPan.current.x, y: e.clientY - lastPan.current.y }); }
  }
  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    panning.current = false; e.currentTarget.releasePointerCapture(e.pointerId);
  }
  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    if (e.ctrlKey) {
      const before = zoom;
      const next = clamp(zoom * (e.deltaY>0?0.9:1.1), 0.5, 3);
      setZoom(next);
      const rect = e.currentTarget.getBoundingClientRect();
      const cx = e.clientX - rect.left; const cy = e.clientY - rect.top;
      setPan(p => ({ x: cx - (cx - p.x) * (next/before), y: cy - (cy - p.y) * (next/before) }));
      e.preventDefault();
    }
  }

  // Imagen
  function onChooseImage(file: File) {
    const safe = file.name.replace(/\s+/g, "_");
    setBgFileName(safe.endsWith(".png")||safe.endsWith(".jpg") ? safe : `${name}.png`);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Ajuste tipo cover a tamaño fijo
      const c = document.createElement("canvas"); c.width = pixelW; c.height = pixelH;
      const g = c.getContext("2d")!;
      const r = Math.max(pixelW/img.width, pixelH/img.height);
      const w = Math.floor(img.width*r), h = Math.floor(img.height*r);
      const ox = Math.floor((pixelW - w)/2), oy = Math.floor((pixelH - h)/2);
      g.imageSmoothingEnabled = false; g.drawImage(img, ox, oy, w, h);
      const fitted = new Image();
      fitted.onload = () => setBgImage(fitted);
      fitted.src = c.toDataURL("image/png");
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  // Exportar JSON
  function exportJSON() {
    const data: MapLite = {
      name,
      tileSize: TILE_PX,
      width: WIDTH_TILES,
      height: HEIGHT_TILES,
      path: path.map(p => ({ x: clamp(p.x,0,WIDTH_TILES-1), y: clamp(p.y,0,HEIGHT_TILES-1) })),
      backgroundFile: bgFileName,
    };
    const blob = new Blob([JSON.stringify(data,null,2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${name}.json`; a.click(); URL.revokeObjectURL(url);
  }

  // Exportar PNG (para subir al repo con el mismo nombre)
  function exportPNG() {
    if (!bgImage) return;
    const c = document.createElement("canvas"); c.width = pixelW; c.height = pixelH;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false; g.drawImage(bgImage, 0, 0, pixelW, pixelH);
    c.toBlob(b => { if (!b) return; const url = URL.createObjectURL(b); const a = document.createElement("a"); a.href=url; a.download = `${name}.png`; a.click(); URL.revokeObjectURL(url); }, "image/png");
  }

  function resetPath(){ setPath([]); }

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-slate-50 grid grid-cols-12 gap-4 p-4">
      <aside className="col-span-12 md:col-span-3 lg:col-span-2 space-y-4">
        <div className="rounded-2xl bg-slate-900/60 p-4 shadow">
          <h2 className="text-lg font-semibold mb-3">🗺️ Editor Lite</h2>
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
          <p className="text-xs opacity-70">Archivo: {bgFileName ?? "(sin nombre)"}</p>
        </div>

        <div className="rounded-2xl bg-slate-900/60 p-4 shadow space-y-3">
          <h3 className="font-semibold">💾 Exportar</h3>
          <button className="px-3 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600" onClick={exportJSON}>Export JSON</button>
          <button className="ml-2 px-3 py-2 rounded-xl bg-rose-700 hover:bg-rose-600" onClick={resetPath}>Reset ruta</button>
        </div>

        <div className="rounded-2xl bg-slate-900/60 p-4 shadow text-xs opacity-80">
          <p><b>Cómo usar:</b> sube una imagen, haz click en la rejilla para añadir puntos de la ruta. Shift o botón central para mover. Ctrl + rueda para zoom.</p>
        </div>
      </aside>

      <div className="col-span-12 md:col-span-9 lg:col-span-10 rounded-2xl bg-slate-900/60 p-2 shadow overflow-auto">
        <canvas
          ref={canvasRef}
          className="w-full h-full touch-none rounded-xl bg-black/30"
          style={{ width: pixelW*zoom+"px", height: pixelH*zoom+"px" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
        />
      </div>
    </div>
  );
}
