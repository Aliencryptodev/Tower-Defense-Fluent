// lib/pathMask.ts
export type GridPoint = { x: number; y: number };

export function bresenham(a: GridPoint, b: GridPoint): GridPoint[] {
  const cells: GridPoint[] = [];
  let x0 = a.x, y0 = a.y, x1 = b.x, y1 = b.y;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    cells.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 <  dx) { err += dx; y0 += sy; }
  }
  return cells;
}

/**
 * Crea una máscara de celdas bloqueadas a partir de todas las rutas.
 * @param paths  lista de rutas (en coords de tile)
 * @param thickness 0 = solo la línea; 1 = añade celdas adyacentes (margen)
 */
export function maskFromPaths(paths: GridPoint[][], thickness = 0): Set<string> {
  const s = new Set<string>();
  const add = (x: number, y: number) => s.add(`${x},${y}`);
  for (const path of paths) {
    for (let i = 1; i < path.length; i++) {
      const seg = bresenham(path[i - 1], path[i]);
      for (const c of seg) {
        add(c.x, c.y);
        if (thickness > 0) {
          add(c.x + 1, c.y); add(c.x - 1, c.y);
          add(c.x, c.y + 1); add(c.x, c.y - 1);
        }
      }
    }
  }
  return s;
}
