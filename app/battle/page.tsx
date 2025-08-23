'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

/**
 * Tower Defense – client scene with:
 * - Tooltip de stats (DPS/Range/CD)
 * - Barras de vida en enemigos
 * - Efectos por familia (slow/burn/poison/crit/chain)
 * - Oleadas con carril inferior activo y curva de dificultad
 * - Carga de mapas desde /public/maps/*.json
 */

const TILE = 64;
const DEFAULT_GRID_W = 18;
const DEFAULT_GRID_H = 9;

const INITIAL_GOLD = 100;
const INITIAL_LIVES = 20;
const MAX_TIER = 5 as const;

// Frames EXACTOS de tus atlas (towers/enemies/projectiles/effects)
const TOWER_FRAMES = [
  'Ice Shard I', 'Frost Cannon III', 'Absolute Zero V',
  'Flame Turret I', 'Inferno Core III', 'Phoenix Gate V',
  'Arc Coil I', 'Tesla Grid III', 'Storm Lord V',
  'Thorn Vine I', 'Entangle Root III', 'World Tree V',
  'Mana Crystal I', 'Portal Anchor III', 'Reality Rift V'
] as const;

const ENEMIES32 = ['Goblin Scout','Orc Warrior','Skeleton Archer','Wolf Rider'] as const;

// === Config de familias con efectos ===
type TowerCfg = {
  proj: string; fx: string; range: number; cooldown: number; dmg: number; projSpeed: number;
  effects?: {
    slowPct?: number; slowMs?: number;
    burnDps?: number; burnMs?: number;
    poisonDps?: number; poisonMs?: number;
    critChance?: number; critMul?: number;
    chain?: { jumps: number; radius: number; falloff: number[] };
  }
};
const FAMILY: Record<'frost'|'fire'|'electric'|'nature'|'mystic', TowerCfg> = {
  frost:    { proj: 'Ice Shard',      fx: 'Ice Explosion',       range: 180, cooldown: 800, dmg: 22, projSpeed: 320,
              effects: { slowPct: 0.35, slowMs: 1800 } },
  fire:     { proj: 'Fireball',       fx: 'Fire Explosion',      range: 170, cooldown: 900, dmg: 26, projSpeed: 300,
              effects: { burnDps: 6, burnMs: 2500 } },
  electric: { proj: 'Lightning Bolt', fx: 'Electric Discharge',  range: 190, cooldown: 700, dmg: 18, projSpeed: 380,
              effects: { chain: { jumps: 2, radius: 180, falloff: [0.6, 0.5] } } },
  nature:   { proj: 'Poison Dart',    fx: 'Poison Cloud',        range: 160, cooldown: 650, dmg: 14, projSpeed: 360,
              effects: { poisonDps: 4, poisonMs: 4000 } },
  mystic:   { proj: 'Magic Missile',  fx: 'Electric Discharge',  range: 185, cooldown: 750, dmg: 20, projSpeed: 340,
              effects: { critChance: 0.10, critMul: 2.0 } },
};

// Costes base más amables
const COST: Record<keyof typeof FAMILY, number> = {
  frost: 35, fire: 40, electric: 45, nature: 30, mystic: 40
};

// Frame → familia
const TOWER_FAMILY: Record<string, keyof typeof FAMILY> = {
  'Ice Shard I': 'frost', 'Frost Cannon III': 'frost', 'Absolute Zero V': 'frost',
  'Flame Turret I': 'fire', 'Inferno Core III': 'fire', 'Phoenix Gate V': 'fire',
  'Arc Coil I': 'electric', 'Tesla Grid III': 'electric', 'Storm Lord V': 'electric',
  'Thorn Vine I': 'nature', 'Entangle Root III': 'nature', 'World Tree V': 'nature',
  'Mana Crystal I': 'mystic', 'Portal Anchor III': 'mystic', 'Reality Rift V': 'mystic',
};

// === Mapas (prefabs) ===
type MapJson = {
  biome: 'grass' | 'snow' | 'stone' | 'lava';
  gridW: number; gridH: number;
  lanes: number[];         // filas por donde entran (desde la derecha)
  hpMul?: number;          // multiplicador de HP
  speedMul?: number;       // multiplicador de velocidad
};

