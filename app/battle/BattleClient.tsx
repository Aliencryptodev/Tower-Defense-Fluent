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
  };
  lives?: number;
};

type FamKey = 'electric' | 'fire' | 'frost';

type TowerModel = {
  frame: string;
  fam: FamKey;
  cost: number;
  dmg: number;
  range: number;
  cd: number;
  projectile: 'Lightning Bolt' | 'Fireball' | 'Ice Shard';
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
const GROUPS: Record<FamKey, TowerModel[]> = { electric: ELECTRIC, fire: FIRE, frost: FROST };

/* ------------------- Enemigos (tipos + resistencias) ------------------- */
type EnemyType = 'goblin' | 'runner' | 'brute' | 'boss';
const ENEMY_DEFS: Record<EnemyType, { frame: string; hpMul: number; spdMul: number; dotMul?: number; slowResist?: number; rewardMul?: number }> = {
  goblin: { frame: 'Goblin Scout',  hpMul: 1.0,  spdMul: 1.0 },
  runner: { frame: 'Wolf Rider',    hpMul: 0.7,  spdMul: 1.6, slowResist: 0.5 },
  brute:  { frame: 'Armored Knight',hpMul: 1.8,  spdMul: 0.8, dotMul: 0.5, rewardMul: 1.3 },
  boss:   { frame: 'Ancient Dragon',hpMul: 8.0,  spdMul: 0.7, dotMul: 0.8, slowResist: 0.8, rewardMul: 8 },
};

/* ------------------------- Escena de Phaser ------------------------- */
function createSceneClass() {
  const Phaser = PhaserLib;

  return class TD extends Phaser.Scene {
    map!: MapDef;
    gold = 320;
    waveIndex = 0;
    laneToggle = 0;

    playerLives = 20;
    gameOver = false;

    // Estados de control
    ready = false;
    waveActive = false;
    spawnTimers: any[] = [];    // para cancelar en restart
    prevTimeScale = 1;
    isPaused = false;

    // Grupos
    enemies!: any;
    projectiles!: any;
    projectilePool: any[] = [];

    // Torres
    towers: { sprite: any; model: TowerModel; base: TowerModel; last: number; level: number }[] = [];
    selectedTower: { sprite: any; model: TowerModel; base: TowerModel; last: number; level: number } | null = null;

    // UI
    goldText!: any;
    infoText!: any;
    livesText!: any;
    waveText!: any;
    startBtn!: any;
    speedBtn!: any;
    muteBtn!: any;
    overlay!: any;
    overlayTxt!: any;
    retryBtn!: any;

    // Tooltips / ayudas
    tooltip!: any;
    rangeCircle!: any;
    hoverRect!: any;
    costTip!: any;

    // selección actual
    selFam: FamKey = 'electric';
    selIdx = 0;

    // celdas bloqueadas
    blockedTiles = new Set<string>();

    worldToTile(x: number, y: number) { return { tx: Math.floor(x / this.map.tileSize), ty: Math.floor(y / this.map.tileSize) }; }
    tileKey(tx: number, ty: number) { return `${tx},${ty}`; }

    /* ----------------------- PRELOAD ----------------------- */
    preload() {
      this.load.atlas('terrain64',  '/assets/terrain_atlas.png',     '/assets/terrain_atlas.json');
      this.load.atlas('ui32',       '/assets/ui_atlas.png',          '/assets/ui_atlas.json');
      this.load.atlas('towers',     '/assets/towers_atlas.png',      '/assets/towers_atlas.json');
      this.load.atlas('enemies32',  '/assets/enemies32_atlas.png',   '/assets/enemies32_atlas.json');
      this.load.atlas('projectiles','/assets/projectiles_atlas.png', '/assets/projectiles_atlas.json');
      this.load.atlas('fx',         '/assets/effects_atlas.png',     '/assets/effects_atlas.json');

      // Audio opcional (si no está, se ignora)
      try {
        this.load.audio('shoot',  '/audio/shoot.wav');
        this.load.audio('hit',    '/audio/hit.wav');
        this.load.audio('coin',   '/audio/coin.wav');
        this.load.audio('place',  '/audio/place.wav');
        this.load.audio('music',  '/audio/music.mp3');
      } catch {}
    }

    /* ------------------------ CREATE ------------------------ */
    async create() {
      // grupos / pool antes de await
      this.enemies = this.add.group();
      this.projectiles = this.add.group();
      this.projectilePool = [];

      // cargar mapa
      const url = new URL(window.location.href);
      const mapName = (url.searchParams.get('map') || 'grass_dual').replace(/[^a-z0-9_\-]/gi, '');
      this.map = await loadMapDef(mapName);
      this.playerLives = this.map.lives ?? 20;

      this.cameras.main.setBackgroundColor('#0c0e12');

      // UI principal
      this.goldText = this.add.text(16, 16, `🪙 ${this.gold}`, { color: '#ffd76a', fontFamily: 'monospace', fontSize: '18px' }).setDepth(1000);
      this.livesText = this.add.text(120, 16, `❤️ ${this.playerLives}`, { color: '#ff7c7c', fontFamily: 'monospace', fontSize: '18px' }).setDepth(1000);
      this.waveText = this.add.text(220, 16, `🗘 Wave ${this.waveIndex}`, { color: '#b7c7ff', fontFamily: 'monospace', fontSize: '18px' }).setDepth(1000);

      this.infoText = this.add.text(
        16, 36,
        `Click coloca · 1=⚡ / 2=🔥 / 3=❄ · ←/→ cambia skin · Espacio pausa · F x2 · ENTER inicia oleada`,
        { color: '#8fb2ff', fontFamily: 'monospace', fontSize: '12px' }
      ).setDepth(1000);

      this.tooltip = this.add.text(0, 0, '', { color: '#e8f4ff', fontFamily: 'monospace', fontSize: '12px', backgroundColor: 'rgba(0,0,0,0.35)' })
        .setDepth(1200).setVisible(false);

      this.costTip = this.add.text(0, 0, '', { color: '#ffd76a', fontFamily: 'monospace', fontSize: '12px', backgroundColor: 'rgba(0,0,0,0.35)' })
        .setDepth(1200).setVisible(false);

      this.rangeCircle = this.add.circle(0, 0, 50, 0x4cc2ff, 0.12).setStrokeStyle(2, 0x4cc2ff, 0.8).setDepth(200).setVisible(false);
      this.hoverRect = this.add.rectangle(0, 0, this.map.tileSize, this.map.tileSize, 0x00ff00, 0.15)
        .setStrokeStyle(2, 0x00ff00, 0.7).setDepth(180).setVisible(false);

      // HUD botones
      this.startBtn = this.makeBtn(360, 14, '[ ▶ Siguiente Oleada ]', () => this.tryStartWave());
      this.speedBtn = this.makeBtn(640, 14, '[ x1 ]', () => this.toggleSpeed());
      this.muteBtn  = this.makeBtn(740, 14, '[ 🔇 ]', () => this.toggleMute());

      // Música (opcional)
      try {
        const m = this.sound.add('music', { loop: true, volume: 0.35 });
        m.play();
      } catch {}

      // mapa
      this.drawMapFromJSON(this.map);

      // Colocar torres
      this.input.on('pointermove', (p: any) => this.updateHover(p.worldX, p.worldY));
      this.input.on('pointerdown', (p: any) => this.tryPlaceTower(p.worldX, p.worldY));

      // Teclado
      this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
        if (e.key === '1') { this.selFam = 'electric'; this.selIdx = 0; }
        if (e.key === '2') { this.selFam = 'fire';     this.selIdx = 0; }
        if (e.key === '3') { this.selFam = 'frost';    this.selIdx = 0; }
        if (e.key === 'ArrowLeft')  this.selIdx = (this.selIdx + GROUPS[this.selFam].length - 1) % GROUPS[this.selFam].length;
        if (e.key === 'ArrowRight') this.selIdx = (this.selIdx + 1) % GROUPS[this.selFam].length;
        if (e.code === 'Space') this.togglePause();
        if (e.key === 'f' || e.key === 'F') this.toggleSpeed();
        if (e.key === 'Enter') this.tryStartWave();
        if (e.key === 'Escape') this.clearTowerSelection();
      });

      this.ready = true;
    }

    /* ----------------------- UI helpers ----------------------- */
    makeBtn(x: number, y: number, label: string, onClick: () => void) {
      const t = this.add.text(x, y, label, { color: '#e8f4ff', fontFamily: 'monospace', fontSize: '14px', backgroundColor: 'rgba(255,255,255,0.07)' })
        .setDepth(1100).setPadding(6, 2, 6, 2).setInteractive({ cursor: 'pointer', useHandCursor: true });
      t.on('pointerdown', onClick);
      t.on('pointerover', () => t.setStyle({ backgroundColor: 'rgba(255,255,255,0.12)' }));
      t.on('pointerout',  () => t.setStyle({ backgroundColor: 'rgba(255,255,255,0.07)' }));
      return t;
    }

    setSpeedLabel() {
      this.speedBtn?.setText(this.time.timeScale === 1 ? '[ x1 ]' : '[ x2 ]');
    }
    setMuteLabel() {
      const muted = (this.sound as any).mute === true;
      this.muteBtn?.setText(muted ? '[ 🔇 ]' : '[ 🔊 ]');
    }
    toggleSpeed() {
      this.time.timeScale = this.time.timeScale === 1 ? 2 : 1;
      this.setSpeedLabel();
    }
    toggleMute() {
      (this.sound as any).mute = !(this.sound as any).mute;
      this.setMuteLabel();
    }

    togglePause() {
      if (this.gameOver || !this.ready) return;
      if (!this.isPaused) {
        this.prevTimeScale = this.time.timeScale;
        this.isPaused = true;
        this.scene.pause();
      } else {
        this.isPaused = false;
        this.scene.resume();
        this.time.timeScale = this.prevTimeScale || 1;
      }
    }

    /* ----------------------- MAPA/RENDER ----------------------- */
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

    /* ------------------- Colocación de torres ------------------- */
    updateHover(wx: number, wy: number) {
      const { tx, ty } = this.worldToTile(wx, wy);
      if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) {
        this.hoverRect.setVisible(false); this.costTip.setVisible(false); return;
      }
      const x = tx * this.map.tileSize + this.map.tileSize / 2;
      const y = ty * this.map.tileSize + this.map.tileSize / 2;
      const blocked = this.blockedTiles.has(this.tileKey(tx, ty));

      const model = GROUPS[this.selFam][this.selIdx];
      this.hoverRect.setVisible(true).setPosition(x, y);
      this.hoverRect.setStrokeStyle(2, blocked ? 0xff4444 : 0x44ff44, 0.7).setFillStyle(blocked ? 0xff4444 : 0x44ff44, 0.12);

      this.costTip.setVisible(true).setPosition(x + 18, y - 18).setText(`Coste: ${model.cost}${this.gold < model.cost ? ' (no hay oro)' : ''}`);
      this.costTip.setColor(this.gold < model.cost ? '#ff9a9a' : '#ffd76a');
    }

    tryPlaceTower(wx: number, wy: number) {
      const model = GROUPS[this.selFam][this.selIdx];
      const { tx, ty } = this.worldToTile(wx, wy);
      if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) return;
      if (this.blockedTiles.has(this.tileKey(tx, ty))) return;
      if (this.gold < model.cost) return;

      this.gold -= model.cost;
      this.goldText.setText(`🪙 ${this.gold}`);

      const x = tx * this.map.tileSize + this.map.tileSize / 2;
      const y = ty * this.map.tileSize + this.map.tileSize / 2;
      const spr = this.add.image(x, y, 'towers', model.frame).setDepth(300).setInteractive({ cursor: 'pointer' });
      const tower = { sprite: spr, model: { ...model }, base: { ...model }, last: 0, level: 1 };
      this.towers.push(tower);

      try { this.sound.play('place', { volume: 0.8 }); } catch {}

      spr.on('pointerover', () => {
        this.rangeCircle.setVisible(true).setPosition(spr.x, spr.y).setRadius(tower.model.range);
        const dps = (tower.model.dmg * 1000 / tower.model.cd).toFixed(1);
        this.tooltip.setVisible(true).setPosition(spr.x + 18, spr.y - 18)
          .setText(`T: ${tower.model.frame}\nLvl ${tower.level} · DPS ${dps} · Rng ${tower.model.range} · CD ${tower.model.cd}ms\n[Click] seleccionar`);
      });
      spr.on('pointerout', () => { this.rangeCircle.setVisible(false); this.tooltip.setVisible(false); });
      spr.on('pointerdown', () => this.selectTower(tower));
    }

    selectTower(t: any) {
      this.selectedTower = t;
      // Mini panel textual junto a la torre
      const x = t.sprite.x + 18, y = t.sprite.y + 18;
      const upCost = Math.ceil(t.base.cost * (t.level + 0.5));
      const sell = Math.floor(t.base.cost * 0.6 * t.level);
      this.tooltip.setVisible(true).setPosition(x, y)
        .setText(
          `▶ ${t.model.frame} (Lvl ${t.level})\nUpgrade: +25% dmg, +10% rng, -10% cd\n` +
          `Coste upgrade: ${upCost}\nVender: ${sell}\n[U] mejorar, [V] vender, [ESC] cerrar`
        );

      // Atajos de teclado para la torre seleccionada
      const onKey = (e: KeyboardEvent) => {
        if (!this.selectedTower) return;
        if (e.key === 'u' || e.key === 'U') this.upgradeSelected();
        if (e.key === 'v' || e.key === 'V') this.sellSelected();
        if (e.key === 'Escape') this.clearTowerSelection();
      };
      this.input.keyboard?.off('keydown', onKey);
      this.input.keyboard?.on('keydown', onKey);
    }
    clearTowerSelection() {
      this.selectedTower = null;
      this.tooltip.setVisible(false);
    }

    upgradeSelected() {
      const t = this.selectedTower;
      if (!t) return;
      const cost = Math.ceil(t.base.cost * (t.level + 0.5));
      if (this.gold < cost) return;
      this.gold -= cost; this.goldText.setText(`🪙 ${this.gold}`);
      t.level += 1;
      t.model.dmg = Math.round(t.model.dmg * 1.25);
      t.model.range = Math.round(t.model.range * 1.10);
      t.model.cd = Math.max(120, Math.round(t.model.cd * 0.90));
      try { this.sound.play('coin', { volume: 0.5 }); } catch {}
      this.selectTower(t); // refrescar tooltip
    }

    sellSelected() {
      const t = this.selectedTower;
      if (!t) return;
      const refund = Math.floor(t.base.cost * 0.6 * t.level);
      this.gold += refund; this.goldText.setText(`🪙 ${this.gold}`);
      t.sprite.destroy();
      this.towers = this.towers.filter(x => x !== t);
      this.clearTowerSelection();
    }

    /* ----------------------- OLEADAS ----------------------- */
    tryStartWave() {
      if (this.waveActive || this.gameOver) return;
      this.startWave();
    }

    startWave() {
      const W = this.map.waves;
      this.waveIndex++;
      this.waveText.setText(`🗘 Wave ${this.waveIndex}`);
      this.waveActive = true;

      const baseCount = W.baseCount + this.waveIndex * W.countPerWave;
      const baseHP    = W.baseHP    + this.waveIndex * W.hpPerWave;
      const baseSpd   = W.baseSpeed + this.waveIndex * W.speedPerWave;
      const gap       = W.spawnDelayMs;

      const pathIdx = (this.laneToggle++ % 2 === 0) ? 0 : 1;
      const pathTiles = this.map.paths[pathIdx];
      const pathWorld = pathTiles.map(pt => ({
        x: pt.x * this.map.tileSize + this.map.tileSize / 2,
        y: pt.y * this.map.tileSize + this.map.tileSize / 2,
      }));

      // Composición: muchos goblins + runners (cada 2), brutes (cada 3) y boss (cada 5)
      const schedule = (delay: number, fn: () => void) => {
        const t = this.time.delayedCall(delay, fn);
        this.spawnTimers.push(t);
      };
      for (let i = 0; i < baseCount; i++) {
        schedule(i * gap, () => this.spawnEnemy(pathWorld, baseHP, baseSpd, 'goblin'));
      }
      if (this.waveIndex % 2 === 0) {
        for (let i = 0; i < Math.floor(baseCount * 0.4); i++) {
          schedule(i * gap * 1.1 + 600, () => this.spawnEnemy(pathWorld, baseHP, baseSpd, 'runner'));
        }
      }
      if (this.waveIndex % 3 === 0) {
        for (let i = 0; i < Math.floor(baseCount * 0.25); i++) {
          schedule(i * gap * 1.3 + 900, () => this.spawnEnemy(pathWorld, baseHP, baseSpd, 'brute'));
        }
      }
      if (this.waveIndex % 5 === 0) {
        schedule(baseCount * gap + 1500, () => this.spawnEnemy(pathWorld, baseHP, baseSpd, 'boss'));
      }

      // Comprobar fin de oleada periódicamente
      const checkEnd = () => {
        if (!this.waveActive) return;
        const anyTimersAlive = this.spawnTimers.some(t => t && t.getProgress() < 1);
        const enemiesAlive = this.enemies.getLength() > 0;
        if (!anyTimersAlive && !enemiesAlive) {
          this.waveActive = false;
          // recompensa por oleada
          const reward = W.rewardBase + Math.floor(this.waveIndex * 2);
          this.gold += reward;
          this.goldText.setText(`🪙 ${this.gold}`);
        } else {
          this.time.delayedCall(900, checkEnd);
        }
      };
      this.time.delayedCall(Math.max(1200, baseCount * gap + 2500), checkEnd);
    }

    /* ----------------------- ENEMIGOS ----------------------- */
    spawnEnemy(path: { x: number; y: number }[], hp: number, speed: number, type: EnemyType) {
      const def = ENEMY_DEFS[type];
      const start = path[0];

      const atlas = (type === 'brute') ? 'enemies40' : (type === 'boss' ? 'enemies48' : 'enemies32');
      const e = this.add.image(start.x, start.y, atlas, def.frame).setDepth(120);
      this.enemies.add(e);
      (e as any).hp = Math.round(hp * def.hpMul);
      (e as any).maxhp = (e as any).hp;
      (e as any).speed = speed * def.spdMul;
      (e as any).pathIndex = 1;
      (e as any).type = type;
      (e as any).dotMul = def.dotMul ?? 1;
      (e as any).slowResist = def.slowResist ?? 1;
      (e as any).rewardMul = def.rewardMul ?? 1;

      const bar = this.add.rectangle(e.x, e.y - 18, 24, 3, 0x57ff57).setOrigin(0.5, 0.5).setDepth(121);
      (e as any).hpbar = bar;

      (e as any).onExit = () => {
        // llega a la meta → pierde vida el jugador
        this.playerLives = Math.max(0, this.playerLives - 1);
        this.livesText.setText(`❤️ ${this.playerLives}`);
        e.hpbar?.destroy();
        e.destroy();
        if (this.playerLives <= 0) this.triggerGameOver();
      };

      (e as any).updateTick = () => {
        const i = (e as any).pathIndex;
        if (i >= path.length) { (e as any).onExit(); return; }
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

    /* ----------------------- DISPAROS ----------------------- */
    getProjectile(x: number, y: number, frame: string) {
      const p = this.projectilePool.pop();
      if (p && p.active === false) {
        p.setPosition(x, y).setFrame(frame).setActive(true).setVisible(true);
        this.projectiles.add(p);
        return p;
      }
      const np = this.add.image(x, y, 'projectiles', frame).setDepth(200);
      this.projectiles.add(np);
      return np;
    }

    fireAt(t: { sprite: any; model: TowerModel }, target: any) {
      const m = t.model;
      const p = this.getProjectile(t.sprite.x, t.sprite.y, m.projectile);
      (p as any).vx = (target.x - p.x);
      (p as any).vy = (target.y - p.y);
      const len = Math.hypot((p as any).vx, (p as any).vy) || 1;
      const speed = 520;
      (p as any).vx = (p as any).vx / len * speed * (1 / 60);
      (p as any).vy = (p as any).vy / len * speed * (1 / 60);
      (p as any).dmg = m.dmg;
      (p as any).fam = m.fam;
      (p as any).slow = m.slow;
      (p as any).dot  = m.dot;
      (p as any).chain= m.chain;
      (p as any).ttl = 900;

      try { this.sound.play('shoot', { volume: 0.2 }); } catch {}
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
      const p: any = proj; const e: any = enemy;
      let realDmg = p.dmg;

      if (p.fam === 'frost' && p.slow) {
        const old = e.speed;
        const resist = e.slowResist ?? 1;
        e.speed = old * (p.slow.factor + (1 - p.slow.factor) * (1 - resist)); // aplica resistencia
        this.time.delayedCall(p.slow.ms, () => e && (e.speed = old));
      }
      if (p.fam === 'fire' && p.dot) {
        const mul = e.dotMul ?? 1;
        const ticks = Math.floor(p.dot.ms / 300);
        for (let i = 1; i <= ticks; i++) {
          this.time.delayedCall(i * 300, () => e && (e.hp -= Math.round(p.dot.dps * mul * 0.3)));
        }
      }
      if (p.fam === 'electric' && p.chain) {
        this.chainLightning(enemy, p.dmg, p.chain.hops, p.chain.falloff);
      }

      e.hp -= realDmg;

      if (e.hp <= 0) {
        const puff = this.add.image(e.x, e.y, 'fx', 'Poison Cloud').setDepth(210);
        this.time.delayedCall(220, () => puff.destroy());

        try { this.sound.play('hit', { volume: 0.2 }); } catch {}
        e.hpbar?.destroy();
        e.destroy();
        const bonus = Math.floor(this.waveIndex * 0.6);
        const mul = e.rewardMul ?? 1;
        this.gold += Math.round((6 + bonus) * mul);
        this.goldText.setText(`🪙 ${this.gold}`);
      }

      // “destruir” → a pool
      p.setActive(false).setVisible(false);
      this.projectiles.remove(p);
      this.projectilePool.push(p);
    }

    /* ------------------------ UPDATE ------------------------ */
    update(time: number, dt: number) {
      if (!this.ready || !this.enemies || !this.projectiles) return;

      this.enemies.getChildren().forEach((e: any) => e?.updateTick?.());

      for (const t of this.towers) {
        if (time < t.last + t.model.cd) continue;
        let best: any = null;
        let bestD = 1e9;
        this.enemies.getChildren().forEach((c: any) => {
          if (!c || !c.active) return;
          const d = PhaserLib.Math.Distance.Between(t.sprite.x, t.sprite.y, c.x, c.y);
          if (d < t.model.range && d < bestD) { best = c; bestD = d; }
        });
        if (best) {
          t.last = time;
          this.fireAt(t, best);
        }
      }

      this.projectiles.getChildren().forEach((p: any) => {
        if (!p.active) return;
        p.x += p.vx; p.y += p.vy; p.ttl -= dt;
        if (p.ttl <= 0) {
          p.setActive(false).setVisible(false);
          this.projectiles.remove(p);
          this.projectilePool.push(p);
          return;
        }
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

    /* --------------------- GAME OVER / RESTART --------------------- */
    triggerGameOver() {
      if (this.gameOver) return;
      this.gameOver = true;
      this.isPaused = true;

      // Overlay
      const { width, height } = this.scale.gameSize;
      this.overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.6).setDepth(4000);
      this.overlayTxt = this.add.text(width / 2, height / 2 - 20, 'GAME OVER', { color: '#ff9a9a', fontFamily: 'monospace', fontSize: '36px' })
        .setOrigin(0.5).setDepth(4001);
      this.retryBtn = this.makeBtn(width / 2 - 60, height / 2 + 20, '[ Reintentar ]', () => this.scene.restart());

      // limpiar timers de spawn pendientes
      this.spawnTimers.forEach(t => { try { t.remove(false); } catch {} });
      this.spawnTimers = [];
      this.waveActive = false;
      this.scene.pause(); // pausa escena (bloquea update)
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
        Click para colocar · <b>1</b>=⚡ / <b>2</b>=🔥 / <b>3</b>=❄ · <b>←/→</b> cambia skin ·
        <b> Espacio</b> pausa · <b>F</b> x2 · <b>ENTER</b> inicia oleada · Click torre para <b>Upgrade/Vender</b>
      </div>
      <div ref={rootRef} style={{ width: '100%', height: 'calc(100vh - 120px)' }} />
      {!mounted && <div style={{ color: '#99a', fontFamily: 'monospace', marginTop: 8 }}>Cargando…</div>}
    </div>
  );
}
