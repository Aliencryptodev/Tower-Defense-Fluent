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

// Nombres EXACTOS de frames de tus atlases (PNG sin .png)
const TOWER_FRAMES = [
  'Ice Shard I', 'Frost Cannon III', 'Absolute Zero V',           // Frost
  'Flame Turret I', 'Inferno Core III', 'Phoenix Gate V',         // Fire
  'Arc Coil I', 'Tesla Grid III', 'Storm Lord V',                 // Electric
  'Thorn Vine I', 'Entangle Root III', 'World Tree V',            // Nature
  'Mana Crystal I', 'Portal Anchor III', 'Reality Rift V'         // Mystic
];

const ENEMY_FRAME = 'Goblin Scout';

// Config compacta por “familia”
type TowerCfg = { proj: string; fx: string; range: number; cooldown: number; dmg: number; projSpeed: number };
const FAMILY: Record<'frost'|'fire'|'electric'|'nature'|'mystic', TowerCfg> = {
  frost:    { proj: 'Ice Shard',      fx: 'Ice Explosion',       range: 180, cooldown: 800, dmg: 22, projSpeed: 320 },
  fire:     { proj: 'Fireball',       fx: 'Fire Explosion',      range: 170, cooldown: 900, dmg: 26, projSpeed: 300 },
  electric: { proj: 'Lightning Bolt', fx: 'Electric Discharge',  range: 190, cooldown: 700, dmg: 18, projSpeed: 380 },
  nature:   { proj: 'Poison Dart',    fx: 'Poison Cloud',        range: 160, cooldown: 650, dmg: 14, projSpeed: 360 },
  mystic:   { proj: 'Magic Missile',  fx: 'Electric Discharge',  range: 185, cooldown: 750, dmg: 20, projSpeed: 340 },
};