// Intenta detectar un frame adecuado en el atlas de terreno
function pickTerrainFrame(scene: any, biome: MapJson['biome']): string {
  if (!scene.textures.exists('terrain64')) return '';
  const tex = scene.textures.get('terrain64');
  const names: string[] = tex.getFrameNames ? tex.getFrameNames() : [];
  if (!names.length) return '';

  const want = biome.toLowerCase();
  // intenta por coincidencia del nombre
  const byIncl = names.find(n => n.toLowerCase().includes(want));
  if (byIncl) return byIncl;

  // fallback: primeros candidatos típicos
  const aliases: Record<MapJson['biome'], string[]> = {
    grass: ['grass', 'Grass Path', 'grass_center'],
    snow:  ['snow', 'Snow Path', 'snow_center'],
    stone: ['stone','Stone Path','stone_center'],
    lava:  ['lava','Lava Path','lava_center'],
  };
  for (const candidate of aliases[biome]) {
    const found = names.find(n => n.toLowerCase() === candidate.toLowerCase());
    if (found) return found;
  }
  // último recurso: el primer frame del atlas
  return names[0];
}

// Pinta celdas de camino con el frame detectado (rota para variar)
function renderPath(scene: any, grid: number[][], biome: MapJson['biome']) {
  const frame = pickTerrainFrame(scene, biome);
  const H = grid.length, W = grid[0].length;
  for (let y=0; y<H; y++) for (let x=0; x<W; x++) {
    if (!grid[y][x]) continue;
    const cx = x*TILE + TILE/2, cy = y*TILE + TILE/2;
    if (frame) {
      // rotación ligera para que no se vea repetido
      const ang = ((x + y) % 2) ? 0 : 90;
      scene.add.image(cx, cy, 'terrain64', frame).setAngle(ang).setDepth(0);
    } else {
      // fallback: bloque gris
      scene.add.rectangle(cx, cy, TILE, TILE, 0x444444, 1).setDepth(0);
    }
  }
}

// ---- Waves (curva de dificultad + carril inferior activo) ----
type Wave = {
  name: string; count: number; gapMs: number;
  enemy: typeof ENEMIES32[number]; hp: number; speed: number;
  lanes: 'all' | number[];
};
function makeWaves(hpMul=1, speedMul=1, lanesFromMap: number[]): Wave[] {
  return [
    { name: 'Goblins',       count: 12, gapMs: 700, enemy: 'Goblin Scout',    hp: Math.round(50*hpMul),  speed: Math.round(60*speedMul), lanes: [lanesFromMap[0] ?? 0] },
    { name: 'Orc Patrol',    count: 12, gapMs: 720, enemy: 'Orc Warrior',     hp: Math.round(85*hpMul),  speed: Math.round(58*speedMul), lanes: [lanesFromMap.at(-1) ?? 2] },
    { name: 'Mix Front',     count: 16, gapMs: 640, enemy: 'Skeleton Archer', hp: Math.round(95*hpMul),  speed: Math.round(62*speedMul), lanes: 'all' },
    { name: 'Wolf Riders',   count: 18, gapMs: 580, enemy: 'Wolf Rider',      hp: Math.round(110*hpMul), speed: Math.round(80*speedMul), lanes: 'all' },
    { name: 'Pressure',      count: 24, gapMs: 540, enemy: 'Goblin Scout',    hp: Math.round(130*hpMul), speed: Math.round(76*speedMul), lanes: 'all' },
  ];
}

