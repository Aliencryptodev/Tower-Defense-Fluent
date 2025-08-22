'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

const TILE = 64;
const GRID_W = 18;
const GRID_H = 9;

const INITIAL_GOLD = 100;
const INITIAL_LIVES = 20;

const TERRAIN_FRAMES = {
  grass: 'Grass Path',
  snow: 'Snow Path',
  stone: 'Stone Path',
  lava: 'Lava Path',
} as const;

// Nombres EXACTOS (igual al PNG sin .png)
const TOWER_FRAMES = [
  'Ice Shard I', 'Frost Cannon III', 'Absolute Zero V',           // Frost
  'Flame Turret I', 'Inferno Core III', 'Phoenix Gate V',         // Fire
  'Arc Coil I', 'Tesla Grid III', 'Storm Lord V',                 // Electric
  'Thorn Vine I', 'Entangle Root III', 'World Tree V',            // Nature
  'Mana Crystal I', 'Portal Anchor III', 'Reality Rift V'         // Mystic
] as const;

const ENEMIES32 = ['Goblin Scout','Orc Warrior','Skeleton Archer','Wolf Rider'] as const;

type TowerCfg = { proj: string; fx: string; range: number; cooldown: number; dmg: number; projSpeed: number };
const FAMILY: Record<'frost'|'fire'|'electric'|'nature'|'mystic', TowerCfg> = {
  frost:    { proj: 'Ice Shard',      fx: 'Ice Explosion',       range: 180, cooldown: 800, dmg: 22, projSpeed: 320 },
  fire:     { proj: 'Fireball',       fx: 'Fire Explosion',      range: 170, cooldown: 900, dmg: 26, projSpeed: 300 },
  electric: { proj: 'Lightning Bolt', fx: 'Electric Discharge',  range: 190, cooldown: 700, dmg: 18, projSpeed: 380 },
  nature:   { proj: 'Poison Dart',    fx: 'Poison Cloud',        range: 160, cooldown: 650, dmg: 14, projSpeed: 360 },
  mystic:   { proj: 'Magic Missile',  fx: 'Electric Discharge',  range: 185, cooldown: 750, dmg: 20, projSpeed: 340 },
};

// Coste por familia
const COST: Record<keyof typeof FAMILY, number> = {
  frost: 35, fire: 40, electric: 45, nature: 30, mystic: 40
};

// Mapa frame → familia
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

// ---- WAVE CONFIG ----
type Wave = { name: string; count: number; gapMs: number; enemy: typeof ENEMIES32[number]; hp: number; speed: number; lanes: number[] };
const WAVES: Wave[] = [
  { name: 'Goblins',        count: 12, gapMs: 700, enemy: 'Goblin Scout',    hp: 50,  speed: 60, lanes: [0] },
  { name: 'Orc Patrol',     count: 10, gapMs: 800, enemy: 'Orc Warrior',     hp: 80,  speed: 58, lanes: [2] },
  { name: 'Skels & Wolves', count: 16, gapMs: 600, enemy: 'Skeleton Archer', hp: 65,  speed: 62, lanes: [0,2] },
  { name: 'Wolf Riders',    count: 16, gapMs: 550, enemy: 'Wolf Rider',      hp: 75,  speed: 80, lanes: [0,2] },
  { name: 'Mixed Rush',     count: 24, gapMs: 500, enemy: 'Goblin Scout',    hp: 95,  speed: 72, lanes: [0,2] },
];