// Mapa “frame → familia”
const TOWER_FAMILY: Record<string, keyof typeof FAMILY> = {
  'Ice Shard I': 'frost', 'Frost Cannon III': 'frost', 'Absolute Zero V': 'frost',
  'Flame Turret I': 'fire', 'Inferno Core III': 'fire', 'Phoenix Gate V': 'fire',
  'Arc Coil I': 'electric', 'Tesla Grid III': 'electric', 'Storm Lord V': 'electric',
  'Thorn Vine I': 'nature', 'Entangle Root III': 'nature', 'World Tree V': 'nature',
  'Mana Crystal I': 'mystic', 'Portal Anchor III': 'mystic', 'Reality Rift V': 'mystic',
};

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

      type Enemy = { s: any; hp: number; speed: number; alive: boolean };
      type Tower = { s: any; cfg: TowerCfg; last: number };
      type Bullet = { s: any; vx: number; vy: number; speed: number; dmg: number; tgt: Enemy|null; life: number };

      class TD extends Phaser.Scene {
        enemies: Enemy[] = [];
        towers: Tower[] = [];
        bullets: Bullet[] = [];

        constructor(){ super('TD'); }

        preload() {
          this.load.atlas('terrain64','/assets/terrain_atlas.png','/assets/terrain_atlas.json');
          this.load.atlas('ui32','/assets/ui_atlas.png','/assets/ui_atlas.json');
          this.load.atlas('castles','/assets/castles_atlas.png','/assets/castles_atlas.json');
          this.load.atlas('towers','/assets/towers_atlas.png','/assets/towers_atlas.json');
          this.load.atlas('enemies32','/assets/enemies32_atlas.png','/assets/enemies32_atlas.json');
          this.load.atlas('projectiles','/assets/projectiles_atlas.png','/assets/projectiles_atlas.json');
          this.load.atlas('fx','/assets/effects_atlas.png','/assets/effects_atlas.json');
        }

        create() {
          // Grid
          const g = this.add.graphics(); g.lineStyle(1, 0x333333, 0.2);
          for (let x=0; x<GRID_W*TILE; x+=TILE) for (let y=0; y<GRID_H*TILE; y+=TILE) g.strokeRect(x,y,TILE,TILE);

          // Camino demo
          const grid = [ Array(GRID_W).fill(1), Array(GRID_W).fill(0), Array(GRID_W).fill(1) ];
          if (this.textures.exists('terrain64')) renderPath(this, grid, 'grass');
          else { const f = this.add.graphics(); f.fillStyle(0x444444,1); for (let x=0;x<GRID_W;x++){ f.fillRect(x*TILE,0,TILE,TILE); f.fillRect(x*TILE,2*TILE,TILE,TILE);} }

          // HUD
          this.add.image(24, 24, 'ui32', 'icon_gold').setScrollFactor(0).setDepth(1000).setOrigin(0,0);
          this.add.image(24, 56, 'ui32', 'icon_crystals').setScrollFactor(0).setDepth(1000).setOrigin(0,0);
          this.add.image(24, 88, 'ui32', 'icon_energy').setScrollFactor(0).setDepth(1000).setOrigin(0,0);
          this.add.image(24,120, 'ui32', 'icon_xp').setScrollFactor(0).setDepth(1000).setOrigin(0,0);

          // Colocar torres
          this.input.on('pointerdown', (p: any) => {
            const gx = Math.floor(p.x / TILE), gy = Math.floor(p.y / TILE);
            if (gx<0||gx>=GRID_W||gy<0||gy>=GRID_H) return;
            const x = gx*TILE + TILE/2, y = gy*TILE + TILE/2;
            const frame = TOWER_FRAMES[towerIdx % TOWER_FRAMES.length];
            const fam = TOWER_FAMILY[frame];
            const cfg = FAMILY[fam];
            const spr = this.add.image(x, y, 'towers', frame).setDepth(y);
            this.towers.push({ s: spr, cfg, last: 0 });
            // círculo de rango (sutil)
            const ring = this.add.circle(x, y, cfg.range, 0x00ffff, 0.05).setDepth(1);
            this.time.delayedCall(250, () => ring.destroy());
          });

          // Spawns de enemigos continuos
          const laneY = TILE/2;
          this.time.addEvent({
            delay: 800, loop: true, callback: () => {
              const eSpr = this.add.image(GRID_W*TILE + 24, laneY, 'enemies32', ENEMY_FRAME);
              eSpr.setDepth(eSpr.y);
              const enemy: Enemy = { s: eSpr, hp: 60, speed: 60, alive: true };
              this.enemies.push(enemy);
            }
          });
        }

        // Utilidad: primer enemigo dentro de rango
        getTarget(x:number, y:number, range:number): Enemy | null {
          let best: Enemy | null = null;
          let bestD = Infinity;
          for (const e of this.enemies) {
            if (!e.alive) continue;
            const dx = e.s.x - x, dy = e.s.y - y;
            const d = Math.hypot(dx, dy);
            if (d <= range && d < bestD) { best = e; bestD = d; }
          }
          return best;
        }

        shoot(from: {x:number,y:number}, cfg: TowerCfg, target: Enemy) {
          const b = this.add.image(from.x, from.y, 'projectiles', cfg.proj).setDepth(500);
          const dx = target.s.x - from.x, dy = target.s.y - from.y;
          const len = Math.hypot(dx, dy) || 1;
          const vx = (dx/len) * cfg.projSpeed;
          const vy = (dy/len) * cfg.projSpeed;
          this.bullets.push({ s: b, vx, vy, speed: cfg.projSpeed, dmg: cfg.dmg, tgt: target, life: 2000 });
        }

        hit(target: Enemy, x:number, y:number, fxFrame: string, dmg:number) {
          target.hp -= dmg;
          const fx = this.add.image(x, y, 'fx', fxFrame).setDepth(900);
          this.time.delayedCall(120, () => fx.destroy());
          if (target.hp <= 0 && target.alive) {
            target.alive = false;
            target.s.destroy();
          }
        }

        update(_t: number, dtMs: number) {
          const dt = dtMs / 1000;

          // mover enemigos
          for (const e of this.enemies) {
            if (!e.alive) continue;
            e.s.x -= e.speed * dt;
            if (e.s.x < -40) { e.alive = false; e.s.destroy(); }
          }
          // limpiar array
          this.enemies = this.enemies.filter(e => e.alive || e.s.active);

          // torres → disparo si cooldown listo
          for (const t of this.towers) {
            t.last += dtMs;
            if (t.last < t.cfg.cooldown) continue;
            const trg = this.getTarget(t.s.x, t.s.y, t.cfg.range);
            if (!trg) continue;
            this.shoot({ x: t.s.x, y: t.s.y }, t.cfg, trg);
            t.last = 0;
          }

          // proyectiles
          for (const b of this.bullets) {
            b.life -= dtMs;
            b.s.x += b.vx * dt;
            b.s.y += b.vy * dt;
            // impacto por distancia al target
            if (b.tgt && b.tgt.alive) {
              const dx = b.tgt.s.x - b.s.x, dy = b.tgt.s.y - b.s.y;
              if (dx*dx + dy*dy < 18*18) {
                const family = Object.values(FAMILY).find(f => f.proj === b.s.frame.name) ?? FAMILY.fire;
                this.hit(b.tgt, b.s.x, b.s.y, family.fx, b.dmg);
                b.life = 0;
              }
            }
            // fuera de pantalla / sin vida
            if (b.life <= 0 || b.s.x < -40 || b.s.x > GRID_W*TILE+40 || b.s.y < -40 || b.s.y > GRID_H*TILE+40) {
              b.s.destroy();
              b.life = -1;
            }
          }
          this.bullets = this.bullets.filter(b => b.life > 0);
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
  }, []); // <-- no dependencias (no re-inicializa Phaser al cambiar torre)

  // teclado: 1–5 cambia familia, flechas cambian frame exacto
  useEffect(() => {
    const groups = [
      [0,1,2], [3,4,5], [6,7,8], [9,10,11], [12,13,14]
    ];
    const onKey = (e: KeyboardEvent) => {
      const idx = Number(e.key) - 1;
      if (idx >= 0 && idx < groups.length) setTowerIdx(groups[idx][0]);
      if (e.key === 'ArrowLeft')  setTowerIdx(i => (i + TOWER_FRAMES.length - 1) % TOWER_FRAMES.length);
      if (e.key === 'ArrowRight') setTowerIdx(i => (i + 1) % TOWER_FRAMES.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
      <div style={{ color:'#bbb', fontSize:12 }}>
        Torre actual: <b>{TOWER_FRAMES[towerIdx]}</b> — 1–5 cambia familia, ← → torre
      </div>
      <div ref={hostRef} />
    </div>
  );
}

export default dynamic(() => Promise.resolve(BattleClient), { ssr: false });
