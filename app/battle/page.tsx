'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

const TILE = 64;
const GRID_W = 18;
const GRID_H = 9;

const TERRAIN_FRAMES = {
  grass: 'Grass Path',
  snow: 'Snow Path',
  stone: 'Stone Path',
  lava: 'Lava Path',
} as const;

// Listas de frames que EXISTEN en tus atlases (igual al nombre del PNG sin .png)
const TOWER_FRAMES = [
  'Ice Shard I', 'Frost Cannon III', 'Absolute Zero V',           // Frost
  'Flame Turret I', 'Inferno Core III', 'Phoenix Gate V',         // Fire
  'Arc Coil I', 'Tesla Grid III', 'Storm Lord V',                 // Electric
  'Thorn Vine I', 'Entangle Root III', 'World Tree V',            // Nature
  'Mana Crystal I', 'Portal Anchor III', 'Reality Rift V'         // Mystic
];

const ENEMY_FRAME = 'Goblin Scout'; // usa enemigos_32

function drawPathCell(scene: any, gx: number, gy: number, biome: keyof typeof TERRAIN_FRAMES, mask: number) {
  const cx = gx * TILE + TILE / 2, cy = gy * TILE + TILE / 2;
  const frame = TERRAIN_FRAMES[biome];
  const horiz = (mask & 2) || (mask & 8);
  const vert  = (mask & 1) || (mask & 4);
  if (!horiz && !vert) { scene.add.image(cx, cy, 'terrain64', frame).setDepth(0); return; }
  if (horiz) scene.add.image(cx, cy, 'terrain64', frame).setAngle(0).setDepth(0);
  if (vert)  scene.add.image(cx, cy, 'terrain64', frame).setAngle(90).setDepth(0);
}

function renderPath(scene: any, grid: number[][], biome: keyof typeof TERRAIN_FRAMES) {
  const H = grid.length, W = grid[0].length;
  const v = (x:number,y:number)=> (x>=0&&x<W&&y>=0&&y<H&&grid[y][x]===1)?1:0;
  for (let y=0; y<H; y++) for (let x=0; x<W; x++) {
    if (!grid[y][x]) continue;
    const mask = (v(x,y-1)?1:0)+(v(x+1,y)?2:0)+(v(x,y+1)?4:0)+(v(x-1,y)?8:0);
    drawPathCell(scene, x, y, biome, mask);
  }
}

function BattleClient() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<any>(null);
  const [towerIdx, setTowerIdx] = useState(0);

  useEffect(() => {
    let Phaser: any;
    let destroyed = false;

    (async () => {
      const mod = await import('phaser');
      Phaser = mod.default ?? mod;

      if (!hostRef.current || destroyed || gameRef.current) return;

      class TD extends Phaser.Scene {
        placed: any[] = [];
        constructor(){ super('TD'); }

        preload() {
          this.load.atlas('terrain64','/assets/terrain_atlas.png','/assets/terrain_atlas.json'); // opcional
          this.load.atlas('ui32','/assets/ui_atlas.png','/assets/ui_atlas.json');
          this.load.atlas('castles','/assets/castles_atlas.png','/assets/castles_atlas.json');
          this.load.atlas('towers','/assets/towers_atlas.png','/assets/towers_atlas.json');
          this.load.atlas('enemies32','/assets/enemies32_atlas.png','/assets/enemies32_atlas.json');
          this.load.atlas('projectiles','/assets/projectiles_atlas.png','/assets/projectiles_atlas.json');
          this.load.atlas('fx','/assets/effects_atlas.png','/assets/effects_atlas.json');
        }

        create() {
          // Grid guía
          const g = this.add.graphics(); g.lineStyle(1, 0x333333, 0.2);
          for (let x=0; x<GRID_W*TILE; x+=TILE) for (let y=0; y<GRID_H*TILE; y+=TILE) g.strokeRect(x,y,TILE,TILE);

          // Camino demo
          const grid = [ Array(GRID_W).fill(1), Array(GRID_W).fill(0), Array(GRID_W).fill(1) ];
          if (this.textures.exists('terrain64')) {
            renderPath(this, grid, 'grass');
          } else {
            const fallback = this.add.graphics(); fallback.fillStyle(0x444444, 1);
            for (let x=0; x<GRID_W; x++) { fallback.fillRect(x*TILE, 0, TILE, TILE); fallback.fillRect(x*TILE, 2*TILE, TILE, TILE); }
          }

          // HUD (iconos)
          this.add.image(24, 24, 'ui32', 'icon_gold').setScrollFactor(0).setDepth(1000).setOrigin(0,0);
          this.add.image(24, 56, 'ui32', 'icon_crystals').setScrollFactor(0).setDepth(1000).setOrigin(0,0);
          this.add.image(24, 88, 'ui32', 'icon_energy').setScrollFactor(0).setDepth(1000).setOrigin(0,0);
          this.add.image(24,120, 'ui32', 'icon_xp').setScrollFactor(0).setDepth(1000).setOrigin(0,0);

          // Colocar torres: usa el frame estático que existe
          this.input.on('pointerdown', (p: any) => {
            const gx = Math.floor(p.x / TILE), gy = Math.floor(p.y / TILE);
            if (gx<0||gx>=GRID_W||gy<0||gy>=GRID_H) return;
            const x = gx*TILE + TILE/2, y = gy*TILE + TILE/2;
            const frame = TOWER_FRAMES[towerIdx % TOWER_FRAMES.length];
            const t = this.add.image(x, y, 'towers', frame);
            t.setDepth(y);
            this.placed.push(t);
          });

          // Spawnea enemigos estáticos que cruzan la pantalla
          this.time.delayedCall(500, () => {
            const y = TILE/2;
            const startX = GRID_W*TILE + 40;
            for (let i=0; i<8; i++) {
              const e = this.add.image(startX + i*50, y, 'enemies32', ENEMY_FRAME);
              e.setDepth(e.y);
              this.tweens.add({ targets: e, x: -40, duration: 8000 + i*200, onComplete: () => e.destroy() });
            }
          });
        }
      }

      gameRef.current = new Phaser.Game({
        type: Phaser.AUTO,
        width: GRID_W * TILE,
        height: GRID_H * TILE,
        parent: hostRef.current!,
        backgroundColor: '#0e0e0e',
        scene: [TD],
        render: { pixelArt: true, antialias: false }
      });
    })();

    return () => { destroyed = true; gameRef.current?.destroy(true); gameRef.current = null; };
  }, [towerIdx]);

  // Cambiar torre con teclado (1–5 por familias)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const groups = [
        [0,1,2],     // Frost
        [3,4,5],     // Fire
        [6,7,8],     // Electric
        [9,10,11],   // Nature
        [12,13,14],  // Mystic
      ];
      const idx = Number(e.key) - 1;
      if (idx >= 0 && idx < groups.length) setTowerIdx(groups[idx][0]); // primer frame del grupo
      if (e.key === 'ArrowLeft')  setTowerIdx(i => (i + TOWER_FRAMES.length - 1) % TOWER_FRAMES.length);
      if (e.key === 'ArrowRight') setTowerIdx(i => (i + 1) % TOWER_FRAMES.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
      <div style={{ color:'#bbb', fontSize:12 }}>
        Torre actual: <b>{TOWER_FRAMES[towerIdx]}</b> — cambia con 1–5, ← →
      </div>
      <div ref={hostRef} />
    </div>
  );
}

export default dynamic(() => Promise.resolve(BattleClient), { ssr: false });
