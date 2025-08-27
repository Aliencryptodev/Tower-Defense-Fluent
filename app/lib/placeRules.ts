import type { GridPoint } from "@/lib/pathMask";
import { maskFromPaths } from "@/lib/pathMask";

export type TDMap = {
  width: number; height: number; tileSize: number;
  paths?: GridPoint[][];
  path?: GridPoint[];          // compatibilidad con mapas antiguos
  noBuild?: GridPoint[];
};

// Construye el set de celdas bloqueadas a partir del mapa
export function buildBlockedSet(map: TDMap, thickness = 0): Set<string> {
  const paths = Array.isArray(map.paths) ? map.paths : (map.path ? [map.path] : []);
  const pathMask = maskFromPaths(paths, thickness);
  const extraMask = new Set<string>((map.noBuild ?? []).map(p => `${p.x},${p.y}`));
  return new Set<string>([...pathMask, ...extraMask]);
}

// Valida colocación
export function createCanPlace(map: TDMap, blocked: Set<string>, towersGrid?: (any|null)[][]) {
  return (gx:number, gy:number) => {
    if (gx<0 || gy<0 || gx>=map.width || gy>=map.height) return false;
    if (blocked.has(`${gx},${gy}`)) return false;
    if (towersGrid?.[gy]?.[gx]) return false;
    return true;
  };
}
