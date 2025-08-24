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
  preview?: string;
  previewAlpha?: number;
  pathSkins?: string[];
  pathFrames?: Record<string, string>;
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
  tint?: number; // <-- nuevo (para “torre verde”)
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

// 🌿 NATURE / VENENO (usa frames conocidos tintados en verde para evitar __MISSING__)
const NATURE: TowerModel[] = [
  { frame: 'Thorn Vine I',       fam: 'nature', cost: 45,  dmg: 12, range: 170, cd: 620, projectile: 'Poison Dart', dot: { dps: 8,  ms: 1800 } },
  { frame: 'Entangle Root III',  fam: 'nature', cost: 85,  dmg: 18, range: 190, cd: 560, projectile: 'Poison Dart', dot: { dps: 14, ms: 2200 } },
  { frame: 'World Tree V',       fam: 'nature', cost: 140, dmg: 26, range: 210, cd: 520, projectile: 'Poison Dart', dot: { dps: 22, ms: 2600 } },
];

const GROUPS: Record<FamKey, TowerModel[]> = {
  electric: ELECTRIC, fire: FIRE, frost: FROST, nature: NATURE
};

type PlacedTower = {
  sprite: any;
  base: TowerModel;
  stats: { dmg:number; range:number; cd:number };
  level: number;
  last: number;
  spent: number;
  tx: number; ty: number;
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
    towers: PlacedTower[] = [];

    goldText!: any;
    infoText!: any;
    tooltip!: any;
    rangeCircle!: any;

    selFam: FamKey = 'electric';
    selIdx = 0;
    blockedTiles = new Set<string>();
    towerTiles = new Set<string>();
    ready = false;

    // HUD
    hudHeight = 84;
    hudContainer!: any;
    selHighlight!: any;

    // Menú torre
    menuContainer?: any;
    menuFor?: PlacedTower | null;
    menuOpen = false;

    worldToTile(x: number, y: number) { return { tx: Math.floor(x / this.map.tileSize), ty: Math.floor(y / this.map.tileSize) }; }
    tileKey(tx: number, ty: number) { return `${tx},${ty}`; }

    preload() {
      this.load.atlas('terrain64',  '/assets/terrain_atlas.png',     '/assets/terrain_atlas.json');
      this.load.atlas('ui32',       '/assets/ui_atlas.png',          '/assets/ui_atlas.json');
      this.load.atlas('towers',     '/assets/towers_atlas.png',      '/assets/towers_atlas.json');
      this.load.atlas('enemies32',  '/assets/enemies32_atlas.png',   '/assets/enemies32_atlas.json');
      this.load.atlas('enemies40',  '/assets/enemies40_atlas.png',   '/assets/enemies40_atlas.json');
      this.load.atlas('enemies48',  '/assets/enemies48_atlas.png',   '/assets/enemies48_atlas.json');
      this.load.atlas('projectiles','/assets/projectiles_atlas.png', '/assets/projectiles_atlas.json');
      this.load.atlas('fx',         '/assets/effects_atlas.png',     '/assets/effects_atlas.json');

      try { this.load.audio('coin',  ['/audio/coin.mp3',  '/audio/coin.wav']); } catch {}
      try { this.load.audio('hit',   ['/audio/hit.mp3',   '/audio/hit.wav']); } catch {}
      try { this.load.audio('place', ['/audio/place.mp3', '/audio/place.wav']); } catch {}
      try { this.load.audio('shoot', ['/audio/shoot.mp3','/audio/shoot.wav','/audio/shot.wav']); } catch {}
      try { this.load.audio('music', ['/audio/music.mp3','/audio/music.wav']); } catch {}
    }

    async create() {
      this.enemies = this.add.group();
      this.projectiles = this.add.group();

      // MUY IMPORTANTE para que sólo el objeto top reciba input
      this.input.topOnly = true;

      const url = new URL(window.location.href);
      const mapName = (url.searchParams.get('map') || 'grass_dual').replace(/[^a-z0-9_\-]/gi, '');
      this.map = await loadMapDef(mapName);

      if (this.map.preview) {
        const key = 'mapBg';
        this.load.image(key, this.map.preview);
        this.load.once('complete', () => {
          const img = this.add.image(0, 0, key).setOrigin(0, 0).setDepth(5);
          img.setDisplaySize(this.map.width * this.map.tileSize, this.map.height * this.map.tileSize);
          img.setAlpha(Math.min(1, Math.max(0, this.map.previewAlpha ?? 0.28)));
        });
        this.load.start();
      }

      this.cameras.main.setBackgroundColor('#0c0e12');

      // UI textos
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

      // Mapa
      this.drawMapFromJSON(this.map);

      // HUD selector visual
      this.buildHUD();

      // Colocar torres (NO se ejecuta si el puntero está sobre un objeto interactivo)
      this.input.on('pointerdown', (p: any) => {
        // si hay un objeto interactivo debajo, no colocamos
        const hits = (this.input.manager as any).hitTest(p, this.children.list, this.cameras.main);
        if (hits && hits.length) return;

        const model = GROUPS[this.selFam][this.selIdx];
        const { tx, ty } = this.worldToTile(p.worldX, p.worldY);
        if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) return;
        const k = this.tileKey(tx, ty);
        if (this.blockedTiles.has(k) || this.towerTiles.has(k)) return;
        if (this.gold < model.cost) return;

        this.gold -= model.cost;
        this.goldText.setText(`🪙 ${this.gold}`);
        try { this.sound.play('place', { volume: 0.4 }); } catch {}

        const x = tx * this.map.tileSize + this.map.tileSize / 2;
        const y = ty * this.map.tileSize + this.map.tileSize / 2;
        const spr = this.add.image(x, y, 'towers', model.frame).setDepth(300);
        if (model.tint) spr.setTint(model.tint);

        const tw: PlacedTower = {
          sprite: spr,
          base: model,
          stats: { dmg: model.dmg, range: model.range, cd: model.cd },
          level: 0, last: 0, spent: model.cost,
          tx, ty
        };
        this.towers.push(tw);
        this.towerTiles.add(k);

        spr.setInteractive({ cursor: 'pointer' });
        spr.on('pointerover', () => this.showTowerInfo(tw));
        spr.on('pointerout',  () => this.hideTowerInfo());
        // abrir menú en pointerUP para no competir con el click de colocar
        spr.on('pointerup',   () => this.openMenu(tw));
      });

      // Teclado
      this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
        if (e.key === '1') { this.selFam = 'electric'; this.selIdx = 0; this.refreshHUD(); }
        if (e.key === '2') { this.selFam = 'fire';     this.selIdx = 0; this.refreshHUD(); }
        if (e.key === '3') { this.selFam = 'frost';    this.selIdx = 0; this.refreshHUD(); }
        if (e.key === '4') { this.selFam = 'nature';   this.selIdx = 0; this.refreshHUD(); }
        if (e.key === 'ArrowLeft')  { this.selIdx = (this.selIdx + GROUPS[this.selFam].length - 1) % GROUPS[this.selFam].length; this.refreshHUD(); }
        if (e.key === 'ArrowRight') { this.selIdx = (this.selIdx + 1) % GROUPS[this.selFam].length; this.refreshHUD(); }
        if (e.code === 'Space') this.scene.isPaused() ? this.scene.resume() : this.scene.pause();
        if (e.key.toLowerCase() === 'f') this.time.timeScale = this.time.timeScale === 1 ? 2 : 1;
      });

      // Waves
      this.setupWavesFromJSON(this.map);

      this.ready = true;
    }

    /* ----------------- HUD ----------------- */
    buildHUD() {
      const w = this.scale.width;
      this.hudContainer = this.add.container(0,0).setDepth(900);
      const bg = this.add.rectangle(0,0, w, this.hudHeight, 0x0b1220, 0.92).setOrigin(0,0);
      bg.setStrokeStyle(1, 0x162033, 1);
      this.hudContainer.add(bg);

      const fams: { k: FamKey; label: string }[] = [
        { k:'electric', label:'⚡' }, { k:'fire', label:'🔥' }, { k:'frost', label:'❄' }, { k:'nature', label:'🌿' }
      ];
      fams.forEach((f, i) => {
        const t = this.add.text(12 + i*26, 10, f.label, { fontFamily:'monospace', fontSize:'18px', color: this.selFam===f.k ? '#fff' : '#9ab' })
          .setInteractive({useHandCursor:true})
          .on('pointerdown', ()=> { this.selFam = f.k; this.selIdx = 0; this.refreshHUD(); });
        this.hudContainer.add(t);
      });

      // iconos de torres del grupo activo
      const iconsX0 = 12; const iconsY = 42;
      for (let i=0; i<6; i++) {
        const img = this.add.image(iconsX0 + i*64, iconsY, 'towers', GROUPS[this.selFam][0].frame)
          .setOrigin(0,0.5).setScale(0.8).setInteractive({useHandCursor:true});
        img.on('pointerdown', ()=> { if (i<GROUPS[this.selFam].length){ this.selIdx = i; this.refreshHUD(); }});
        (img as any).__slot = i;
        this.hudContainer.add(img);
      }

      this.selHighlight = this.add.rectangle(iconsX0 - 4, iconsY, 56, 56, 0xFFFFFF, 0.06)
        .setStrokeStyle(1, 0x4cc2ff, 1).setOrigin(0,0.5);
      this.hudContainer.add(this.selHighlight);

      this.refreshHUD();
    }

    refreshHUD() {
      const imgs = this.hudContainer.list.filter((o:any)=>o.texture && o.texture.key==='towers');
      imgs.forEach((img:any)=> {
        const slot = img.__slot as number;
        const arr = GROUPS[this.selFam];
        if (slot < arr.length) {
          const m = arr[slot];
          img.setFrame(m.frame).setVisible(true);
          if (m.tint) img.setTint(m.tint); else img.clearTint();
        } else {
          img.setVisible(false);
        }
      });
      const current = imgs.find((img:any)=> (img.__slot as number)===this.selIdx && img.visible);
      if (current) this.selHighlight.setPosition(current.x - 4, current.y).setVisible(true);
      else this.selHighlight.setVisible(false);

      // recolor labels
      this.hudContainer.list.forEach((o:any)=>{
        if (o.type==='Text') {
          if (o.text==='⚡') o.setColor(this.selFam==='electric' ? '#fff' : '#9ab');
          if (o.text==='🔥') o.setColor(this.selFam==='fire'     ? '#fff' : '#9ab');
          if (o.text==='❄') o.setColor(this.selFam==='frost'    ? '#fff' : '#9ab');
          if (o.text==='🌿') o.setColor(this.selFam==='nature'   ? '#fff' : '#9ab');
        }
      });
    }

    /* ------------- Tooltip torre ------------- */
    showTowerInfo(t: PlacedTower) {
      this.rangeCircle.setVisible(true).setPosition(t.sprite.x, t.sprite.y).setRadius(t.stats.range);
      const dps = (t.stats.dmg * 1000 / t.stats.cd).toFixed(1);
      this.tooltip.setVisible(true).setPosition(t.sprite.x + 18, t.sprite.y - 18)
        .setText(`T: ${t.base.frame}  |  lvl ${t.level}\nDPS ${dps} · Range ${t.stats.range} · CD ${t.stats.cd}ms`);
    }
    hideTowerInfo() {
      this.rangeCircle.setVisible(false);
      this.tooltip.setVisible(false);
    }

    /* ------------- Menú Upgrade/Vender ------------- */
    openMenu(t: PlacedTower) {
      this.closeMenu(); // por si hubiera otro
      this.menuOpen = true;
      this.menuFor = t;

      const cont = this.add.container(t.sprite.x + 8, t.sprite.y - 8).setDepth(1100);
      const bg = this.add.rectangle(0,0, 200, 90, 0x0f1728, 0.95).setOrigin(0,1).setStrokeStyle(1,0x4cc2ff,0.8);
      cont.add(bg);

      const dps = (t.stats.dmg * 1000 / t.stats.cd).toFixed(1);
      const title = this.add.text(6,-78, `${t.base.frame}  (lvl ${t.level})`, {fontFamily:'monospace', fontSize:'12px', color:'#e8f4ff'});
      const stats = this.add.text(6,-60, `DPS ${dps}  Rng ${t.stats.range}  CD ${t.stats.cd}`, {fontFamily:'monospace', fontSize:'11px', color:'#b7c7ff'});
      cont.add(title); cont.add(stats);

      const upCost = this.upgradeCost(t);
      const sellVal = Math.round(t.spent*0.6);

      this.makeBtn(cont, 6,-36, `Upgrade (+25% dmg, +rng, -cd)  🪙 ${upCost}`, () => {
        if (this.gold < upCost) return;
        this.gold -= upCost; this.goldText.setText(`🪙 ${this.gold}`);
        t.level++; t.spent += upCost;
        t.stats.dmg = Math.round(t.stats.dmg * 1.25);
        t.stats.range += 12;
        t.stats.cd = Math.max(220, Math.round(t.stats.cd * 0.9));
        this.openMenu(t); // refrescar
      });

      this.makeBtn(cont, 6,-14, `Vender  (+🪙 ${sellVal})`, () => {
        this.gold += sellVal; this.goldText.setText(`🪙 ${this.gold}`);
        const k = this.tileKey(t.tx, t.ty);
        this.towerTiles.delete(k);
        t.sprite.destroy();
        this.towers = this.towers.filter(x => x !== t);
        this.closeMenu();
      });

      this.menuContainer = cont;

      // Cerrar al click fuera (en el *siguiente* tick, para no cerrarlo al abrir)
      this.time.delayedCall(0, () => {
        this.input.once('pointerdown', (p:any) => {
          if (!this.menuContainer) return;
          const r = new Phaser.Geom.Rectangle(this.menuContainer.x-2, this.menuContainer.y-90, 204, 94);
          if (!Phaser.Geom.Rectangle.Contains(r, p.worldX, p.worldY)) this.closeMenu();
        });
      });
    }

    closeMenu() {
      this.menuOpen = false;
      this.menuFor = null;
      this.menuContainer?.destroy();
      this.menuContainer = undefined;
    }

    makeBtn(parent:any, x:number, y:number, label:string, onClick:()=>void) {
      const btn = this.add.container(x,y);
      const r = this.add.rectangle(0,0, 188, 18, 0x173055, 0.9).setOrigin(0,0.5).setStrokeStyle(1,0x4cc2ff,0.6);
      const t = this.add.text(6,0,label,{fontFamily:'monospace', fontSize:'11px', color:'#d8e7ff'}).setOrigin(0,0.5);
      btn.add([r,t]);
      btn.setSize(188,18).setInteractive({useHandCursor:true});
      btn.on('pointerdown', onClick);
      parent.add(btn);
      return btn;
    }

    upgradeCost(t: PlacedTower) {
      return Math.round(t.base.cost * Math.pow(1.5, t.level + 1));
    }

    /* ------------- Pintar mapa ------------- */
    drawMapFromJSON(map: MapDef) {
      const mark = (x: number, y: number) => this.blockedTiles.add(this.tileKey(x, y));
      for (let li=0; li<map.paths.length; li++) {
        const lane = map.paths[li];
        for (const p of lane) {
          if (p.x >= 0 && p.x < map.width && p.y >= 0 && p.y < map.height) {
            const cx = p.x * map.tileSize + map.tileSize / 2;
            const cy = p.y * map.tileSize + map.tileSize / 2;
            const key = `${p.x},${p.y}`;
            const frame =
              (map.pathFrames && map.pathFrames[key]) ||
              (map.pathSkins && map.pathSkins[li]) ||
              map.terrain;
            this.add.image(cx, cy, 'terrain64', frame).setDepth(50);
            mark(p.x, p.y);
          }
        }
      }
      for (const r of map.buildMask) {
        for (let x = r.x; x < r.x + r.w; x++)
          for (let y = r.y; y < r.y + r.h; y++) mark(x, y);
      }
    }

    /* ------------- Enemigos/Waves ------------- */
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

    setupWavesFromJSON(map: MapDef) {
      this.waveIndex = 0;
      const next = () => {
        this.waveIndex++;
        const W = map.waves;
        const count = W.baseCount + this.waveIndex * W.countPerWave;
        const hp    = W.baseHP    + this.waveIndex * W.hpPerWave;
        const speed = W.baseSpeed + this.waveIndex * W.speedPerWave;

        const pathIdx = (this.laneToggle++ % Math.max(1, map.paths.length)) || 0;
        const pathTiles = map.paths[pathIdx];
        const pathWorld = pathTiles.map(pt => ({
          x: pt.x * map.tileSize + map.tileSize / 2,
          y: pt.y * map.tileSize + map.tileSize / 2,
        }));

        for (let i = 0; i < count; i++) {
          this.time.delayedCall(i * W.spawnDelayMs, () => this.spawnEnemy(pathWorld, hp, speed));
        }

        if (this.waveIndex % 3 === 0 && map.paths.length > 1) {
          const otherPath = map.paths[pathIdx ? 0 : 1].map(pt => ({
            x: pt.x * map.tileSize + map.tileSize / 2,
            y: pt.y * map.tileSize + map.tileSize / 2,
          }));
          for (let i = 0; i < Math.floor(count * 0.7); i++) {
            this.time.delayedCall(i * W.spawnDelayMs, () => this.spawnEnemy(otherPath, Math.floor(hp * 0.9), speed));
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

    /* ------------- Disparo / daño ------------- */
    fireAt(t: PlacedTower, target: any) {
      const m = t.base;
      const p = this.add.image(t.sprite.x, t.sprite.y, 'projectiles', m.projectile).setDepth(200);
      this.projectiles.add(p);
      (p as any).vx = (target.x - p.x);
      (p as any).vy = (target.y - p.y);
      const len = Math.hypot((p as any).vx, (p as any).vy) || 1;
      const speed = 520;
      (p as any).vx = (p as any).vx / len * speed * (1 / 60);
      (p as any).vy = (p as any).vy / len * speed * (1 / 60);
      (p as any).dmg = t.stats.dmg;
      (p as any).fam = m.fam;
      (p as any).slow = m.slow;
      (p as any).dot  = m.dot;
      (p as any).chain= m.chain;
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

    /* ------------- Loop ------------- */
    update(time: number, dt: number) {
      if (!this.ready || !this.enemies || !this.projectiles) return;

      this.enemies.getChildren().forEach((e: any) => e?.updateTick?.());

      for (const t of this.towers) {
        if (time < t.last + t.stats.cd) continue;
        let best: any = null;
        let bestD = 1e9;
        this.enemies.getChildren().forEach((c: any) => {
          if (!c || !c.active) return;
          const d = PhaserLib.Math.Distance.Between(t.sprite.x, t.sprite.y, c.x, c.y);
          if (d < t.stats.range && d < bestD) { best = c; bestD = d; }
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

      // Seguir torre con el menú
      if (this.menuOpen && this.menuContainer && this.menuFor) {
        this.menuContainer.setPosition(this.menuFor.sprite.x + 8, this.menuFor.sprite.y - 8);
      }
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
        Click coloca · <b>1</b>=⚡ / <b>2</b>=🔥 / <b>3</b>=❄ / <b>4</b>=🌿 · <b>←/→</b> cambia skin ·
        <b> Espacio</b> pausa · <b>F</b> x2 · Click torre para <b>Upgrade/Vender</b>
      </div>
      <div ref={rootRef} style={{ width: '100%', height: 'calc(100vh - 120px)' }} />
      {!mounted && <div style={{ color: '#99a', fontFamily: 'monospace', marginTop: 8 }}>Cargando…</div>}
    </div>
  );
}
