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

type Difficulty = 'easy'|'normal'|'hard';

async function loadMapDef(name: string): Promise<MapDef> {
  const res = await fetch(`/maps/${name}.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`map ${name} not found`);
  return res.json();
}

/* ----------------------------- Torretas ----------------------------- */
const ELECTRIC: TowerModel[] = [
  { frame: 'Arc Coil I',       fam: 'electric', cost: 45,  dmg: 18, range: 190, cd: 700, projectile: 'Lightning Bolt', chain: { hops: 2, falloff: 0.7 } },
  { frame: 'Tesla Grid III',   fam: 'electric', cost: 85,  dmg: 30, range: 210, cd: 620, projectile: 'Lightning Bolt', chain: { hops: 3, falloff: 0.7 } },
  { frame: 'Storm Lord V',     fam: 'electric', cost: 140, dmg: 48, range: 230, cd: 540, projectile: 'Lightning Bolt', chain: { hops: 4, falloff: 0.7 } },
  { frame: 'Reality Rift V',   fam: 'electric', cost: 200, dmg: 52, range: 260, cd: 480, projectile: 'Lightning Bolt', chain: { hops: 5, falloff: 0.75 } },
];
const FIRE: TowerModel[] = [
  { frame: 'Flame Turret I',     fam: 'fire', cost: 45,  dmg: 14, range: 150, cd: 600, projectile: 'Fireball',   dot: { dps: 6,  ms: 1200 } },
  { frame: 'Inferno Core III',   fam: 'fire', cost: 85,  dmg: 22, range: 165, cd: 520, projectile: 'Fireball',   dot: { dps: 10, ms: 1400 } },
  { frame: 'Phoenix Gate V',     fam: 'fire', cost: 140, dmg: 30, range: 180, cd: 480, projectile: 'Fireball',   dot: { dps: 16, ms: 1600 } },
  { frame: 'Inferno Citadel V',  fam: 'fire', cost: 200, dmg: 36, range: 190, cd: 450, projectile: 'Fireball',   dot: { dps: 22, ms: 1700 } },
];
const FROST: TowerModel[] = [
  { frame: 'Ice Shard I',        fam: 'frost', cost: 45,  dmg: 16, range: 180, cd: 640, projectile: 'Ice Shard', slow: { factor: 0.7, ms: 1200 } },
  { frame: 'Frost Cannon III',   fam: 'frost', cost: 85,  dmg: 26, range: 200, cd: 560, projectile: 'Ice Shard', slow: { factor: 0.6, ms: 1500 } },
  { frame: 'Absolute Zero V',    fam: 'frost', cost: 140, dmg: 40, range: 220, cd: 520, projectile: 'Ice Shard', slow: { factor: 0.5, ms: 1800 } },
  { frame: 'World Tree V',       fam: 'frost', cost: 200, dmg: 34, range: 240, cd: 500, projectile: 'Ice Shard', slow: { factor: 0.45, ms: 1900 } },
];
const GROUPS: Record<FamKey, TowerModel[]> = { electric: ELECTRIC, fire: FIRE, frost: FROST };

/* ------------------------- Escena de Phaser ------------------------- */
function createSceneClass() {
  const Phaser = PhaserLib;

  return class TD extends Phaser.Scene {
    map!: MapDef;

    // Economía / progreso
    gold = 320;
    lives = 20;
    waveIndex = 0;
    maxWaves = 20;
    laneToggle = 0;
    diff: Difficulty = 'normal';

    // Flags
    ready = false;
    waveRunning = false;
    gameOver = false;
    muted = false;

    // Grupos / entidades
    enemies!: any;
    projectiles!: any;
    projPool: any[] = []; // pooling simple
    towers: { sprite: any; model: TowerModel; last: number; level: number }[] = [];

    // UI
    goldText!: any;
    livesText!: any;
    infoText!: any;
    waveText!: any;
    tooltip!: any;
    rangeCircle!: any;

    // HUD extra
    hotbar!: any;
    hotbarIcons: any[] = [];
    ghost!: any; // preview de torre

    // selección
    selFam: FamKey = 'electric';
    selIdx = 0;

    blockedTiles = new Set<string>();

    // control spawn/fin de ola
    lastWaveSpawnFinishAt = 0;
    wavePlanned = 0;
    waveKilled = 0;
    waveLeaked = 0;
    waveBarBg!: any;
    waveBarFg!: any;
    waveCountText!: any;

    /* -------------------- util -------------------- */
    worldToTile(x: number, y: number) { return { tx: Math.floor(x / this.map.tileSize), ty: Math.floor(y / this.map.tileSize) }; }
    tileKey(tx: number, ty: number) { return `${tx},${ty}`; }
    isBuildable(tx: number, ty: number, model: TowerModel) {
      if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) return false;
      if (this.blockedTiles.has(this.tileKey(tx, ty))) return false;
      if (this.gold < model.cost) return false;
      return true;
    }

    /* -------------------- preload -------------------- */
    preload() {
      // Atlases
      this.load.atlas('terrain64',  '/assets/terrain_atlas.png',     '/assets/terrain_atlas.json');
      this.load.atlas('ui32',       '/assets/ui_atlas.png',          '/assets/ui_atlas.json');
      this.load.atlas('towers',     '/assets/towers_atlas.png',      '/assets/towers_atlas.json');
      this.load.atlas('enemies32',  '/assets/enemies32_atlas.png',   '/assets/enemies32_atlas.json');
      this.load.atlas('enemies40',  '/assets/enemies40_atlas.png',   '/assets/enemies40_atlas.json');
      this.load.atlas('enemies48',  '/assets/enemies48_atlas.png',   '/assets/enemies48_atlas.json');
      this.load.atlas('enemies64',  '/assets/enemies64_atlas.png',   '/assets/enemies64_atlas.json');
      this.load.atlas('projectiles','/assets/projectiles_atlas.png', '/assets/projectiles_atlas.json');
      this.load.atlas('fx',         '/assets/effects_atlas.png',     '/assets/effects_atlas.json');

      // Audio (si no existen, aparecerá 404 innocuo)
      try { this.load.audio('coin',  ['/audio/coin.mp3',  '/audio/coin.wav']); } catch {}
      try { this.load.audio('hit',   ['/audio/hit.mp3',   '/audio/hit.wav']); } catch {}
      try { this.load.audio('place', ['/audio/place.mp3', '/audio/place.wav']); } catch {}
      try { this.load.audio('shoot', ['/audio/shoot.mp3','/audio/shoot.wav','/audio/shot.wav']); } catch {}
      try { this.load.audio('music', ['/audio/music.mp3','/audio/music.wav']); } catch {}
    }

    /* -------------------- create -------------------- */
    async create() {
      // dificultad desde query
      const url = new URL(window.location.href);
      this.diff = (url.searchParams.get('diff') as Difficulty) || 'normal';

      const diffMul = this.getDiffMultipliers(this.diff);
      this.gold = Math.round(this.gold * diffMul.gold);
      this.lives = Math.round(this.lives * diffMul.lives);

      // Grupos
      this.enemies = this.add.group();
      this.projectiles = this.add.group();

      // Cargar mapa
      const mapName = (url.searchParams.get('map') || 'grass_dual').replace(/[^a-z0-9_\-]/gi, '');
      this.map = await loadMapDef(mapName);
      this.cameras.main.setBackgroundColor('#0c0e12');

      // UI básica
      this.goldText = this.add.text(16, 16, `🪙 ${this.gold}`, {
        color: '#ffd76a', fontFamily: 'monospace', fontSize: '18px'
      }).setDepth(1000);

      this.livesText = this.add.text(120, 16, `❤️ ${this.lives}`, {
        color: '#ff8080', fontFamily: 'monospace', fontSize: '18px'
      }).setDepth(1000);

      this.waveText = this.add.text(220, 16, `🧠 Wave 0`, {
        color: '#d9f', fontFamily: 'monospace', fontSize: '18px'
      }).setDepth(1000);

      this.infoText = this.add.text(
        16, 34,
        `Click coloca · 1=⚡ / 2=🔥 / 3=❄ · 4=atajo ⚡ (4ª) · ←/→ cambia skin · Espacio pausa · F x2 · ENTER inicia · Click torre => Upgrade/Vender`,
        { color: '#b7c7ff', fontFamily: 'monospace', fontSize: '12px' }
      ).setDepth(1000);

      this.tooltip = this.add.text(0, 0, '', {
        color: '#e8f4ff', fontFamily: 'monospace', fontSize: '12px',
        backgroundColor: 'rgba(0,0,0,0.35)'
      }).setDepth(1200).setVisible(false);

      this.rangeCircle = this.add.circle(0, 0, 50, 0x4cc2ff, 0.12)
        .setStrokeStyle(2, 0x4cc2ff, 0.8).setDepth(200).setVisible(false);

      // Pintar mapa
      this.drawMapFromJSON(this.map);

      // HUD extra: botones táctiles, hotbar, barra de oleada y ghost
      this.buildTouchUI();
      this.buildHotbar();
      this.buildWaveBar();
      this.buildGhost();

      // Colocar torres / abrir menú si clicas sobre una / ignorar UI
      this.input.on('pointerdown', (p: any) => {
        if (this.gameOver) return;

        const objects = this.input.hitTestPointer(p) as any[];
        // 1) si clicas sobre UI, no colocar
        if (objects.some(o => o?.getData && o.getData('ui'))) return;

        // 2) si clicas sobre torre, abrir menú (no colocar)
        const towerObj = objects.find((o: any) => o?.getData && o.getData('tower'));
        if (towerObj) {
          const t = this.towers.find(T => T.sprite === towerObj);
          if (t) this.openTowerMenu(t);
          return;
        }

        // 3) colocar torre si clicas suelo libre
        const model = GROUPS[this.selFam][this.selIdx % GROUPS[this.selFam].length];
        const { tx, ty } = this.worldToTile(p.worldX, p.worldY);
        if (!this.isBuildable(tx, ty, model)) return;

        this.gold -= model.cost;
        this.goldText.setText(`🪙 ${this.gold}`);
        try { if (!this.muted) this.sound.play('place', { volume: 0.4 }); } catch {}

        const x = tx * this.map.tileSize + this.map.tileSize / 2;
        const y = ty * this.map.tileSize + this.map.tileSize / 2;
        const spr = this.add.image(x, y, 'towers', model.frame).setDepth(300).setData('tower', true);
        this.towers.push({ sprite: spr, model, last: 0, level: 1 });
        this.blockedTiles.add(this.tileKey(tx, ty)); // bloquear casilla

        spr.setInteractive({ cursor: 'pointer' });
        spr.on('pointerover', () => {
          this.rangeCircle.setVisible(true).setPosition(spr.x, spr.y).setRadius(this.getRange(spr));
          const dps = this.getDPS(spr).toFixed(1);
          this.tooltip.setVisible(true).setPosition(spr.x + 18, spr.y - 18)
            .setText(`T: ${model.frame} | lvl ${this.getLevel(spr)}\nDPS ${dps} · Range ${this.getRange(spr)} · CD ${this.getCd(spr)}ms`);
        });
        spr.on('pointerout', () => { this.rangeCircle.setVisible(false); this.tooltip.setVisible(false); });

        this.refreshHotbar();
      });

      // ghost seguir ratón
      this.input.on('pointermove', (p: any) => this.updateGhost(p.worldX, p.worldY));

      // Teclado
      this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
        if (e.key === '1') { this.selFam = 'electric'; this.selIdx = 0; this.refreshGhost(); this.refreshHotbar(); }
        if (e.key === '2') { this.selFam = 'fire';     this.selIdx = 0; this.refreshGhost(); this.refreshHotbar(); }
        if (e.key === '3') { this.selFam = 'frost';    this.selIdx = 0; this.refreshGhost(); this.refreshHotbar(); }
        if (e.key === '4') { this.selFam = 'electric'; this.selIdx = 3; this.refreshGhost(); this.refreshHotbar(); }
        if (e.key === 'ArrowLeft')  { this.selIdx = (this.selIdx + GROUPS[this.selFam].length - 1) % GROUPS[this.selFam].length; this.refreshGhost(); }
        if (e.key === 'ArrowRight') { this.selIdx = (this.selIdx + 1) % GROUPS[this.selFam].length; this.refreshGhost(); }
        if (e.code === 'Space') this.scene.isPaused() ? this.scene.resume() : this.scene.pause();
        if (e.key.toLowerCase() === 'f') this.time.timeScale = this.time.timeScale === 1 ? 2 : 1;
        if (e.code === 'Enter') this.startNextWave();
        if (e.key.toLowerCase() === 'm') this.toggleMute();
      });

      // Música de fondo (opcional)
      try { const m = this.sound.add('music', { loop: true, volume: 0.18 }); if (!this.muted) m.play(); } catch {}

      // Autoload desde localStorage
      this.tryRestore();

      this.ready = true;
      this.updateWaveUI();
      this.refreshHotbar();
    }

    /* ------------------- helpers UI ------------------- */
    buildTouchUI() {
      const pad = 8;
      const w = this.scale.width;
      const y = 16;

      const mkBtn = (label: string, x: number, on: () => void) => {
        const r = this.add.rectangle(x, y, 28, 18, 0x202a36, 0.85).setOrigin(0,0).setStrokeStyle(1, 0x7fb1ff, 0.9).setDepth(1500).setData('ui', true);
        const t = this.add.text(x+4, y+2, label, { fontFamily: 'monospace', fontSize: '11px', color: '#cfe8ff' }).setDepth(1500).setData('ui', true);
        r.setInteractive(); r.on('pointerup', on);
      };

      mkBtn('⏸/▶', w - (4*48) - pad, () => { this.scene.isPaused() ? this.scene.resume() : this.scene.pause(); });
      mkBtn('x2',  w - (3*48) - pad, () => { this.time.timeScale = this.time.timeScale === 1 ? 2 : 1; });
      mkBtn('Next',w - (2*48) - pad, () => { this.startNextWave(); });
      mkBtn(this.muted ? '🔇' : '🔊', w - (1*48) - pad, () => this.toggleMute());
    }

    buildHotbar() {
      const baseX = 12, baseY = this.scale.height - 96;
      const cellW = 60, cellH = 60, gap = 6;

      this.hotbar = this.add.container(baseX, baseY).setDepth(1500).setData('ui', true);
      const families: FamKey[] = ['electric','fire','frost'];

      families.forEach((fam, row) => {
        GROUPS[fam].forEach((model, col) => {
          const x = col * (cellW + gap), y = row * (cellH + gap);
          const bg = this.add.rectangle(x, y, cellW, cellH, 0x101820, 0.95)
            .setOrigin(0,0).setStrokeStyle(1, 0x3a5a8f, 0.9).setData('ui', true);
          const icon = this.add.image(x + cellW/2, y + cellH/2 - 6, 'towers', model.frame)
            .setScale(0.7).setData('ui', true);
          const cost = this.add.text(x + 4, y + cellH - 16, `${model.cost}`, {
            fontFamily:'monospace', fontSize:'11px', color:'#ffd76a'
          }).setData('ui', true);

          [bg, icon, cost].forEach(o => o.setInteractive({ cursor:'pointer' }));
          const select = () => {
            this.selFam = fam;
            this.selIdx = col;
            this.refreshGhost();
            this.refreshHotbar();
          };
          bg.on('pointerup', select);
          icon.on('pointerup', select);
          cost.on('pointerup', select);

          this.hotbar.add([bg, icon, cost]);
          this.hotbarIcons.push({ bg, icon, model, fam, idx: col });
        });
      });
    }

    refreshHotbar() {
      this.hotbarIcons.forEach(({ bg, icon, model, fam, idx }) => {
        const affordable = this.gold >= model.cost;
        const selected = (this.selFam === fam && this.selIdx === idx);
        icon.setAlpha(affordable ? 1 : 0.45);
        bg.setStrokeStyle(1, selected ? 0x96d0ff : 0x3a5a8f, 1);
      });
    }

    buildWaveBar() {
      const w = 300, h = 10;
      const x = this.scale.width / 2 - w/2, y = 46;

      this.waveBarBg = this.add.rectangle(x, y, w, h, 0x0e1520, 0.9).setOrigin(0,0).setDepth(1000).setData('ui', true)
        .setStrokeStyle(1, 0x416a9f, 1);
      this.waveBarFg = this.add.rectangle(x+2, y+2, 1, h-4, 0x78ff9e, 0.95).setOrigin(0,0).setDepth(1001).setData('ui', true);
      this.waveCountText = this.add.text(x + w + 8, y - 2, `0/0`, { fontFamily:'monospace', fontSize:'12px', color:'#cfe8ff' })
        .setDepth(1001).setData('ui', true);
      this.refreshWaveBar();
    }

    refreshWaveBar() {
      const total = Math.max(1, this.wavePlanned);
      const done = this.waveKilled + this.waveLeaked;
      const ratio = Math.min(1, done / total);
      const fgW = (300 - 4) * ratio;
      this.waveBarFg.width = Math.max(1, fgW);
      this.waveCountText.setText(`${done}/${this.wavePlanned}`);
    }

    buildGhost() {
      const model = GROUPS[this.selFam][this.selIdx];
      this.ghost = this.add.image(0,0,'towers', model.frame).setAlpha(0.55).setDepth(290).setVisible(false).setData('ui', true);
    }
    refreshGhost() {
      if (!this.ghost) return;
      const model = GROUPS[this.selFam][this.selIdx];
      this.ghost.setTexture('towers', model.frame);
    }
    updateGhost(wx: number, wy: number) {
      if (!this.ghost || !this.map) return;
      const { tx, ty } = this.worldToTile(wx, wy);
      const inBounds = tx >= 0 && ty >= 0 && tx < this.map.width && ty < this.map.height;
      if (!inBounds) { this.ghost.setVisible(false); return; }
      const cx = tx * this.map.tileSize + this.map.tileSize / 2;
      const cy = ty * this.map.tileSize + this.map.tileSize / 2;
      const model = GROUPS[this.selFam][this.selIdx];
      const ok = this.isBuildable(tx, ty, model);
      this.ghost.setVisible(true).setPosition(cx, cy).setTint(ok ? 0x88ff88 : 0xff6666);
    }

    toggleMute() {
      this.muted = !this.muted;
      this.sound.mute = this.muted;
    }

    updateWaveUI() {
      this.waveText?.setText(`🧠 Wave ${this.waveIndex}`);
    }

    /* ------------------- dibujo de mapa ------------------- */
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

    /** Elige frame y resistencias; si es jefe, usa sprites grandes */
    pickEnemyVisual(isBoss=false) {
      if (isBoss) {
        const bosses = [
          { key: 'enemies64', frame: 'Chaos Dragon',   resist: { fire: 0.6, frost: 1.1, electric: 0.9 } },
          { key: 'enemies64', frame: 'Void Titan',     resist: { fire: 1.0, frost: 0.6, electric: 0.9 } },
          { key: 'enemies64', frame: 'World Destroyer',resist: { fire: 0.8, frost: 0.8, electric: 0.8 } },
        ];
        for (const b of bosses) {
          const tex = this.textures.exists(b.key) ? this.textures.get(b.key) : null;
          // @ts-ignore
          if (tex && typeof tex.has === 'function' && tex.has(b.frame)) return b;
        }
      }
      const candidates = [
        { key: 'enemies48', frame: 'Demon Lord',     resist: { fire: 0.7, frost: 1.1, electric: 1.0 } },
        { key: 'enemies48', frame: 'Death Knight',   resist: { fire: 1.1, frost: 0.7, electric: 1.0 } },
        { key: 'enemies40', frame: 'Armored Knight', resist: { fire: 0.9, frost: 1.0, electric: 0.9 } },
        { key: 'enemies40', frame: 'Dark Mage',      resist: { fire: 1.0, frost: 1.0, electric: 0.7 } },
        { key: 'enemies32', frame: 'Goblin Scout',   resist: { fire: 1.0, frost: 1.0, electric: 1.0 } },
        { key: 'enemies32', frame: 'Orc Warrior',    resist: { fire: 1.0, frost: 1.0, electric: 1.0 } },
      ];
      for (const c of candidates) {
        const tex = this.textures.exists(c.key) ? this.textures.get(c.key) : null;
        // @ts-ignore
        if (tex && typeof tex.has === 'function' && tex.has(c.frame)) return c;
      }
      return { key: 'enemies32', frame: 'Goblin Scout', resist: { fire: 1, frost: 1, electric: 1 } };
    }

    /* ------------------- oleadas ------------------- */
    startNextWave() {
      if (this.gameOver || this.waveRunning) return;

      this.waveIndex++;
      this.waveRunning = true;
      this.updateWaveUI();

      const W = this.map.waves;
      const diffMul = this.getDiffMultipliers(this.diff);

      const baseCount = W.baseCount + this.waveIndex * W.countPerWave;
      const count = Math.round(baseCount * diffMul.count);
      const hp    = Math.round((W.baseHP + this.waveIndex * W.hpPerWave) * diffMul.hp);
      const speed = (W.baseSpeed + this.waveIndex * W.speedPerWave) * diffMul.speed;

      const isBossWave = (this.waveIndex % 5 === 0);
      const bossCount  = isBossWave ? 1 : 0;

      // Lane principal
      const pathIdx = (this.laneToggle++ % 2 === 0) ? 0 : 1;
      const pathTiles = this.map.paths[pathIdx];
      const pathWorld = pathTiles.map(pt => ({
        x: pt.x * this.map.tileSize + this.map.tileSize / 2,
        y: pt.y * this.map.tileSize + this.map.tileSize / 2,
      }));

      // Spawns normales
      for (let i = 0; i < count; i++) {
        this.time.delayedCall(i * W.spawnDelayMs, () => this.spawnEnemy(pathWorld, hp, speed, false));
      }

      // Oleada secundaria cada 3
      let extra = 0;
      if (this.waveIndex % 3 === 0) {
        const otherTiles = this.map.paths[pathIdx ? 0 : 1];
        const other = otherTiles.map(pt => ({
          x: pt.x * this.map.tileSize + this.map.tileSize / 2,
          y: pt.y * this.map.tileSize + this.map.tileSize / 2,
        }));
        extra = Math.floor(count * 0.7);
        for (let i = 0; i < extra; i++) {
          this.time.delayedCall(i * W.spawnDelayMs, () => this.spawnEnemy(other, Math.floor(hp * 0.9), speed, false));
        }
      }

      // Boss
      if (bossCount > 0) {
        const bossHp = Math.round(hp * 8.0);
        const bossSpeed = speed * 0.75;
        const t = count * W.spawnDelayMs + 1800;
        this.time.delayedCall(t, () => this.spawnEnemy(pathWorld, bossHp, bossSpeed, true));
      }

      // Planificación para barra de progreso
      this.wavePlanned = count + extra + bossCount;
      this.waveKilled = 0;
      this.waveLeaked = 0;
      this.refreshWaveBar();

      // Momento en el que terminaron de salir
      const totalSlots = count + extra;
      const spawnTime  = (totalSlots) * W.spawnDelayMs + (bossCount ? (count * W.spawnDelayMs + 1800) : 0);
      this.lastWaveSpawnFinishAt = this.time.now + spawnTime + 500;

      // watcher hasta fin de oleada
      const checkEnd = () => {
        if (this.gameOver) return;
        const doneSpawning = this.time.now >= this.lastWaveSpawnFinishAt;
        const noEnemies = this.enemies.getChildren().length === 0;

        if (doneSpawning && noEnemies) {
          this.waveRunning = false;
          // victoria?
          if (this.waveIndex >= this.maxWaves) { this.endGame(true); return; }
          this.autoSave();
          this.updateWaveUI();
        } else {
          this.time.delayedCall(600, checkEnd);
        }
      };
      this.time.delayedCall(800, checkEnd);
    }

    spawnEnemy(path: { x: number; y: number }[], hp: number, speed: number, isBoss: boolean) {
      const start = path[0];
      const vis = this.pickEnemyVisual(isBoss);
      const e = this.add.image(start.x, start.y, vis.key, vis.frame).setDepth(120);
      this.enemies.add(e);
      (e as any).hp = hp;
      (e as any).maxhp = hp;
      (e as any).speed = speed;
      (e as any).pathIndex = 1;
      (e as any).resist = vis.resist || { fire: 1, frost: 1, electric: 1 };
      (e as any).isBoss = isBoss;

      const bar = this.add.rectangle(e.x, e.y - (isBoss ? 24 : 18), isBoss ? 60 : 24, isBoss ? 5 : 3, 0x57ff57)
        .setOrigin(0.5, 0.5).setDepth(121);
      (e as any).hpbar = bar;

      (e as any).updateTick = () => {
        const i = (e as any).pathIndex;
        if (i >= path.length) { this.onLeak(e, bar); return; }
        const target = path[i];
        const dx = target.x - e.x, dy = target.y - e.y;
        const dist = Math.hypot(dx, dy);
        const spd = (e as any).speed * (1 / 60);
        if (dist <= spd) { e.setPosition(target.x, target.y); (e as any).pathIndex++; }
        else { e.setPosition(e.x + (dx / dist) * spd, e.y + (dy / dist) * spd); }
        const ratio = Math.max(0, (e as any).hp / (e as any).maxhp);
        bar.setPosition(e.x, bar.y = e.y - (isBoss ? 24 : 18)).setScale(ratio, 1);
      };
    }

    onLeak(e: any, bar: any) {
      bar?.destroy(); e.destroy();
      if (this.gameOver) return;
      this.waveLeaked++; this.refreshWaveBar();
      this.lives = Math.max(0, this.lives - (e.isBoss ? 3 : 1));
      this.livesText.setText(`❤️ ${this.lives}`);
      this.cameras.main.shake(120, 0.004);
      if (this.lives <= 0) this.endGame(false);
    }

    /* ------------------- pooling de proyectiles ------------------- */
    getProjectile() {
      let p = this.projPool.pop();
      if (p && p.active === false) {
        p.setActive(true).setVisible(true);
        return p;
      }
      p = this.add.image(0,0,'projectiles','Fireball').setDepth(200);
      this.projectiles.add(p);
      return p;
    }
    recycleProjectile(p: any) {
      p.setActive(false).setVisible(false);
      this.projPool.push(p);
    }

    /* ------------------- torres / disparo ------------------- */
    getLevel(spr: any) { return this.towers.find(t => t.sprite === spr)?.level ?? 1; }
    getCd(spr: any)    { const t = this.towers.find(tt => tt.sprite === spr)!; return Math.max(120, Math.round(t.model.cd * Math.pow(0.92, t.level-1))); }
    getRange(spr: any) { const t = this.towers.find(tt => tt.sprite === spr)!; return Math.round(t.model.range * (1 + 0.08*(t.level-1))); }
    getDmg(spr: any)   { const t = this.towers.find(tt => tt.sprite === spr)!; return Math.round(t.model.dmg * Math.pow(1.18, t.level-1)); }
    getDPS(spr: any)   { return this.getDmg(spr) * (1000 / this.getCd(spr)); }

    fireAt(t: { sprite: any; model: TowerModel; last: number; level: number }, target: any) {
      const p = this.getProjectile();
      p.setTexture('projectiles', t.model.projectile);
      p.setPosition(t.sprite.x, t.sprite.y);

      (p as any).vx = (target.x - p.x);
      (p as any).vy = (target.y - p.y);
      const len = Math.hypot((p as any).vx, (p as any).vy) || 1;
      const speed = 520;
      (p as any).vx = (p as any).vx / len * speed * (1 / 60);
      (p as any).vy = (p as any).vy / len * speed * (1 / 60);

      (p as any).dmg = this.getDmg(t.sprite);
      (p as any).fam = t.model.fam;
      (p as any).slow = t.model.slow;
      (p as any).dot  = t.model.dot;
      (p as any).chain= t.model.chain;
      (p as any).ttl = 900;

      try { if (!this.muted) this.sound.play('shoot', { volume: 0.25 }); } catch {}
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

      // resistencias
      const resistMul = e.resist?.[fam] ?? 1;
      const finalDmg = Math.max(1, Math.round(baseDmg * resistMul));
      e.hp -= finalDmg;

      // efectos secundarios
      if (fam === 'frost' && proj.slow) {
        const slowFactor: number = proj.slow.factor;
        const slowMs: number = proj.slow.ms;
        const old = e.speed;
        e.speed = old * slowFactor;
        this.time.delayedCall(slowMs, () => e && (e.speed = old));
      }
      if (fam === 'fire' && proj.dot) {
        const dotDps: number = proj.dot.dps * resistMul;
        const dotMs: number = proj.dot.ms;
        const ticks = Math.floor(dotMs / 300);
        for (let i = 1; i <= ticks; i++) {
          this.time.delayedCall(i * 300, () => e && (e.hp -= Math.max(1, Math.round(dotDps * 0.3))));
        }
      }
      if (fam === 'electric' && proj.chain) {
        const hops = proj.chain.hops as number;
        const falloff = proj.chain.falloff as number;
        this.chainLightning(enemy, finalDmg, hops, falloff);
      }

      if (e.hp <= 0) {
        const puff = this.add.image(e.x, e.y, 'fx', 'Poison Cloud').setDepth(210);
        this.time.delayedCall(220, () => puff.destroy());

        e.hpbar?.destroy();
        e.destroy();
        // recompensas
        const reward = (6 + Math.floor(this.waveIndex * 0.6)) * (e.isBoss ? 10 : 1) * this.getDiffMultipliers(this.diff).goldGain;
        this.gold += Math.round(reward);
        this.goldText.setText(`🪙 ${this.gold}`);
        try { if (!this.muted) this.sound.play('coin', { volume: 0.25 }); } catch {}
        this.refreshHotbar();

        this.waveKilled++; this.refreshWaveBar();
      }

      this.recycleProjectile(proj);
    }

    /* ---------------------- upgrade / sell ---------------------- */
    openTowerMenu(t: { sprite: any; model: TowerModel; last: number; level: number }) {
      // eliminar menús anteriores
      this.children.list
        .filter((o: any) => o?.getData && o.getData('menu'))
        .forEach((o: any) => o.destroy());

      const x = t.sprite.x, y = t.sprite.y - 46;
      const box = this.add.container(x, y).setDepth(1600).setData('menu', true);
      const bg = this.add.rectangle(0,0,140,64,0x102030,0.95).setStrokeStyle(1,0x7fb1ff).setOrigin(0.5).setData('menu', true);
      const lvl = t.level;
      const upCost = Math.round(t.model.cost * (0.8 + 0.8*lvl));
      const sell = Math.round(t.model.cost * (0.6 + 0.2*(lvl-1)));

      const txt = this.add.text(0,-20, `Lvl ${lvl}\nUpgrade: ${upCost} 🪙\nSell: ${sell} 🪙`, {
        fontFamily:'monospace', fontSize:'12px', color:'#cfe8ff', align:'center'
      }).setOrigin(0.5).setData('menu', true);

      const btnUp = this.add.rectangle(-35,16,70,22,0x1e3b1f,0.95).setStrokeStyle(1,0x8fff9d).setData('menu', true);
      const txUp  = this.add.text(-35,16,'Upgrade',{fontFamily:'monospace',fontSize:'11px',color:'#aef5bb'}).setOrigin(0.5).setData('menu', true);
      const btnSel= this.add.rectangle(35,16,70,22,0x3b1e1e,0.95).setStrokeStyle(1,0xff9c9c).setData('menu', true);
      const txSel = this.add.text(35,16,'Vender',{fontFamily:'monospace',fontSize:'11px',color:'#ffd6d6'}).setOrigin(0.5).setData('menu', true);

      [btnUp, btnSel, bg, txt, txUp, txSel].forEach(b => (b as any).setInteractive?.({ cursor:'pointer' }));

      btnUp.on('pointerup', () => {
        if (this.gold >= upCost) {
          this.gold -= upCost; this.goldText.setText(`🪙 ${this.gold}`);
          t.level++;
          this.cameras.main.flash(80, 40, 140, 70);
          this.refreshHotbar();
        }
        box.destroy();
      });
      btnSel.on('pointerup', () => {
        this.gold += sell; this.goldText.setText(`🪙 ${this.gold}`);
        const tx = Math.floor(t.sprite.x/this.map.tileSize), ty = Math.floor(t.sprite.y/this.map.tileSize);
        this.blockedTiles.delete(this.tileKey(tx, ty));
        t.sprite.destroy();
        this.towers = this.towers.filter(T => T !== t);
        this.refreshHotbar();
        box.destroy();
      });

      box.add([bg, txt, btnUp, txUp, btnSel, txSel]);
    }

    /* ------------------- update loop ------------------- */
    update(time: number, dt: number) {
      if (!this.ready || !this.enemies || !this.projectiles) return;

      this.enemies.getChildren().forEach((e: any) => e?.updateTick?.());

      for (const t of this.towers) {
        if (time < t.last + this.getCd(t.sprite)) continue;

        let best: any = null;
        let bestD = 1e9;
        const range = this.getRange(t.sprite);
        this.enemies.getChildren().forEach((c: any) => {
          if (!c || !c.active) return;
          const d = PhaserLib.Math.Distance.Between(t.sprite.x, t.sprite.y, c.x, c.y);
          if (d < range && d < bestD) { best = c; bestD = d; }
        });
        if (best) {
          t.last = time;
          this.fireAt(t, best);
        }
      }

      this.projectiles.getChildren().forEach((p: any) => {
        if (!p.active) return;
        p.x += p.vx; p.y += p.vy; p.ttl -= dt;
        if (p.ttl <= 0) { this.recycleProjectile(p); return; }
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

    /* ------------------- victoria/derrota ------------------- */
    endGame(won: boolean) {
      this.gameOver = true;
      this.scene.pause();

      const w = this.scale.width, h = this.scale.height;
      const overlay = this.add.container(w/2, h/2).setDepth(2000);
      overlay.setData('ui', true);

      const bg = this.add.rectangle(0, 0, 420, 220, 0x0b101a, 0.95)
        .setStrokeStyle(2, won ? 0x78ff9e : 0xff8b8b, 1);
      const title = this.add.text(0, -60, won ? '¡Victoria!' : 'Derrota', {
        fontFamily: 'monospace', fontSize: '24px', color: won ? '#9effbe' : '#ffd6d6'
      }).setOrigin(0.5);

      const btnRetry = this.add.rectangle(-80, 40, 140, 36, 0x142338, 0.95).setStrokeStyle(1, 0x7fb1ff, 0.9);
      const txtRetry = this.add.text(-80, 40, 'Reintentar', { fontFamily: 'monospace', fontSize: '14px', color: '#cfe8ff' }).setOrigin(0.5);
      btnRetry.setInteractive().setData('ui', true);

      const btnExit = this.add.rectangle(80, 40, 140, 36, 0x2d1a1a, 0.95).setStrokeStyle(1, 0xff9c9c, 0.9);
      const txtExit = this.add.text(80, 40, 'Volver', { fontFamily: 'monospace', fontSize: '14px', color: '#ffd6d6' }).setOrigin(0.5);
      btnExit.setInteractive().setData('ui', true);

      overlay.add([bg, title, btnRetry, txtRetry, btnExit, txtExit]);

      btnRetry.on('pointerup', () => window.location.reload());
      btnExit.on('pointerup', () => window.location.href = '/');

      // limpiar autosave
      try { localStorage.removeItem('td_save_v2'); } catch {}
    }

    /* ------------------- dificultad ------------------- */
    getDiffMultipliers(diff: Difficulty) {
      if (diff === 'easy')   return { hp: 0.85, speed: 0.95, count: 0.9, gold: 1.2, goldGain: 1.2, lives: 1.3 };
      if (diff === 'hard')   return { hp: 1.25, speed: 1.05, count: 1.15, gold: 0.9, goldGain: 0.9, lives: 0.8 };
      return /* normal */      { hp: 1.00, speed: 1.00, count: 1.00, gold: 1.0, goldGain: 1.0, lives: 1.0 };
    }

    /* ------------------- autosave ------------------- */
    autoSave() {
      try {
        const towers = this.towers.map(t => ({
          x: t.sprite.x, y: t.sprite.y,
          fam: t.model.fam, frame: t.model.frame, level: t.level
        }));
        const payload = {
          map: this.map.name, diff: this.diff,
          gold: this.gold, lives: this.lives,
          waveIndex: this.waveIndex, towers
        };
        localStorage.setItem('td_save_v2', JSON.stringify(payload));
      } catch {}
    }

    tryRestore() {
      try {
        const s = localStorage.getItem('td_save_v2');
        if (!s) return;
        const save = JSON.parse(s);
        const url = new URL(window.location.href);
        const reqMap = (url.searchParams.get('map') || 'grass_dual');
        const reqDiff = (url.searchParams.get('diff') || 'normal');
        if (save.map !== this.map.name || save.diff !== reqDiff || reqMap !== this.map.name) return;

        if (window.confirm('¿Continuar partida guardada?')) {
          this.gold = save.gold; this.goldText.setText(`🪙 ${this.gold}`);
          this.lives = save.lives; this.livesText.setText(`❤️ ${this.lives}`);
          this.waveIndex = save.waveIndex; this.updateWaveUI();

          // recrear torres
          for (const t of save.towers) {
            const model = GROUPS[t.fam as FamKey].find(m => m.frame === t.frame) || GROUPS[t.fam as FamKey][0];
            const spr = this.add.image(t.x, t.y, 'towers', model.frame).setDepth(300).setData('tower', true).setInteractive({cursor:'pointer'});
            this.towers.push({ sprite: spr, model, last: 0, level: t.level || 1 });

            const tx = Math.floor(t.x/this.map.tileSize), ty = Math.floor(t.y/this.map.tileSize);
            this.blockedTiles.add(this.tileKey(tx, ty));

            spr.on('pointerover', () => {
              this.rangeCircle.setVisible(true).setPosition(spr.x, spr.y).setRadius(this.getRange(spr));
              const dps = this.getDPS(spr).toFixed(1);
              this.tooltip.setVisible(true).setPosition(spr.x + 18, spr.y - 18)
                .setText(`T: ${model.frame} | lvl ${this.getLevel(spr)}\nDPS ${dps} · Range ${this.getRange(spr)} · CD ${this.getCd(spr)}ms`);
            });
            spr.on('pointerout', () => { this.rangeCircle.setVisible(false); this.tooltip.setVisible(false); });
          }
        }
      } catch {}
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
        Fluent Tower Defense — MVP++
      </h3>
      <div style={{ color: '#a9b7ff', fontFamily: 'monospace', fontSize: 12, marginBottom: 6 }}>
        Click coloca · <b>1</b>=⚡ / <b>2</b>=🔥 / <b>3</b>=❄ · <b>4</b>=atajo ⚡ 4ª · <b>←/→</b> cambia skin ·
        <b> Espacio</b> pausa · <b>F</b> x2 · <b>ENTER</b> inicia ·
        Click torre para <b>Upgrade/Vender</b> · Query: <code>?map=grass_dual&diff=easy|normal|hard</code>
      </div>
      <div ref={rootRef} style={{ width: '100%', height: 'calc(100vh - 120px)' }} />
      {!mounted && <div style={{ color: '#99a', fontFamily: 'monospace', marginTop: 8 }}>Cargando…</div>}
    </div>
  );
}