function BattleClient() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<any>(null);

  // selector de mapa
  const [mapKey, setMapKey] = useState<'grass_dual'|'grass_single'|'snow_dual'>('grass_dual');

  // torre seleccionada
  const [towerIdx, setTowerIdx] = useState(0);
  const selectedRef = useRef(0);
  const setSelected = (i: number) => { selectedRef.current = i; setTowerIdx(i); };

  useEffect(() => {
    let Phaser: any;
    let destroyed = false;

    (async () => {
      // 1) carga el JSON del mapa antes de Phaser
      let map: MapJson;
      try {
        const res = await fetch(`/maps/${mapKey}.json`, { cache: 'no-store' });
        map = await res.json();
      } catch {
        map = { biome: 'grass', gridW: DEFAULT_GRID_W, gridH: DEFAULT_GRID_H, lanes: [0,2], hpMul: 1, speedMul: 1 };
      }
      const lanesFromMap = map.lanes?.length ? map.lanes : [0,2];
      const WAVES = makeWaves(map.hpMul ?? 1, map.speedMul ?? 1, lanesFromMap);

      const mod = await import('phaser');
      Phaser = mod.default ?? mod;
      if (!hostRef.current || destroyed || gameRef.current) return;

      // ===== tipos de runtime =====
      type Enemy = {
        s: any;
        hp: number;
        hpMax: number;
        speedBase: number;
        alive: boolean;
        slowUntil?: number; slowPct?: number;
        burnUntil?: number; burnDps?: number;
        poisonUntil?: number; poisonDps?: number;
        barBg?: any; barFg?: any;
      };
      type Tower = {
        s: any; fam: keyof typeof FAMILY; last: number; gx: number; gy: number;
        dmg: number; range: number; cd: number; projSpeed: number; tier: number; spent: number; ring?: any;
      };
      type Bullet = { s: any; vx: number; vy: number; speed: number; dmg: number; fam: keyof typeof FAMILY; tgt: Enemy|null; life: number };

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

        sel: Tower | null = null;
        selText: any;
        tipBg?: any; tipTxt?: any;

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
          // rejas de grid
          const g = this.add.graphics(); g.lineStyle(1, 0x333333, 0.2);
          for (let x=0; x<map.gridW*TILE; x+=TILE) for (let y=0; y<map.gridH*TILE; y+=TILE) g.strokeRect(x,y,TILE,TILE);

          // grid con lanes
          this.grid = Array.from({length: map.gridH}, () => Array(map.gridW).fill(0));
          for (const ly of lanesFromMap) for (let x=0; x<map.gridW; x++) this.grid[ly][x] = 1;

          renderPath(this, this.grid, map.biome);

          // HUD
          this.add.image(24, 24, 'ui32', 'icon_gold').setOrigin(0,0).setDepth(1000);
          this.add.image(24, 56, 'ui32', 'icon_crystals').setOrigin(0,0).setDepth(1000);
          this.add.image(24, 88, 'ui32', 'icon_energy').setOrigin(0,0).setDepth(1000);
          this.add.image(24,120, 'ui32', 'icon_xp').setOrigin(0,0).setDepth(1000);

          this.goldText = this.add.text(56, 24, String(this.gold), { fontFamily: 'monospace', fontSize: '14px', color: '#ffd76a' }).setDepth(1000).setOrigin(0,0);
          this.livesText = this.add.text(56, 88, String(this.lives), { fontFamily: 'monospace', fontSize: '14px', color: '#ff6a6a' }).setDepth(1000).setOrigin(0,0);

          this.waveText = this.add.text(map.gridW*TILE - 16, 16, `Wave 0/${WAVES.length}`, { fontFamily: 'monospace', fontSize: '14px', color: '#cfe4ff' }).setDepth(1000).setOrigin(1,0);
          this.hintText = this.add.text(map.gridW*TILE/2, map.gridH*TILE - 8,
            'N: wave · Espacio: pausa · F: 2× · 1–5/←→: torre · U: upgrade · X: vender',
            { fontFamily: 'monospace', fontSize: '12px', color: '#9aa' }
          ).setDepth(1000).setOrigin(0.5,1);

          this.selText = this.add.text(220, 24, '', { fontFamily: 'monospace', fontSize: '13px', color: '#cfe4ff' }).setDepth(1000).setOrigin(0,0);

          // Colocar / seleccionar
          this.input.on('pointerdown', (p: any) => {
            if (this.paused) return;
            const gx = Math.floor(p.x / TILE), gy = Math.floor(p.y / TILE);
            if (gx<0||gx>=map.gridW||gy<0||gy>=map.gridH) return;

            const key = `${gx},${gy}`;
            if (this.occupied.has(key)) {
              const t = this.posToTower.get(key) || null;
              this.selectTower(t);
              return;
            }
            if (this.grid[gy]?.[gx] === 1) { this.flashText('No camino', p.x, p.y); return; }

            // colocar torre
            const idx = selectedRef.current % TOWER_FRAMES.length;
            const frame = TOWER_FRAMES[idx];
            const fam = TOWER_FAMILY[frame];
            const base = FAMILY[fam];
            const cost = COST[fam];
            if (this.gold < cost) { this.flashText('Sin oro', p.x, p.y, '#ff5050'); this.flashHUD(this.goldText, '#ff5050'); return; }
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

            this.selectTower(t);
          });

          // Controles
          this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
            if (e.key === ' ' || e.key === 'Spacebar') { this.togglePause(); }
            else if (e.key === 'f' || e.key === 'F') { this.toggleSpeed(); }
            else if (e.key === 'n' || e.key === 'N') { this.startNextWave(); }
            else if (e.key === 'u' || e.key === 'U') { this.tryUpgrade(); }
            else if (e.key === 'x' || e.key === 'X') { this.trySell(); }
          });

          this.flashCenter(`Mapa: ${mapKey} · Pulsa N para empezar`, '#cfe4ff');
        }

        // === selección + tooltip ===
        selectTower(t: Tower | null) {
          if (this.sel?.ring) { this.sel.ring.destroy(); this.sel.ring = undefined; }
          this.destroyTooltip();

          this.sel = t;
          if (!t) { this.selText.setText(''); return; }

          t.ring = this.add.circle(t.s.x, t.s.y, t.range, 0x00ffff, 0.06).setDepth(2).setStrokeStyle(2, 0x00c0ff, 0.8);

          const upCost = this.upgradeCost(t);
          const sell = this.sellValue(t);
          const canUp = t.tier < MAX_TIER;

          this.selText.setText(
            `Sel: ${t.fam.toUpperCase()} T${t.tier}  ·  U: ${canUp ? `upgrade ${upCost}g` : '(MAX)'}  ·  X: vender +${sell}g`
          );

          // tooltip con DPS/Range real
          this.createTooltip(t);
        }
        createTooltip(t: Tower) {
          const dps = (t.dmg / (t.cd / 1000));
          const text = `T${t.tier}  DMG ${t.dmg} · DPS ${dps.toFixed(1)}\nRange ${t.range} · CD ${t.cd}ms`;
          const pad = 6;
          const w = 170, h = 40;
          const x = t.s.x, y = t.s.y - (TILE/2) - 10;
          this.tipBg = this.add.rectangle(x, y, w, h, 0x000000, 0.65).setDepth(1300).setOrigin(0.5,1).setStrokeStyle(1, 0x00c0ff, 0.8);
          this.tipTxt = this.add.text(x - (w/2) + pad, y - h + pad, text, { fontFamily: 'monospace', fontSize: '12px', color: '#cfe4ff' }).setDepth(1310).setOrigin(0,0);
        }
        updateTooltipPos() {
          if (!this.sel || !this.tipBg || !this.tipTxt) return;
          const pad = 6; const w = 170, h = 40;
          const x = this.sel.s.x, y = this.sel.s.y - (TILE/2) - 10;
          this.tipBg.setPosition(x, y);
          this.tipTxt.setPosition(x - (w/2) + pad, y - h + pad);
        }
        destroyTooltip() {
          if (this.tipBg) { this.tipBg.destroy(); this.tipBg = undefined; }
          if (this.tipTxt) { this.tipTxt.destroy(); this.tipTxt = undefined; }
        }

        // economía de upgrade/venta
        upgradeCost(t: Tower) { return Math.floor(COST[t.fam] * (t.tier + 0.5) * 0.6); }
        sellValue(t: Tower) { return Math.floor(t.spent * 0.65); }

        tryUpgrade() {
          const t = this.sel; if (!t) return;
          if (t.tier >= MAX_TIER) { this.flashText('TIER MÁX', t.s.x, t.s.y); return; }
          const cost = this.upgradeCost(t);
          if (this.gold < cost) { this.flashText('Sin oro', t.s.x, t.s.y, '#ff5050'); this.flashHUD(this.goldText, '#ff5050'); return; }

          this.gold -= cost; this.goldText.setText(String(this.gold));
          t.spent += cost;
          t.tier += 1;
          t.dmg = Math.round(t.dmg * 1.22);
          t.range = Math.round(t.range + 14);
          t.cd = Math.max(360, Math.floor(t.cd * 0.9));

          const pulse = this.add.circle(t.s.x, t.s.y, Math.min(t.range, 220), 0x44ff88, 0.08).setDepth(3);
          this.tweens.add({ targets: pulse, alpha: 0, duration: 350, onComplete: () => pulse.destroy() });

          if (t.ring) { t.ring.destroy(); t.ring = this.add.circle(t.s.x, t.s.y, t.range, 0x00ffff, 0.06).setDepth(2).setStrokeStyle(2, 0x00c0ff, 0.8); }
          this.destroyTooltip(); this.createTooltip(t);
        }
        trySell() {
          const t = this.sel; if (!t) return;
          const value = this.sellValue(t);
          this.gold += value; this.goldText.setText(String(this.gold));
          const key = `${t.gx},${t.gy}`;
          this.occupied.delete(key); this.posToTower.delete(key);
          if (t.ring) t.ring.destroy();
          t.s.destroy();
          this.towers = this.towers.filter(x => x !== t);
          this.sel = null; this.selText.setText('');
          this.destroyTooltip();
          this.flashText(`+${value}g`, t.s.x, t.s.y, '#a0ff8a');
        }

        // UI helpers
        flashText(msg: string, x: number, y: number, color = '#ffd76a') {
          const t = this.add.text(x, y - 14, msg, { fontFamily: 'monospace', fontSize: '12px', color }).setDepth(1200).setOrigin(0.5,1);
          this.tweens.add({ targets: t, y: y - 34, alpha: 0, duration: 600, onComplete: () => t.destroy() });
        }
        flashHUD(txt: any, color: string) {
          const orig = txt.style.color; txt.setStyle({ color }); this.time.delayedCall(160, () => txt.setStyle({ color: orig }));
        }
        flashCenter(msg: string, color = '#ffd76a') {
          const bx = this.add.rectangle((map.gridW*TILE)/2, (map.gridH*TILE)/2, 380, 52, 0x000000, 0.5).setDepth(1400);
          const t = this.add.text((map.gridW*TILE)/2, (map.gridH*TILE)/2, msg, { fontFamily: 'monospace', fontSize: '16px', color }).setOrigin(0.5).setDepth(1500);
          this.time.delayedCall(1100, () => { bx.destroy(); t.destroy(); });
        }

        applyTimeScale() { this.time.timeScale = this.paused ? 0 : this.timeScale; }
        togglePause() { this.paused = !this.paused; this.applyTimeScale(); this.flashCenter(this.paused ? 'PAUSA' : 'REANUDAR', '#cfe4ff'); }
        toggleSpeed() { this.timeScale = (this.timeScale === 1 ? 2 : 1); this.applyTimeScale(); this.flashCenter(`${this.timeScale}× velocidad`, '#cfe4ff'); }

        // waves
        startNextWave() {
          if (this.paused || this.waveActive || this.waveIndex >= WAVES.length) return;

          const w = WAVES[this.waveIndex];
          const laneRows = w.lanes === 'all' ? map.lanes : w.lanes;
          this.waveActive = true; this.spawnsDone = false; this.spawnCount = 0;
          this.waveText.setText(`Wave ${this.waveIndex+1}/${WAVES.length}: ${w.name}`);

          for (let i = 0; i < w.count; i++) {
            const lane = laneRows[i % laneRows.length];
            const y = lane * TILE + TILE/2;
            this.time.delayedCall(i * w.gapMs, () => {
              const eSpr = this.add.image(map.gridW*TILE + 24, y, 'enemies32', w.enemy);
              eSpr.setDepth(eSpr.y);
              const enemy: Enemy = {
                s: eSpr, hp: w.hp, hpMax: w.hp, speedBase: w.speed, alive: true
              };
              // barra de vida
              enemy.barBg = this.add.rectangle(eSpr.x, eSpr.y - 18, 24, 4, 0x000000, 0.5).setDepth(eSpr.y + 1);
              enemy.barFg = this.add.rectangle(eSpr.x, eSpr.y - 18, 24, 4, 0x26ff88, 0.9).setDepth(eSpr.y + 2);

              this.enemies.push(enemy);
              this.spawnCount++; if (this.spawnCount === w.count) this.spawnsDone = true;
            });
          }
        }

        // targeting básico: enemigo más cercano dentro de rango
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
          this.bullets.push({ s: b, vx, vy, speed: stats.projSpeed, dmg: stats.dmg, fam, tgt: target, life: 2000 });
        }

        hit(target: any, x:number, y:number, fam: keyof typeof FAMILY, baseDmg:number) {
          if (!target.alive) return;

          // efectos/crit
          let dmg = baseDmg;
          const eff = FAMILY[fam].effects;
          if (eff?.critChance && Math.random() < eff.critChance) {
            dmg = Math.round(dmg * (eff.critMul ?? 2.0));
            this.flashText('CRIT!', x, y-6, '#ffd76a');
          }

          target.hp -= dmg;

          // estados
          if (eff?.slowPct && eff?.slowMs) { target.slowPct = Math.max(target.slowPct ?? 0, eff.slowPct); target.slowUntil = this.time.now + eff.slowMs; }
          if (eff?.burnDps && eff?.burnMs) { target.burnDps = eff.burnDps; target.burnUntil = this.time.now + eff.burnMs; }
          if (eff?.poisonDps && eff?.poisonMs) { target.poisonDps = eff.poisonDps; target.poisonUntil = this.time.now + eff.poisonMs; }

          const fx = this.add.image(x, y, 'fx', FAMILY[fam].fx).setDepth(900);
          this.time.delayedCall(120, () => fx.destroy());

          // chain eléctrico
          if (eff?.chain && target.alive) {
            this.chainLightning(x, y, target, fam, baseDmg, eff.chain);
          }

          if (target.hp <= 0 && target.alive) {
            target.alive = false; target.s.destroy();
            target.barBg?.destroy(); target.barFg?.destroy();
            const reward = 4 + Math.floor(this.waveIndex / 2);
            this.gold += reward; this.goldText.setText(String(this.gold));
          } else {
            this.updateHpBar(target);
          }
        }

        updateHpBar(e: any) {
          if (!e.barBg || !e.barFg) return;
          const ratio = Math.max(0, e.hp / e.hpMax);
          const full = 24;
          e.barFg.width = full * ratio;
          e.barFg.x = e.s.x - 12 + (e.barFg.width/2);
        }

        chainLightning(x:number, y:number, first: any, fam: keyof typeof FAMILY, baseDmg:number, cfg:{jumps:number; radius:number; falloff:number[]}) {
          const candidates = this.enemies.filter(e => e.alive && e !== first && Math.hypot(e.s.x - x, e.s.y - y) <= cfg.radius);
          candidates.sort((a,b)=>Math.hypot(a.s.x-x,a.s.y-y)-Math.hypot(b.s.x-x,b.s.y-y));
          for (let j=0; j<cfg.jumps && j<candidates.length; j++) {
            const e = candidates[j];
            const mul = cfg.falloff[j] ?? 0.5;
            const dmg = Math.max(1, Math.round(baseDmg * mul));
            const g = this.add.graphics().setDepth(950);
            g.lineStyle(2, 0xffffaa, 0.8);
            g.beginPath(); g.moveTo(x,y); g.lineTo(e.s.x,e.s.y); g.strokePath();
            this.time.delayedCall(100, () => g.destroy());
            this.hit(e, e.s.x, e.s.y, fam, dmg);
          }
        }

        gameOver() {
          this.paused = true; this.applyTimeScale();
          this.add.rectangle((map.gridW*TILE)/2, (map.gridH*TILE)/2, map.gridW*TILE, map.gridH*TILE, 0x000000, 0.5).setDepth(1500);
          this.add.text((map.gridW*TILE)/2, (map.gridH*TILE)/2, 'GAME OVER', { fontFamily: 'monospace', fontSize: '28px', color: '#ff6a6a' }).setOrigin(0.5).setDepth(1600);
        }

        update(_t: number, dtMs: number) {
          if (this.paused) return;
          const dt = dtMs / 1000;
          const now = this.time.now;

          // enemigos: DoT, slow y movimiento
          for (const e of this.enemies) {
            if (!e.alive) continue;

            // DoTs
            if (e.burnUntil && now < e.burnUntil) e.hp -= (e.burnDps ?? 0) * dt;
            if (e.poisonUntil && now < e.poisonUntil) e.hp -= (e.poisonDps ?? 0) * dt;

            if (e.hp <= 0) {
              e.alive = false; e.s.destroy(); e.barBg?.destroy(); e.barFg?.destroy();
              const reward = 4 + Math.floor(this.waveIndex / 2);
              this.gold += reward; this.goldText.setText(String(this.gold));
              continue;
            }

            // slow
            const slowed = (e.slowUntil && now < e.slowUntil) ? (1 - (e.slowPct ?? 0)) : 1;
            const v = e.speedBase * slowed;

            e.s.x -= v * dt;

            // barras siguen al sprite
            if (e.barBg && e.barFg) {
              e.barBg.x = e.s.x; e.barBg.y = e.s.y - 18;
              e.barFg.y = e.s.y - 18;
              this.updateHpBar(e);
            }

            if (e.s.x < -40) {
              e.alive = false; e.s.destroy(); e.barBg?.destroy(); e.barFg?.destroy();
              this.lives -= 1; this.livesText.setText(String(this.lives));
              if (this.lives <= 0) this.gameOver();
            }
          }
          // limpia array
          this.enemies = this.enemies.filter(e => e.alive || e.s.active);

          // torres: cooldown + disparo
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
            b.s.x += b.vx * dt; b.s.y += b.vy * dt;
            if (b.tgt && b.tgt.alive) {
              const dx = b.tgt.s.x - b.s.x, dy = b.tgt.s.y - b.s.y;
              if (dx*dx + dy*dy < 18*18) {
                this.hit(b.tgt, b.s.x, b.s.y, b.fam, b.dmg);
                b.s.destroy(); return false;
              }
            }
            if (b.life <= 0 || b.s.x < -40 || b.s.x > map.gridW*TILE+40 || b.s.y < -40 || b.s.y > map.gridH*TILE+40) {
              b.s.destroy(); return false;
            }
            return true;
          });

          // tooltip sigue a la torre seleccionada
          this.updateTooltipPos();

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
        width: map.gridW * TILE,
        height: map.gridH * TILE,
        parent: hostRef.current!,
        backgroundColor: '#0e0e0e',
        scene: [TD],
        render: { pixelArt: true, antialias: false }
      });
    })();

    return () => { destroyed = true; gameRef.current?.destroy(true); gameRef.current = null; };
  }, [mapKey]);

  // Selector (1–5 familias, ←/→ variantes)
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
      <div style={{ display:'flex', gap:12, alignItems:'center', color:'#bbb', fontSize:12 }}>
        <span>
          Torre: <b>{selName}</b> — Coste: <b>{selCost}</b> oro — 1–5 familia, ← → variante ·
          N: wave · Espacio: pausa · F: 2× · U: upgrade · X: vender
        </span>
        <label style={{ display:'flex', gap:6, alignItems:'center' }}>
          <span style={{ color:'#8fb' }}>Mapa:</span>
          <select
            value={mapKey}
            onChange={e => setMapKey(e.target.value as any)}
            style={{ background:'#111', color:'#cfe4ff', border:'1px solid #335', borderRadius:4, padding:'2px 6px' }}
          >
            <option value="grass_dual">grass_dual</option>
            <option value="grass_single">grass_single</option>
            <option value="snow_dual">snow_dual</option>
          </select>
        </label>
      </div>
      <div ref={hostRef} />
    </div>
  );
}

export default dynamic(() => Promise.resolve(BattleClient), { ssr: false });
