'use client';

import React, { useEffect, useRef, useState } from 'react';

// Importar Phaser solo en cliente
let PhaserLib: any = null;
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  PhaserLib = require('phaser');
}

/* ----------------------- Tipos y utilidades ----------------------- */
type MapPoint = { x: number; y: number };
type MapRect = { x: number; y: number; w: number; h: number };
type MapDef = {
  name: string;
  tileSize: number; width: number; height: number;
  terrain: string;
  buildMask: MapRect[];
  paths: MapPoint[][];
  waves: {
    baseCount: number; countPerWave: number;
    baseHP: number; hpPerWave: number;
    baseSpeed: number; speedPerWave: number;
    spawnDelayMs: number; rewardBase: number;
  }
};

type FamKey = 'electric' | 'fire' | 'frost' | 'nature';

type TowerModel = {
  frame: string;
  fam: FamKey;
  cost: number;
  dmg: number;
  range: number;
  cd: number;
  projectile: 'Lightning Bolt' | 'Fireball' | 'Ice Shard' | 'Poison Dart';
  chain?: { hops: number; falloff: number };
  slow?: { factor: number; ms: number };
  dot?: { dps: number; ms: number };
};

async function loadMapDef(name: string): Promise<MapDef> {
  const res = await fetch(`/maps/${name}.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`map ${name} not found`);
  return res.json();
}

/* ----------------------------- Torretas ----------------------------- */
const ELECTRIC: TowerModel[] = [
  { frame: 'Arc Coil I',     fam: 'electric', cost: 45,  dmg: 18, range: 190, cd: 700, projectile: 'Lightning Bolt', chain: { hops: 2, falloff: 0.7 } },
  { frame: 'Tesla Grid III', fam: 'electric', cost: 85,  dmg: 30, range: 210, cd: 620, projectile: 'Lightning Bolt', chain: { hops: 3, falloff: 0.7 } },
  { frame: 'Storm Lord V',   fam: 'electric', cost: 140, dmg: 48, range: 230, cd: 540, projectile: 'Lightning Bolt', chain: { hops: 4, falloff: 0.7 } },
];
const FIRE: TowerModel[] = [
  { frame: 'Flame Turret I',   fam: 'fire', cost: 45,  dmg: 14, range: 150, cd: 600, projectile: 'Fireball',   dot: { dps: 6,  ms: 1200 } },
  { frame: 'Inferno Core III', fam: 'fire', cost: 85,  dmg: 22, range: 165, cd: 520, projectile: 'Fireball',   dot: { dps: 10, ms: 1400 } },
  { frame: 'Phoenix Gate V',   fam: 'fire', cost: 140, dmg: 30, range: 180, cd: 480, projectile: 'Fireball',   dot: { dps: 16, ms: 1600 } },
];
const FROST: TowerModel[] = [
  { frame: 'Ice Shard I',       fam: 'frost', cost: 45,  dmg: 16, range: 180, cd: 640, projectile: 'Ice Shard', slow: { factor: 0.7, ms: 1200 } },
  { frame: 'Frost Cannon III',  fam: 'frost', cost: 85,  dmg: 26, range: 200, cd: 560, projectile: 'Ice Shard', slow: { factor: 0.6, ms: 1500 } },
  { frame: 'Absolute Zero V',   fam: 'frost', cost: 140, dmg: 40, range: 220, cd: 520, projectile: 'Ice Shard', slow: { factor: 0.5, ms: 1800 } },
];
/** 🌿 Nature: veneno (DoT) + pequeño slow */
const NATURE: TowerModel[] = [
  { frame: 'Thorn Vine I',      fam: 'nature', cost: 45,  dmg: 12, range: 180, cd: 620, projectile: 'Poison Dart', dot: { dps: 7,  ms: 1400 }, slow: { factor: 0.9, ms: 600 } },
  { frame: 'Entangle Root III', fam: 'nature', cost: 85,  dmg: 20, range: 200, cd: 560, projectile: 'Poison Dart', dot: { dps: 12, ms: 1600 }, slow: { factor: 0.85, ms: 800 } },
  { frame: 'World Tree V',      fam: 'nature', cost: 140, dmg: 30, range: 220, cd: 520, projectile: 'Poison Dart', dot: { dps: 18, ms: 1800 }, slow: { factor: 0.8, ms: 900 } },
];

const GROUPS: Record<FamKey, TowerModel[]> = {
  electric: ELECTRIC,
  fire: FIRE,
  frost: FROST,
  nature: NATURE,
};

/* ------------------------- Escena de Phaser ------------------------- */
function createSceneClass() {
  const Phaser = PhaserLib;

  return class TD extends Phaser.Scene {
    map!: MapDef;
    gold = 320;
    waveIndex = 0;
    laneToggle = 0;

    enemies!: any;
    projectiles!: any;
    towers: { sprite: any; model: TowerModel; last: number; level: number; totalSpent: number; panel?: any }[] = [];

    goldText!: any;
    infoText!: any;
    tooltip!: any;
    rangeCircle!: any;

    selFam: FamKey = 'electric';
    selIdx = 0;
    blockedTiles = new Set<string>();
    ready = false;

    // Música
    bgm!: any;

    // Para evitar colocar torre al pinchar UI
    clickConsumed = false;

    worldToTile(x: number, y: number) { return { tx: Math.floor(x / this.map.tileSize), ty: Math.floor(y / this.map.tileSize) }; }
    tileKey(tx: number, ty: number) { return `${tx},${ty}`; }

    preload() {
      // Atlases
      this.load.atlas('terrain64',  '/assets/terrain_atlas.png',     '/assets/terrain_atlas.json');
      this.load.atlas('ui32',       '/assets/ui_atlas.png',          '/assets/ui_atlas.json');
      this.load.atlas('towers',     '/assets/towers_atlas.png',      '/assets/towers_atlas.json');
      this.load.atlas('enemies32',  '/assets/enemies32_atlas.png',   '/assets/enemies32_atlas.json');
      this.load.atlas('enemies40',  '/assets/enemies40_atlas.png',   '/assets/enemies40_atlas.json');
      this.load.atlas('enemies48',  '/assets/enemies48_atlas.png',   '/assets/enemies48_atlas.json');
      this.load.atlas('projectiles','/assets/projectiles_atlas.png', '/assets/projectiles_atlas.json');
      this.load.atlas('fx',         '/assets/effects_atlas.png',     '/assets/effects_atlas.json');

      // Audio (.wav en /public/audio)
      try { this.load.audio('coin',  ['/audio/coin.wav',  '/audio/coin.mp3']); } catch {}
      try { this.load.audio('hit',   ['/audio/hit.wav',   '/audio/hit.mp3']); } catch {}
      try { this.load.audio('place', ['/audio/place.wav', '/audio/place.mp3']); } catch {}
      try { this.load.audio('shoot', ['/audio/shot.wav',  '/audio/shoot.mp3']); } catch {}
      try { this.load.audio('music', ['/audio/music.wav', '/audio/music.mp3']); } catch {}
    }

    async create() {
      // Grupos antes de cualquier await
      this.enemies = this.add.group();
      this.projectiles = this.add.group();

      // Cargar mapa
      const url = new URL(window.location.href);
      const mapName = (url.searchParams.get('map') || 'grass_dual').replace(/[^a-z0-9_\-]/gi, '');
      this.map = await loadMapDef(mapName);
      this.cameras.main.setBackgroundColor('#0c0e12');

      // UI
      this.goldText = this.add.text(16, 16, `🪙 ${this.gold}`, {
        color: '#ffd76a', fontFamily: 'monospace', fontSize: '18px'
      }).setDepth(1000);

      this.infoText = this.add.text(
        16, 34,
        `Click coloca · 1=⚡ / 2=🔥 / 3=❄ / 4=🌿 · ←/→ cambia skin · Espacio pausa · F x2 · Click torre para Upgrade/Vender`,
        { color: '#b7c7ff', fontFamily: 'monospace', fontSize: '12px' }
      ).setDepth(1000);

      this.tooltip = this.add.text(0, 0, '', {
        color: '#e8f4ff', fontFamily: 'monospace', fontSize: '12px',
        backgroundColor: 'rgba(0,0,0,0.35)'
      }).setDepth(1200).setVisible(false);

      this.rangeCircle = this.add.circle(0, 0, 50, 0x4cc2ff, 0.12)
        .setStrokeStyle(2, 0x4cc2ff, 0.8).setDepth(200).setVisible(false);

      // Música tras primer click (autoplay policy)
      try {
        this.bgm = this.sound.add('music', { loop: true, volume: 0.18 });
        this.input.once('pointerdown', () => { if (!this.bgm.isPlaying) this.bgm.play(); });
      } catch {}

      // Pintar mapa
      this.drawMapFromJSON(this.map);

      // Colocar torres
      this.input.on('pointerdown', (p: any) => {
        if (this.clickConsumed) { this.clickConsumed = false; return; }

        const model = GROUPS[this.selFam][this.selIdx];
        const { tx, ty } = this.worldToTile(p.worldX, p.worldY);
        if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) return;
        if (this.blockedTiles.has(this.tileKey(tx, ty))) return;
        if (this.gold < model.cost) return;

        this.gold -= model.cost;
        this.goldText.setText(`🪙 ${this.gold}`);
        try { this.sound.play('place', { volume: 0.4 }); } catch {}

        const x = tx * this.map.tileSize + this.map.tileSize / 2;
        const y = ty * this.map.tileSize + this.map.tileSize / 2;
        const spr = this.add.image(x, y, 'towers', model.frame).setDepth(300);

        const tower = { sprite: spr, model, last: 0, level: 0, totalSpent: model.cost } as any;
        this.towers.push(tower);

        spr.setInteractive({ cursor: 'pointer' });
        spr.on('pointerover', () => this.showTowerTooltip(tower));
        spr.on('pointerout', () => { this.rangeCircle.setVisible(false); this.tooltip.setVisible(false); });
        spr.on('pointerdown', () => this.openTowerPanel(tower));
      });

      // Teclado
      this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
        if (e.key === '1') { this.selFam = 'electric'; this.selIdx = 0; }
        if (e.key === '2') { this.selFam = 'fire';     this.selIdx = 0; }
        if (e.key === '3') { this.selFam = 'frost';    this.selIdx = 0; }
        if (e.key === '4') { this.selFam = 'nature';   this.selIdx = 0; }
        if (e.key === 'ArrowLeft')  this.selIdx = (this.selIdx + GROUPS[this.selFam].length - 1) % GROUPS[this.selFam].length;
        if (e.key === 'ArrowRight') this.selIdx = (this.selIdx + 1) % GROUPS[this.selFam].length;
        if (e.code === 'Space') this.scene.isPaused() ? this.scene.resume() : this.scene.pause();
        if (e.key.toLowerCase() === 'f') this.time.timeScale = this.time.timeScale === 1 ? 2 : 1;
      });

      // Waves (auto)
      this.setupWavesFromJSON(this.map);

      this.ready = true;
    }

    drawMapFromJSON(map: MapDef) {
      const mark = (x: number, y: number) => this.blockedTiles.add(this.tileKey(x, y));

      for (const lane of map.paths) {
        for (const p of lane) {
          if (p.x >= 0 && p.x < map.width && p.y >= 0 && p.y < map.height) {
            const cx = p.x * map.tileSize + map.tileSize / 2;
            const cy = p.y * map.tileSize + map.tileSize / 2;
            this.add.image(cx, cy, 'terrain64', map.terrain).setDepth(50);
            mark(p.x, p.y);
          }
        }
      }

      for (const r of map.buildMask) {
        for (let x = r.x; x < r.x + r.w; x++)
          for (let y = r.y; y < r.y + r.h; y++) mark(x, y);
      }
    }

    /** Elige un frame de enemigo que exista; evita "__MISSING" */
    pickEnemyVisual() {
      const candidates: { key: string; frame: string }[] = [
        { key: 'enemies48', frame: 'Demon Lord' },
        { key: 'enemies48', frame: 'Death Knight' },
        { key: 'enemies40', frame: 'Armored Knight' },
        { key: 'enemies40', frame: 'Dark Mage' },
        { key: 'enemies32', frame: 'Goblin Scout' },
        { key: 'enemies32', frame: 'Orc Warrior' },
      ];
      for (const c of candidates) {
        const tex = this.textures.exists(c.key) ? this.textures.get(c.key) : null;
        // @ts-ignore
        if (tex && typeof tex.has === 'function' && tex.has(c.frame)) return c;
      }
      return { key: 'enemies32', frame: 'Goblin Scout' };
    }

    /* ------------------------- Waves ------------------------- */
    setupWavesFromJSON(map: MapDef) {
      this.waveIndex = 0;
      const next = () => {
        this.waveIndex++;
        const W = map.waves;
        const count = W.baseCount + this.waveIndex * W.countPerWave;
        const hp    = W.baseHP    + this.waveIndex * W.hpPerWave;
        const speed = W.baseSpeed + this.waveIndex * W.speedPerWave;

        const pathIdx = (this.laneToggle++ % 2 === 0) ? 0 : 1;
        const pathTiles = map.paths[pathIdx];
        const pathWorld = pathTiles.map(pt => ({
          x: pt.x * map.tileSize + map.tileSize / 2,
          y: pt.y * map.tileSize + map.tileSize / 2,
        }));

        for (let i = 0; i < count; i++) {
          this.time.delayedCall(i * W.spawnDelayMs, () => this.spawnEnemy(pathWorld, hp, speed));
        }

        if (this.waveIndex % 3 === 0) {
          const other = map.paths[pathIdx ? 0 : 1].map(pt => ({
            x: pt.x * map.tileSize + map.tileSize / 2,
            y: pt.y * map.tileSize + map.tileSize / 2,
          }));
          for (let i = 0; i < Math.floor(count * 0.7); i++) {
            this.time.delayedCall(i * W.spawnDelayMs, () => this.spawnEnemy(other, Math.floor(hp * 0.9), speed));
          }
        }

        this.time.delayedCall(count * W.spawnDelayMs + 5500, next);
      };
      next();
    }

    spawnEnemy(path: { x: number; y: number }[], hp: number, speed: number) {
      const start = path[0];
      const vis = this.pickEnemyVisual();
      const e = this.add.image(start.x, start.y, vis.key, vis.frame).setDepth(120);
      this.enemies.add(e);
      (e as any).hp = hp;
      (e as any).maxhp = hp;
      (e as any).speed = speed;
      (e as any).pathIndex = 1;

      const bar = this.add.rectangle(e.x, e.y - 18, 24, 3, 0x57ff57).setOrigin(0.5, 0.5).setDepth(121);
      (e as any).hpbar = bar;

      (e as any).updateTick = () => {
        const i = (e as any).pathIndex;
        if (i >= path.length) { e.destroy(); bar.destroy(); return; }
        const target = path[i];
        const dx = target.x - e.x, dy = target.y - e.y;
        const dist = Math.hypot(dx, dy);
        const spd = (e as any).speed * (1 / 60);
        if (dist <= spd) { e.setPosition(target.x, target.y); (e as any).pathIndex++; }
        else { e.setPosition(e.x + (dx / dist) * spd, e.y + (dy / dist) * spd); }
        const ratio = Math.max(0, (e as any).hp / (e as any).maxhp);
        bar.setPosition(e.x, e.y - 18).setScale(ratio, 1);
      };
    }

    /* ----------------------- Combate / torres ----------------------- */

    /** Stats efectivos por nivel */
    getTowerStats(t: { model: TowerModel; level: number }) {
      const m = t.model;
      const L = t.level;
      const dmgMul = 1 + 0.25 * L;           // +25% daño por nivel
      const cdMul  = Math.pow(0.92, L);      // -8% CD por nivel
      const range  = m.range + 12 * L;       // +12 rango por nivel
      const dmg    = Math.round(m.dmg * dmgMul);

      // Clonar ajustes que escalan
      const dot = m.dot ? { dps: Math.round(m.dot.dps * dmgMul), ms: m.dot.ms } : undefined;
      const slow = m.slow ? { factor: Math.max(0.5, m.slow.factor), ms: m.slow.ms + 100 * L } : undefined;
      const chain = m.chain ? { ...m.chain } : undefined;

      return { dmg, range, cd: Math.max(120, Math.round(m.cd * cdMul)), projectile: m.projectile, fam: m.fam, dot, slow, chain, frame: m.frame };
    }

    /** Coste de upgrade (geométrico) */
    getUpgradeCost(t: { model: TowerModel; level: number }) {
      const base = t.model.cost;
      return Math.round(base * Math.pow(1.45, t.level + 1)); // L0->1 ~1.45x, etc.
    }

    /** Reembolso de venta: 70% de lo invertido total */
    getSellRefund(t: { totalSpent: number }) {
      return Math.max(1, Math.floor(t.totalSpent * 0.7));
    }

    showTowerTooltip(t: any) {
      const s = this.getTowerStats(t);
      this.rangeCircle.setVisible(true).setPosition(t.sprite.x, t.sprite.y).setRadius(s.range);
      const dps = (s.dmg * 1000 / s.cd).toFixed(1);
      this.tooltip
        .setVisible(true)
        .setPosition(t.sprite.x + 18, t.sprite.y - 18)
        .setText(`T: ${s.frame}  Lvl ${t.level}\nDPS ${dps} · Range ${s.range} · CD ${s.cd}ms`);
    }

    openTowerPanel(t: any) {
      // Cerrar otros
      this.towers.forEach(tt => { if (tt !== t) this.closeTowerPanel(tt); });

      if (t.panel && t.panel.active) { this.closeTowerPanel(t); return; }

      const s = this.getTowerStats(t);
      const upCost = this.getUpgradeCost(t);
      const refund = this.getSellRefund(t);

      const container = this.add.container(t.sprite.x + 56, t.sprite.y - 6).setDepth(500);
      const bg = this.add.rectangle(0, 0, 160, 70, 0x0e1420, 0.92).setStrokeStyle(1, 0x6aa0ff, 0.8);
      const title = this.add.text(-70, -28, `Lvl ${t.level}`, { fontFamily: 'monospace', fontSize: '12px', color: '#9ad0ff' });

      const btnUp = this.add.rectangle(-50, 10, 90, 24, 0x16304a, 0.95).setStrokeStyle(1, 0x8ecbff, 0.9);
      const txtUp = this.add.text(-86, 3, `Upgrade (${upCost})`, { fontFamily: 'monospace', fontSize: '12px', color: '#cfe8ff' });

      const btnSell = this.add.rectangle(48, 10, 60, 24, 0x2d1a1a, 0.95).setStrokeStyle(1, 0xff9c9c, 0.9);
      const txtSell = this.add.text(20, 3, `Sell +${refund}`, { fontFamily: 'monospace', fontSize: '12px', color: '#ffd6d6' });

      const closeX = this.add.text(66, -32, '✕', { fontFamily: 'monospace', fontSize: '12px', color: '#cbd5ff' });

      [bg, btnUp, btnSell, txtUp, txtSell, title, closeX].forEach(it => { (it as any).setInteractive?.(); });

      container.add([bg, title, btnUp, txtUp, btnSell, txtSell, closeX]);

      const consume = () => { this.clickConsumed = true; this.time.delayedCall(0, () => (this.clickConsumed = false)); };

      btnUp.on('pointerup', () => {
        consume();
        const cost = this.getUpgradeCost(t);
        if (this.gold < cost) return;
        this.gold -= cost;
        this.goldText.setText(`🪙 ${this.gold}`);
        t.level += 1;
        t.totalSpent += cost;
        try { this.sound.play('coin', { volume: 0.2 }); } catch {}
        this.showTowerTooltip(t);
        this.closeTowerPanel(t); // cierra y fuerza recalcular texto si reabre
      });

      btnSell.on('pointerup', () => {
        consume();
        const refundVal = this.getSellRefund(t);
        this.gold += refundVal;
        this.goldText.setText(`🪙 ${this.gold}`);
        try { this.sound.play('coin', { volume: 0.25 }); } catch {}
        t.sprite.destroy();
        this.closeTowerPanel(t);
        this.towers = this.towers.filter((x: any) => x !== t);
        this.rangeCircle.setVisible(false);
        this.tooltip.setVisible(false);
      });

      closeX.on('pointerup', () => { consume(); this.closeTowerPanel(t); });

      t.panel = container;
    }

    closeTowerPanel(t: any) {
      if (t.panel && t.panel.active) t.panel.destroy();
      t.panel = undefined;
    }

    fireAt(t: { sprite: any; model: TowerModel; level: number }, target: any) {
      const s = this.getTowerStats(t);
      const p = this.add.image(t.sprite.x, t.sprite.y, 'projectiles', s.projectile).setDepth(200);
      this.projectiles.add(p);
      (p as any).vx = (target.x - p.x);
      (p as any).vy = (target.y - p.y);
      const len = Math.hypot((p as any).vx, (p as any).vy) || 1;
      const speed = 520;
      (p as any).vx = (p as any).vx / len * speed * (1 / 60);
      (p as any).vy = (p as any).vy / len * speed * (1 / 60);
      (p as any).dmg = s.dmg;
      (p as any).fam = s.fam;
      (p as any).slow = s.slow;
      (p as any).dot  = s.dot;
      (p as any).chain= s.chain;
      (p as any).ttl = 900;

      try { this.sound.play('shoot', { volume: 0.25 }); } catch {}
    }

    chainLightning(origin: any, baseDmg: number, hops: number, falloff: number) {
      const visited = new Set<any>();
      const queue: { node: any; dmg: number; depth: number }[] = [];
      visited.add(origin);
      queue.push({ node: origin, dmg: baseDmg, depth: 0 });

      while (queue.length) {
        const { node, dmg, depth } = queue.shift()!;
        if (depth >= hops) continue;

        let best: any = null;
        let bestD = 999999;
        this.enemies.getChildren().forEach((c: any) => {
          if (!c || !c.active || visited.has(c)) return;
          const d = PhaserLib.Math.Distance.Between(node.x, node.y, c.x, c.y);
          if (d < 140 && d < bestD) { best = c; bestD = d; }
        });

        if (best) {
          const g = this.add.graphics().setDepth(220);
          g.lineStyle(2, 0x9ad0ff, 0.85);
          g.beginPath(); g.moveTo(node.x, node.y); g.lineTo(best.x, best.y); g.strokePath();
          this.time.delayedCall(80, () => g.destroy());

          (best as any).hp -= Math.max(1, Math.round(dmg));
          visited.add(best);

          queue.push({ node: best, dmg: dmg * falloff, depth: depth + 1 });
        }
      }
    }

    doHit(proj: any, enemy: any) {
      const e: any = enemy;
      const fam = proj.fam as FamKey;
      const baseDmg = proj.dmg as number;

      e.hp -= baseDmg;

      // Capturar valores en constantes (no referenciar `proj` luego)
      if (fam === 'frost' && proj.slow) {
        const slowFactor: number = proj.slow.factor;
        const slowMs: number = proj.slow.ms;
        const old = e.speed;
        e.speed = old * slowFactor;
        this.time.delayedCall(slowMs, () => e && (e.speed = old));
      }
      if ((fam === 'fire' || fam === 'nature') && proj.dot) {
        const dotDps: number = proj.dot.dps;
        const dotMs: number = proj.dot.ms;
        const ticks = Math.floor(dotMs / 300);
        for (let i = 1; i <= ticks; i++) {
          this.time.delayedCall(i * 300, () => e && (e.hp -= Math.round(dotDps * 0.3)));
        }
      }
      if (fam === 'electric' && proj.chain) {
        const hops = proj.chain.hops as number;
        const falloff = proj.chain.falloff as number;
        this.chainLightning(enemy, baseDmg, hops, falloff);
      }

      if (e.hp <= 0) {
        const puff = this.add.image(e.x, e.y, 'fx', 'Poison Cloud').setDepth(210);
        this.time.delayedCall(220, () => puff.destroy());

        e.hpbar?.destroy();
        e.destroy();
        this.gold += 6 + Math.floor(this.waveIndex * 0.6);
        this.goldText.setText(`🪙 ${this.gold}`);
        try { this.sound.play('coin', { volume: 0.25 }); } catch {}
      }

      proj.destroy();
    }

    update(time: number, dt: number) {
      if (!this.ready || !this.enemies || !this.projectiles) return;

      this.enemies.getChildren().forEach((e: any) => e?.updateTick?.());

      for (const t of this.towers) {
        const s = this.getTowerStats(t);
        if (time < t.last + s.cd) continue;

        let best: any = null;
        let bestD = 1e9;
        this.enemies.getChildren().forEach((c: any) => {
          if (!c || !c.active) return;
          const d = PhaserLib.Math.Distance.Between(t.sprite.x, t.sprite.y, c.x, c.y);
          if (d < s.range && d < bestD) { best = c; bestD = d; }
        });
        if (best) {
          t.last = time;
          this.fireAt(t, best);
        }
      }

      this.projectiles.getChildren().forEach((p: any) => {
        p.x += p.vx; p.y += p.vy; p.ttl -= dt;
        if (p.ttl <= 0) { p.destroy(); return; }
        let hit: any = null;
        this.enemies.getChildren().some((e: any) => {
          if (!e || !e.active) return false;
          const d = PhaserLib.Math.Distance.Between(p.x, p.y, e.x, e.y);
          if (d < 18) { hit = e; return true; }
          return false;
        });
        if (hit) this.doHit(p, hit);
      });
    }
  };
}

/* --------------------------- Componente React --------------------------- */
export default function BattleClient() {
  const rootRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<any>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (!PhaserLib) return;
    setMounted(true);

    const TD = createSceneClass();
    const config: any = {
      type: PhaserLib.AUTO,
      width: 1180,
      height: 680,
      parent: rootRef.current || undefined,
      backgroundColor: '#0c0e12',
      physics: { default: 'arcade' },
      scene: TD,
      scale: { mode: PhaserLib.Scale.FIT, autoCenter: PhaserLib.Scale.CENTER_BOTH },
      render: { pixelArt: true, antialias: false },
    };

    gameRef.current = new PhaserLib.Game(config);

    return () => {
      try { gameRef.current?.destroy(true); } catch {}
      gameRef.current = null;
    };
  }, []);

  return (
    <div style={{ padding: '8px' }}>
      <h3 style={{ color: '#e8f4ff', fontFamily: 'monospace', margin: '4px 0' }}>
        Fluent Tower Defense — MVP+
      </h3>
      <div style={{ color: '#a9b7ff', fontFamily: 'monospace', fontSize: 12, marginBottom: 6 }}>
        Click coloca · <b>1</b>=⚡ / <b>2</b>=🔥 / <b>3</b>=❄ / <b>4</b>=🌿 · <b>←/→</b> cambia skin ·
        <b> Espacio</b> pausa · <b>F</b> x2 · Click torre para <b>Upgrade/Vender</b>
      </div>
      <div ref={rootRef} style={{ width: '100%', height: 'calc(100vh - 120px)' }} />
      {!mounted && <div style={{ color: '#99a', fontFamily: 'monospace', marginTop: 8 }}>Cargando…</div>}
    </div>
  );
}