function BattleClient() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<any>(null);

  // Índice visible en UI
  const [towerIdx, setTowerIdx] = useState(0);
  // La escena lee SIEMPRE este valor (no se “congela”)
  const selectedRef = useRef(0);
  const setSelected = (i: number) => { selectedRef.current = i; setTowerIdx(i); };

  useEffect(() => {
    let Phaser: any;
    let destroyed = false;

    (async () => {
      const mod = await import('phaser');
      Phaser = mod.default ?? mod;
      if (!hostRef.current || destroyed || gameRef.current) return;

      type Enemy = { s: any; hp: number; speed: number; alive: boolean };
      type Tower = { s: any; cfg: TowerCfg; last: number; gx: number; gy: number };
      type Bullet = { s: any; vx: number; vy: number; speed: number; dmg: number; tgt: Enemy|null; life: number };

      class TD extends Phaser.Scene {
        enemies: Enemy[] = [];
        towers: Tower[] = [];
        bullets: Bullet[] = [];
        grid: number[][] = [];
        occupied = new Set<string>();

        gold = INITIAL_GOLD;
        lives = INITIAL_LIVES;
        goldText: any;
        livesText: any;

        // waves
        waveIndex = 0;
        waveText: any;
        hintText: any;
        waveActive = false;
        spawnsDone = false;
        spawnCount = 0;

        // control de tiempo
        paused = false;
        timeScale = 1;

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
          // Grid visual
          const g = this.add.graphics(); g.lineStyle(1, 0x333333, 0.2);
          for (let x=0; x<GRID_W*TILE; x+=TILE) for (let y=0; y<GRID_H*TILE; y+=TILE) g.strokeRect(x,y,TILE,TILE);

          // Camino (dos carriles: fila 0 y fila 2)
          this.grid = [ Array(GRID_W).fill(1), Array(GRID_W).fill(0), Array(GRID_W).fill(1) ];
          if (this.textures.exists('terrain64')) renderPath(this, this.grid, 'grass');
          else { const f = this.add.graphics(); f.fillStyle(0x444444,1); for (let x=0;x<GRID_W;x++){ f.fillRect(x*TILE,0,TILE,TILE); f.fillRect(x*TILE,2*TILE,TILE,TILE);} }

          // HUD
          this.add.image(24, 24, 'ui32', 'icon_gold').setOrigin(0,0).setDepth(1000);
          this.add.image(24, 56, 'ui32', 'icon_crystals').setOrigin(0,0).setDepth(1000);
          this.add.image(24, 88, 'ui32', 'icon_energy').setOrigin(0,0).setDepth(1000);
          this.add.image(24,120, 'ui32', 'icon_xp').setOrigin(0,0).setDepth(1000);

          this.goldText = this.add.text(56, 24, String(this.gold), { fontFamily: 'monospace', fontSize: '14px', color: '#ffd76a' }).setDepth(1000).setOrigin(0,0);
          this.livesText = this.add.text(56, 88, String(this.lives), { fontFamily: 'monospace', fontSize: '14px', color: '#ff6a6a' }).setDepth(1000).setOrigin(0,0);

          this.waveText = this.add.text(GRID_W*TILE - 16, 16, `Wave 0/${WAVES.length}`, { fontFamily: 'monospace', fontSize: '14px', color: '#cfe4ff' }).setDepth(1000).setOrigin(1,0);
          this.hintText = this.add.text(GRID_W*TILE/2, GRID_H*TILE - 8,
            'N: siguiente ola · Espacio: pausa · F: 2× velocidad · 1–5/←→: torre',
            { fontFamily: 'monospace', fontSize: '12px', color: '#9aa' }
          ).setDepth(1000).setOrigin(0.5,1);

          // Colocar torres (no sobre camino ni ocupadas; cobra coste)
          this.input.on('pointerdown', (p: any) => {
            if (this.paused) return;
            const gx = Math.floor(p.x / TILE), gy = Math.floor(p.y / TILE);
            if (gx<0||gx>=GRID_W||gy<0||gy>=GRID_H) return;
            if (this.grid[gy]?.[gx] === 1) { this.flashText('No camino', p.x, p.y); return; }
            const key = `${gx},${gy}`;
            if (this.occupied.has(key)) { this.flashText('Ocupado', p.x, p.y); return; }

            const idx = selectedRef.current % TOWER_FRAMES.length;
            const frame = TOWER_FRAMES[idx];
            const fam = TOWER_FAMILY[frame];
            const cfg = FAMILY[fam];
            const cost = COST[fam];

            if (this.gold < cost) {
              this.flashText('Sin oro', p.x, p.y, '#ff5050');
              this.flashHUD(this.goldText, '#ff5050');
              return;
            }

            this.gold -= cost; this.goldText.setText(String(this.gold));

            const x = gx*TILE + TILE/2, y = gy*TILE + TILE/2;
            const spr = this.add.image(x, y, 'towers', frame).setDepth(y);
            this.towers.push({ s: spr, cfg, last: 0, gx, gy });
            this.occupied.add(key);

            const ring = this.add.circle(x, y, cfg.range, 0x00ffff, 0.05).setDepth(1);
            this.time.delayedCall(250, () => ring.destroy());
          });

          // Controles globales
          this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
            if (e.key === ' ' || e.key === 'Spacebar') { // pausa
              this.togglePause();
            } else if (e.key === 'f' || e.key === 'F') {
              this.toggleSpeed();
            } else if (e.key === 'n' || e.key === 'N') {
              this.startNextWave();
            }
          });

          // Empezamos mostrando “pulsa N”
          this.flashCenter(`Pulsa N para empezar`, '#cfe4ff');
        }

        // --- util UI ---
        flashText(msg: string, x: number, y: number, color = '#ffd76a') {
          const t = this.add.text(x, y - 14, msg, { fontFamily: 'monospace', fontSize: '12px', color }).setDepth(1200).setOrigin(0.5,1);
          this.tweens.add({ targets: t, y: y - 34, alpha: 0, duration: 600, onComplete: () => t.destroy() });
        }
        flashHUD(txt: any, color: string) {
          const orig = txt.style.color;
          txt.setStyle({ color });
          this.time.delayedCall(160, () => txt.setStyle({ color: orig }));
        }
        flashCenter(msg: string, color = '#ffd76a') {
          const bx = this.add.rectangle(GRID_W*TILE/2, GRID_H*TILE/2, 320, 48, 0x000000, 0.5).setDepth(1400);
          const t = this.add.text(GRID_W*TILE/2, GRID_H*TILE/2, msg, { fontFamily: 'monospace', fontSize: '16px', color }).setOrigin(0.5).setDepth(1500);
          this.time.delayedCall(1100, () => { bx.destroy(); t.destroy(); });
        }

        // --- pause/speed ---
        applyTimeScale() { this.time.timeScale = this.paused ? 0 : this.timeScale; }
        togglePause() { this.paused = !this.paused; this.applyTimeScale(); this.flashCenter(this.paused ? 'PAUSA' : 'REANUDAR', '#cfe4ff'); }
        toggleSpeed() { this.timeScale = (this.timeScale === 1 ? 2 : 1); this.applyTimeScale(); this.flashCenter(`${this.timeScale}× velocidad`, '#cfe4ff'); }

        // --- waves ---
        startNextWave() {
          if (this.paused) return;
          if (this.waveActive) return;
          if (this.waveIndex >= WAVES.length) { this.flashCenter('Todas las oleadas completadas 🎉', '#8eff8e'); return; }

          const w = WAVES[this.waveIndex];
          this.waveActive = true;
          this.spawnsDone = false;
          this.spawnCount = 0;
          this.waveText.setText(`Wave ${this.waveIndex+1}/${WAVES.length}: ${w.name}`);

          // Programar spawns
          for (let i = 0; i < w.count; i++) {
            const lane = w.lanes[i % w.lanes.length];
            const y = lane * TILE + TILE/2; // 0→32, 2→160
            this.time.delayedCall(i * w.gapMs, () => {
              const eSpr = this.add.image(GRID_W*TILE + 24, y, 'enemies32', w.enemy);
              eSpr.setDepth(eSpr.y);
              const enemy: Enemy = { s: eSpr, hp: w.hp, speed: w.speed, alive: true };
              this.enemies.push(enemy);
              this.spawnCount++;
              if (this.spawnCount === w.count) {
                this.spawnsDone = true;
              }
            });
          }
        }

        // --- combate ---
        getTarget(x:number, y:number, range:number): Enemy | null {
          let best: Enemy | null = null, bestD = Infinity;
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
            // recompensa
            this.gold += 5; this.goldText.setText(String(this.gold));
          }
        }
        gameOver() {
          this.paused = true; this.applyTimeScale();
          this.add.rectangle((GRID_W*TILE)/2, (GRID_H*TILE)/2, GRID_W*TILE, GRID_H*TILE, 0x000000, 0.5).setDepth(1500);
          this.add.text((GRID_W*TILE)/2, (GRID_H*TILE)/2, 'GAME OVER', { fontFamily: 'monospace', fontSize: '28px', color: '#ff6a6a' }).setOrigin(0.5).setDepth(1600);
        }

        update(_t: number, dtMs: number) {
          if (this.paused) return;
          const dt = dtMs / 1000;

          // mover enemigos
          for (const e of this.enemies) {
            if (!e.alive) continue;
            e.s.x -= e.speed * dt;
            if (e.s.x < -40) {
              e.alive = false; e.s.destroy();
              this.lives -= 1; this.livesText.setText(String(this.lives));
              if (this.lives <= 0) this.gameOver();
            }
          }
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
          this.bullets = this.bullets.filter(b => {
            b.life -= dtMs;
            b.s.x += b.vx * dt;
            b.s.y += b.vy * dt;
            if (b.tgt && b.tgt.alive) {
              const dx = b.tgt.s.x - b.s.x, dy = b.tgt.s.y - b.s.y;
              if (dx*dx + dy*dy < 18*18) {
                const fam = Object.values(FAMILY).find(f => f.proj === b.s.frame.name) ?? FAMILY.fire;
                this.hit(b.tgt, b.s.x, b.s.y, fam.fx, b.dmg);
                b.s.destroy();
                return false;
              }
            }
            if (b.life <= 0 || b.s.x < -40 || b.s.x > GRID_W*TILE+40 || b.s.y < -40 || b.s.y > GRID_H*TILE+40) {
              b.s.destroy();
              return false;
            }
            return true;
          });

          // fin de ola
          if (this.waveActive && this.spawnsDone && this.enemies.length === 0) {
            this.waveActive = false;
            this.waveIndex++;
            if (this.waveIndex < WAVES.length) {
              this.flashCenter(`Oleada ${this.waveIndex} completada · Pulsa N`, '#8eff8e');
              this.waveText.setText(`Wave ${this.waveIndex}/${WAVES.length}`);
            } else {
              this.flashCenter('¡Victoria! Todas las oleadas superadas 🎉', '#8eff8e');
              this.waveText.setText(`Wave ${WAVES.length}/${WAVES.length}`);
            }
          }
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
  }, []); // no re-inicializa Phaser

  // Teclado: 1–5 cambia familia, ←/→ rota variante
  useEffect(() => {
    const groups = [[0,1,2],[3,4,5],[6,7,8],[9,10,11],[12,13,14]];

    const onKey = (e: KeyboardEvent) => {
      const num = Number(e.key) - 1;
      if (num >= 0 && num < groups.length) {
        setSelected(groups[num][0]);
        return;
      }
      if (e.key === 'ArrowLeft') {
        const cur = selectedRef.current;
        setSelected((cur + TOWER_FRAMES.length - 1) % TOWER_FRAMES.length);
      }
      if (e.key === 'ArrowRight') {
        const cur = selectedRef.current;
        setSelected((cur + 1) % TOWER_FRAMES.length);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Texto arriba del canvas (muestra coste de la torre seleccionada)
  const selName = TOWER_FRAMES[towerIdx];
  const selFam = TOWER_FAMILY[selName];
  const selCost = COST[selFam];

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
      <div style={{ color:'#bbb', fontSize:12 }}>
        Torre: <b>{selName}</b> — Coste: <b>{selCost}</b> oro — 1–5 familia, ← → variante · N: wave · Espacio: pausa · F: 2×
      </div>
      <div ref={hostRef} />
    </div>
  );
}

export default dynamic(() => Promise.resolve(BattleClient), { ssr: false });
