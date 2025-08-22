'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

const TILE = 64;
const GRID_W = 18;
const GRID_H = 9;

const INITIAL_GOLD = 100;
const INITIAL_LIVES = 20;
const MAX_TIER = 5 as const;

const TERRAIN_FRAMES = {
  grass: 'Grass Path',
  snow: 'Snow Path',
  stone: 'Stone Path',
  lava: 'Lava Path',
} as const;

const TOWER_FRAMES = [
  'Ice Shard I', 'Frost Cannon III', 'Absolute Zero V',
  'Flame Turret I', 'Inferno Core III', 'Phoenix Gate V',
  'Arc Coil I', 'Tesla Grid III', 'Storm Lord V',
  'Thorn Vine I', 'Entangle Root III', 'World Tree V',
  'Mana Crystal I', 'Portal Anchor III', 'Reality Rift V'
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

const COST: Record<keyof typeof FAMILY, number> = {
  frost: 35, fire: 40, electric: 45, nature: 30, mystic: 40
};

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

// Waves
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

  const [towerIdx, setTowerIdx] = useState(0);
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
      type Tower = {
        s: any; fam: keyof typeof FAMILY; last: number; gx: number; gy: number;
        dmg: number; range: number; cd: number; projSpeed: number; tier: number; spent: number; ring?: any
      };
      type Bullet = { s: any; vx: number; vy: number; speed: number; dmg: number; tgt: Enemy|null; life: number };

      class TD extends Phaser.Scene {
        enemies: Enemy[] = [];
        towers: Tower[] = [];
        bullets: Bullet[] = [];
        posToTower = new Map<string, Tower>();
        grid: number[][] = [];
        occupied = new Set<string>();

        gold = INITIAL_GOLD;
        lives = INITIAL_LIVES;
        goldText: any;
        livesText: any;

        waveIndex = 0;
        waveText: any;
        hintText: any;
        waveActive = false;
        spawnsDone = false;
        spawnCount = 0;

        paused = false;
        timeScale = 1;

        // selección
        sel: Tower | null = null;
        selText: any;

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
          const g = this.add.graphics(); g.lineStyle(1, 0x333333, 0.2);
          for (let x=0; x<GRID_W*TILE; x+=TILE) for (let y=0; y<GRID_H*TILE; y+=TILE) g.strokeRect(x,y,TILE,TILE);

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
            'N: wave · Espacio: pausa · F: 2× · 1–5/←→: torre · U: upgrade · X: vender',
            { fontFamily: 'monospace', fontSize: '12px', color: '#9aa' }
          ).setDepth(1000).setOrigin(0.5,1);

          this.selText = this.add.text(200, 24, '', { fontFamily: 'monospace', fontSize: '13px', color: '#cfe4ff' }).setDepth(1000).setOrigin(0,0);

          // Colocar/seleccionar
          this.input.on('pointerdown', (p: any) => {
            if (this.paused) return;
            const gx = Math.floor(p.x / TILE), gy = Math.floor(p.y / TILE);
            if (gx<0||gx>=GRID_W||gy<0||gy>=GRID_H) return;

            const key = `${gx},${gy}`;
            // si hay torre en celda → seleccionar
            if (this.occupied.has(key)) {
              const t = this.posToTower.get(key) || null;
              this.selectTower(t);
              return;
            }
            // evitar camino
            if (this.grid[gy]?.[gx] === 1) { this.flashText('No camino', p.x, p.y); return; }

            // colocar
            const idx = selectedRef.current % TOWER_FRAMES.length;
            const frame = TOWER_FRAMES[idx];
            const fam = TOWER_FAMILY[frame];
            const base = FAMILY[fam];
            const cost = COST[fam];
            if (this.gold < cost) {
              this.flashText('Sin oro', p.x, p.y, '#ff5050');
              this.flashHUD(this.goldText, '#ff5050');
              return;
            }
            this.gold -= cost; this.goldText.setText(String(this.gold));

            const x = gx*TILE + TILE/2, y = gy*TILE + TILE/2;
            const spr = this.add.image(x, y, 'towers', frame).setDepth(y);
            const t: Tower = {
              s: spr, fam, gx, gy, last: 0,
              dmg: base.dmg, range: base.range, cd: base.cooldown,
              projSpeed: base.projSpeed, tier: 1, spent: cost
            };
            this.towers.push(t);
            this.occupied.add(key);
            this.posToTower.set(key, t);

            const ring = this.add.circle(x, y, base.range, 0x00ffff, 0.05).setDepth(1);
            this.time.delayedCall(250, () => ring.destroy());

            this.selectTower(t); // seleccionar recién puesta
          });

          // Controles
          this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
            if (e.key === ' ' || e.key === 'Spacebar') { this.togglePause(); }
            else if (e.key === 'f' || e.key === 'F') { this.toggleSpeed(); }
            else if (e.key === 'n' || e.key === 'N') { this.startNextWave(); }
            else if (e.key === 'u' || e.key === 'U') { this.tryUpgrade(); }
            else if (e.key === 'x' || e.key === 'X') { this.trySell(); }
          });

          this.flashCenter(`Pulsa N para empezar`, '#cfe4ff');
        }

        // selección
        selectTower(t: Tower | null) {
          // limpiar anillo previo
          if (this.sel?.ring) { this.sel.ring.destroy(); this.sel.ring = undefined; }
          this.sel = t;
          if (!t) { this.selText.setText(''); return; }

          t.ring = this.add.circle(t.s.x, t.s.y, t.range, 0x00ffff, 0.06).setDepth(2).setStrokeStyle(2, 0x00c0ff, 0.8);
          const upCost = this.upgradeCost(t);
          const sell = this.sellValue(t);
          const canUp = t.tier < MAX_TIER;
          this.selText.setText(
            `Sel: ${t.fam.toUpperCase()} T${t.tier}  ·  U mejorar ${canUp ? upCost+'g' : '(MAX)'}  ·  X vender +${sell}g`
          );
        }
        upgradeCost(t: Tower) {
          // un poco creciente por tier
          return Math.floor(COST[t.fam] * (t.tier + 1) * 0.8);
        }
        sellValue(t: Tower) {
          return Math.floor(t.spent * 0.6);
        }
        tryUpgrade() {
          const t = this.sel; if (!t) return;
          if (t.tier >= MAX_TIER) { this.flashText('TIER MÁX', t.s.x, t.s.y); return; }
          const cost = this.upgradeCost(t);
          if (this.gold < cost) {
            this.flashText('Sin oro', t.s.x, t.s.y, '#ff5050'); this.flashHUD(this.goldText, '#ff5050'); return;
          }
          this.gold -= cost; this.goldText.setText(String(this.gold));
          t.spent += cost;
          t.tier += 1;
          // escalado moderado
          t.dmg = Math.round(t.dmg * 1.25);
          t.range = Math.round(t.range + 12);
          t.cd = Math.max(400, Math.floor(t.cd * 0.9));
          // feedback
          const pulse = this.add.circle(t.s.x, t.s.y, Math.min(t.range, 220), 0x44ff88, 0.08).setDepth(3);
          this.tweens.add({ targets: pulse, alpha: 0, duration: 350, onComplete: () => pulse.destroy() });
          // actualizar anillo + HUD
          if (t.ring) { t.ring.destroy(); t.ring = this.add.circle(t.s.x, t.s.y, t.range, 0x00ffff, 0.06).setDepth(2).setStrokeStyle(2, 0x00c0ff, 0.8); }
          this.selectTower(t);
        }
        trySell() {
          const t = this.sel; if (!t) return;
          const value = this.sellValue(t);
          this.gold += value; this.goldText.setText(String(this.gold));
          // limpiar estructuras
          const key = `${t.gx},${t.gy}`;
          this.occupied.delete(key); this.posToTower.delete(key);
          if (t.ring) t.ring.destroy();
          t.s.destroy();
          this.towers = this.towers.filter(x => x !== t);
          this.sel = null; this.selText.setText('');
          this.flashText(`+${value}g`, t.s.x, t.s.y, '#a0ff8a');
        }

        // UI helpers
        flashText(msg: string, x: number, y: number, color = '#ffd76a') {
          const t = this.add.text(x, y - 14, msg, { fontFamily: 'monospace', fontSize: '12px', color }).setDepth(1200).setOrigin(0.5,1);
          this.tweens.add({ targets: t, y: y - 34, alpha: 0, duration: 600, onComplete: () => t.destroy() });
        }
        flashHUD(txt: any, color: string) {
          const orig = txt.style.color;
          txt.setStyle({ color }); this.time.delayedCall(160, () => txt.setStyle({ color: orig }));
        }
        flashCenter(msg: string, color = '#ffd76a') {
          const bx = this.add.rectangle(GRID_W*TILE/2, GRID_H*TILE/2, 360, 52, 0x000000, 0.5).setDepth(1400);
          const t = this.add.text(GRID_W*TILE/2, GRID_H*TILE/2, msg, { fontFamily: 'monospace', fontSize: '16px', color }).setOrigin(0.5).setDepth(1500);
          this.time.delayedCall(1100, () => { bx.destroy(); t.destroy(); });
        }

        // pausa/velocidad
        applyTimeScale() { this.time.timeScale = this.paused ? 0 : this.timeScale; }
        togglePause() { this.paused = !this.paused; this.applyTimeScale(); this.flashCenter(this.paused ? 'PAUSA' : 'REANUDAR', '#cfe4ff'); }
        toggleSpeed() { this.timeScale = (this.timeScale === 1 ? 2 : 1); this.applyTimeScale(); this.flashCenter(`${this.timeScale}× velocidad`, '#cfe4ff'); }

        // waves
        startNextWave() {
          if (this.paused) return;
          if (this.waveActive) return;
          if (this.waveIndex >= WAVES.length) { this.flashCenter('Todas las oleadas completadas 🎉', '#8eff8e'); return; }

          const w = WAVES[this.waveIndex];
          this.waveActive = true; this.spawnsDone = false; this.spawnCount = 0;
          this.waveText.setText(`Wave ${this.waveIndex+1}/${WAVES.length}: ${w.name}`);

          for (let i = 0; i < w.count; i++) {
            const lane = w.lanes[i % w.lanes.length];
            const y = lane * TILE + TILE/2;
            this.time.delayedCall(i * w.gapMs, () => {
              const eSpr = this.add.image(GRID_W*TILE + 24, y, 'enemies32', w.enemy);
              eSpr.setDepth(eSpr.y);
              const enemy: Enemy = { s: eSpr, hp: w.hp, speed: w.speed, alive: true };
              this.enemies.push(enemy);
              this.spawnCount++;
              if (this.spawnCount === w.count) this.spawnsDone = true;
            });
          }
        }

        // combate
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
        shoot(from: {x:number,y:number}, fam: keyof typeof FAMILY, target: Enemy, stats: {dmg:number; projSpeed:number}) {
          const cfg = FAMILY[fam];
          const b = this.add.image(from.x, from.y, 'projectiles', cfg.proj).setDepth(500);
          const dx = target.s.x - from.x, dy = target.s.y - from.y;
          const len = Math.hypot(dx, dy) || 1;
          const vx = (dx/len) * stats.projSpeed;
          const vy = (dy/len) * stats.projSpeed;
          this.bullets.push({ s: b, vx, vy, speed: stats.projSpeed, dmg: stats.dmg, tgt: target, life: 2000 });
        }
        hit(target: Enemy, x:number, y:number, fam: keyof typeof FAMILY, dmg:number) {
          target.hp -= dmg;
          const fx = this.add.image(x, y, 'fx', FAMILY[fam].fx).setDepth(900);
          this.time.delayedCall(120, () => fx.destroy());
          if (target.hp <= 0 && target.alive) {
            target.alive = false;
            target.s.destroy();
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

          // torres
          for (const t of this.towers) {
            t.last += dtMs;
            if (t.last < t.cd) continue;
            const trg = this.getTarget(t.s.x, t.s.y, t.range);
            if (!trg) continue;
            this.shoot({ x: t.s.x, y: t.s.y }, t.fam, trg, { dmg: t.dmg, projSpeed: t.projSpeed });
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
                // familia desde el nombre del frame del proyectil
                const fam = (Object.entries(FAMILY).find(([,v]) => v.proj === b.s.frame.name)?.[0] ?? 'fire') as keyof typeof FAMILY;
                this.hit(b.tgt, b.s.x, b.s.y, fam, b.dmg);
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
  }, []);

  // Selector (1–5 familias, ←/→ variante)
  useEffect(() => {
    const groups = [[0,1,2],[3,4,5],[6,7,8],[9,10,11],[12,13,14]];
    const onKey = (e: KeyboardEvent) => {
      const num = Number(e.key) - 1;
      if (num >= 0 && num < groups.length) { setSelected(groups[num][0]); return; }
      if (e.key === 'ArrowLeft')  { const cur = selectedRef.current; setSelected((cur + TOWER_FRAMES.length - 1) % TOWER_FRAMES.length); }
      if (e.key === 'ArrowRight') { const cur = selectedRef.current; setSelected((cur + 1) % TOWER_FRAMES.length); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const selName = TOWER_FRAMES[towerIdx];
  const selFam = TOWER_FAMILY[selName];
  const selCost = COST[selFam];

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
      <div style={{ color:'#bbb', fontSize:12 }}>
        Torre: <b>{selName}</b> — Coste: <b>{selCost}</b> oro — 1–5 familia, ← → variante · N: wave · Espacio: pausa · F: 2× · U: upgrade · X: vender
      </div>
      <div ref={hostRef} />
    </div>
  );
}

export default dynamic(() => Promise.resolve(BattleClient), { ssr: false });
