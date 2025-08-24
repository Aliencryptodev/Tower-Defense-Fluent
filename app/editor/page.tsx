'use client';

import React, { useMemo, useRef, useState } from 'react';

const TILE = 64;
const GRID_W = 18;
const GRID_H = 10;

export default function EditorPage() {
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [terrainKey, setTerrainKey] = useState('grass'); // placeholder
  const [paths, setPaths] = useState<{ x: number; y: number }[][]>([[], []]);
  const [maskRects, setMaskRects] = useState<{ x: number; y: number; w: number; h: number }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    setBgUrl(url); // ✅ ahora se ve siempre
  };

  const addPathPoint = (lane: number, x: number, y: number) => {
    setPaths(prev => {
      const next = prev.map(a => [...a]) as any;
      next[lane].push({ x, y });
      return next;
    });
  };

  const exportJSON = () => {
    const data = {
      name: 'custom',
      tileSize: TILE,
      width: GRID_W,
      height: GRID_H,
      terrain: terrainKey,
      buildMask: maskRects,
      paths,
      waves: {
        baseCount: 5, countPerWave: 2,
        baseHP: 30, hpPerWave: 6,
        baseSpeed: 90, speedPerWave: 5,
        spawnDelayMs: 420, rewardBase: 6
      }
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `map_${Date.now()}.json`;
    a.click();
  };

  const wpx = GRID_W * TILE, hpx = GRID_H * TILE;

  const gridLines = useMemo(() => {
    const verticals = Array.from({ length: GRID_W + 1 }, (_, i) => i * TILE);
    const horizontals = Array.from({ length: GRID_H + 1 }, (_, i) => i * TILE);
    return { verticals, horizontals };
  }, []);

  return (
    <main className="min-h-screen bg-[#0c0e12] text-white">
      <div className="max-w-6xl mx-auto p-6">
        <h1 className="text-xl font-semibold mb-3">Editor de Mapas (64px · {GRID_W}×{GRID_H})</h1>
        <div className="flex gap-3 items-center mb-4">
          <input ref={fileRef} type="file" accept="image/*" onChange={onPick} />
          <select
            className="bg-[#131823] border border-[#22304a] rounded px-2 py-1 text-sm"
            value={terrainKey}
            onChange={(e) => setTerrainKey(e.target.value)}
          >
            <option value="grass_dual">Grass Dual</option>
            <option value="sand_dual">Sand Dual</option>
            <option value="rock_dual">Rock Dual</option>
            <option value="lava_dual">Lava Dual</option>
          </select>
          <button
            onClick={exportJSON}
            className="px-3 py-1 rounded bg-[#1f2b46] border border-[#2e4164] text-sm hover:bg-[#25365a]"
          >
            Exportar JSON
          </button>
        </div>

        <div
          className="relative rounded-2xl overflow-hidden border border-[#22304a]"
          style={{ width: wpx, height: hpx, background: '#0a0e14' }}
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const tx = Math.floor(mx / TILE);
            const ty = Math.floor(my / TILE);
            addPathPoint(0, tx, ty); // por defecto lane 0
          }}
        >
          {/* Fondo */}
          {bgUrl && (
            <img
              src={bgUrl}
              alt="Fondo"
              className="absolute inset-0 object-cover"
              style={{ width: wpx, height: hpx }}
            />
          )}

          {/* Grid */}
          {gridLines.verticals.map((x) => (
            <div key={'v'+x} className="absolute top-0 bottom-0" style={{ left: x, width: 1, background: '#1e2a40' }} />
          ))}
          {gridLines.horizontals.map((y) => (
            <div key={'h'+y} className="absolute left-0 right-0" style={{ top: y, height: 1, background: '#1e2a40' }} />
          ))}

          {/* Path preview */}
          {paths[0].map((p, i) => (
            <div key={i} className="absolute rounded-full" style={{
              left: p.x * TILE + TILE/2 - 5,
              top:  p.y * TILE + TILE/2 - 5,
              width: 10, height: 10, background: '#65ff9b', boxShadow: '0 0 10px #65ff9b'
            }} />
          ))}
        </div>
        <p className="text-xs text-[#8aa4d6] mt-2">
          Tip: haz click para añadir puntos del camino (lane 0). Pronto añadimos lanes múltiples y pinceles.
        </p>
      </div>
    </main>
  );
}
