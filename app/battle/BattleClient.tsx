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
  chain?: { hops: number; falloff: number }; // electric
  slow?: { factor: number; ms: number };     // frost
  dot?: { dps: number; ms: number };         // fire/nature
  root?: { ms: number };                     // nature (inmoviliza)
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
// 🌿 Bosque / Nature
const NATURE: TowerModel[] = [
  { frame: 'Thorn Vine I',      fam: 'nature', cost: 45,  dmg: 10, range: 160, cd: 620, projectile: 'Poison Dart', dot: { dps: 5, ms: 1200 }, root: { ms: 150 } },
  { frame: 'Entangle Root III', fam: 'nature', cost: 85,  dmg: 18, range: 180, cd: 560, projectile: 'Poison Dart', dot: { dps: 8, ms: 1500 }, root: { ms: 220 } },
  { frame: 'World Tree V',      fam: 'nature', cost: 140, dmg: 26, range: 200, cd: 520, projectile: 'Poison Dart', dot: { dps: 12, ms: 1800 }, root: { ms: 300 } },
];

const GROUPS: Record<FamKey, TowerModel[]> = {
  electric: ELECTRIC, fire: FIRE, frost: FROST, nature: NATURE
};

/* --------------------- helpers de upgrade / venta --------------------- */
function scaleModel(base: TowerModel, level: number): TowerModel {
  if (level <= 0) return { ...base };
  const dmg = Math.round(base.dmg * Math.pow(1.2, level));               // +20%/lvl
  const range = Math.round(base.range + 10 * level);                      // +10 px/lvl
  const cd = Math.max(220, Math.round(base.cd * Math.pow(0.92, level)));  // -8%/lvl aprox
  return { ...base, dmg, range, cd };
}
function nextUpgradeCost(baseCost: number, level: number) {
  return Math.round(baseCost * (1 + 0.6 * (level + 1))); // escala suave
}

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
    towers: { sprite: any; base: TowerModel; model: TowerModel; level: number; last: number; spent: number }[] = [];

    goldText!: any;
    infoText!: any;
    tooltip!: any;
    rangeCircle!: any;
    uiMenu?: any; // contenedor (upgrade/sell)

    selFam: FamKey = 'electric';
    selIdx = 0;
    blockedTiles = new Set<string>();
    ready = false;

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

      // Audio opcional
      try { this.load.audio('coin',  ['/audio/coin.mp3',  '/audio/coin.wav']); } catch {}
      try { this.load.audio('hit',   ['/audio/hit.mp3',   '/audio/hit.wav']); } catch {}
      try { this.load.audio('place', ['/audio/place.mp3', '/audio/place.wav']); } catch {}
      try { this.load.audio('shoot', ['/audio/shoot.mp3','/audio/shoot.wav','/audio/shot.wav']); } catch {}
      try { this.load.audio('music', ['/audio/music.mp3','/audio/music.wav']); } catch {}
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

      // UI superior
      this.goldText = this.add.text(16, 16, `🪙 ${this.gold}`, {
        color: '#ffd76a', fontFamily: 'monospace', fontSize: '18px'
      }).setDepth(1000);

      this.infoText = this.add.text(
        16, 34,
        `Click coloca · 1=⚡ / 2=🔥 / 3=❄ / 4=🌿 · ←/→ cambia skin · Espacio pausa · F x2 · ENTER inicia oleada · Click torre para Upgrade/Vender`,
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

      // Click general: seleccionar torre o colocar una nueva
      this.input.on('pointerdown', (p: any) => {
        // 1) ¿hay torre cerca del click? => abrir menú y salir
        const tNear = this.getTowerAt(p.worldX, p.worldY);
        if (tNear) { this.openTowerMenu(tNear); return; }

        // 2) colocar torre nueva
        const modelBase = GROUPS[this.selFam][this.selIdx];
        const { tx, ty } = this.worldToTile(p.worldX, p.worldY);
        if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) return;
        if (this.blockedTiles.has(this.tileKey(tx, ty))) return;
        if (this.gold < modelBase.cost) return;

        this.gold -= modelBase.cost;
        this.goldText.setText(`🪙 ${this.gold}`);
        try { this.sound.play('place', { volume: 0.35 }); } catch {}

        const x = tx * this.map.tileSize + this.map.tileSize / 2;
        const y = ty * this.map.tileSize + this.map.tileSize / 2;
        const spr = this.add.image(x, y, 'towers', modelBase.frame).setDepth(300).setInteractive({ cursor: 'pointer' });
        const modelScaled = scaleModel(modelBase, 0);

        const t = { sprite: spr, base: modelBase, model: modelScaled, level: 0, last: 0, spent: modelBase.cost };
        this.towers.push(t);

        // Hover info
        spr.on('pointerover', () => this.showTowerInfo(t));
        spr.on('pointerout',  () => this.hideTowerInfo());
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
        if (e.key === 'Enter') this.startWaves();
        if (e.key.toLowerCase() === 'c') this.closeMenu();
      });

      // Arranca waves auto (o espera Enter si prefieres)
      this.startWaves();

      this.ready = true;
    }

    closeMenu() {
      this.uiMenu?.destroy();
      this.uiMenu = undefined;
    }

    showTowerInfo(t: {sprite:any; model:TowerModel; level:number}) {
      this.rangeCircle.setVisible(true).setPosition(t.sprite.x, t.sprite.y).setRadius(t.model.range);
      const dps = (t.model.dmg * 1000 / t.model.cd).toFixed(1);
      this.tooltip.setVisible(true).setPosition(t.sprite.x + 18, t.sprite.y - 18)
        .setText(`T: ${t.base.frame} | lvl ${t.level}\nDPS ${dps} · Range ${t.model.range} · CD ${t.model.cd}ms`);
    }
    hideTowerInfo() {
      this.rangeCircle.setVisible(false);
      this.tooltip.setVisible(false);
    }

    getTowerAt(x: number, y: number) {
      const r = this.map.tileSize * 0.45;
      for (const t of this.towers) {
        const d = PhaserLib.Math.Distance.Between(x, y, t.sprite.x, t.sprite.y);
        if (d <= r) return t;
      }
      return null;
    }

    openTowerMenu(t: { sprite:any; base: TowerModel; model: TowerModel; level: number; spent:number }) {
      this.closeMenu();

      const pad = 6;
      const w = 180, h = 68;
      const cx = t.sprite.x, cy = t.sprite.y - 52;

      const container = this.add.container(cx, cy).setDepth(1200);
      const bg = this.add.rectangle(0, 0, w, h, 0x0b1220, 0.9).setStrokeStyle(1, 0x5ab0ff, 0.9).setOrigin(0.5);
      container.add(bg);

      const nextCost = nextUpgradeCost(t.base.cost, t.level);
      const sell = Math.max(1, Math.floor(t.spent * 0.7));

      const txt1 = this.add.text(-w/2 + pad, -h/2 + pad,
        `↑ Mejora: ${nextCost}\n⤷ Vender: +${sell}`, { fontFamily: 'monospace', fontSize: '12px', color: '#d7ebff' });
      container.add(txt1);

      const btnUp = this.add.text(w/2 - 70, -h/2 + pad, 'Mejorar', { fontFamily: 'monospace', fontSize: '12px', color: '#9fe485', backgroundColor: '#224422' })
        .setPadding(4,2,4,2).setInteractive({ useHandCursor: true });
      const btnSell = this.add.text(w/2 - 70, pad, 'Vender', { fontFamily: 'monospace', fontSize: '12px', color: '#ffb3b3', backgroundColor: '#552222' })
        .setPadding(4,2,4,2).setInteractive({ useHandCursor: true });

      container.add(btnUp); container.add(btnSell);

      btnUp.on('pointerdown', () => {
        if (this.gold < nextCost) return;
        this.gold -= nextCost;
        this.goldText.setText(`🪙 ${this.gold}`);
        t.level += 1;
        t.spent += nextCost;
        t.model = scaleModel(t.base, t.level);
        this.closeMenu();
        this.showTowerInfo({sprite:t.sprite, model:t.model, level:t.level});
      });
      btnSell.on('pointerdown', () => {
        this.gold += sell;
        this.goldText.setText(`🪙 ${this.gold}`);
        t.sprite.destroy();
        // elimina de array
        this.towers = this.towers.filter(x => x !== t);
        this.closeMenu();
      });

      // Cierra si haces click fuera
      this.input.once('pointerdown', (pp: any) => {
        const dd = PhaserLib.Math.Distance.Between(pp.worldX, pp.worldY, cx, cy);
        if (dd > 120) this.closeMenu();
      });

      this.uiMenu = container;
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

    /** Elige un frame de enemigo existente; evita "__MISSING" */
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

    startWaves() {
      // Evitar múltiples arranques
      if ((this as any)._wavesStarted) return;
      (this as any)._wavesStarted = true;
      this.setupWavesFromJSON(this.map);
    }

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

        // oleada secundaria (opcional)
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
      (e as any).rootUntil = 0; // inmovilizado hasta ms

      const bar = this.add.rectangle(e.x, e.y - 18, 24, 3, 0x57ff57).setOrigin(0.5, 0.5).setDepth(121);
      (e as any).hpbar = bar;

      (e as any).updateTick = () => {
        const now = this.time.now;
        if ((e as any).rootUntil && now < (e as any).rootUntil) {
          // inmovilizado, solo actualizar barra
          const ratio = Math.max(0, (e as any).hp / (e as any).maxhp);
          bar.setPosition(e.x, e.y - 18).setScale(ratio, 1);
          return;
        }

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

    fireAt(t: { sprite: any; model: TowerModel }, target: any) {
      const m = t.model;
      // Muzzle flash (en posición correcta)
      const flash = this.add.graphics().setDepth(210);
      flash.fillStyle(m.fam === 'fire' ? 0xffb400 : m.fam === 'electric' ? 0x9ad0ff : m.fam === 'frost' ? 0xa8e1ff : 0x7bd97b, 0.8);
      flash.fillCircle(t.sprite.x, t.sprite.y, 6);
      this.time.delayedCall(60, () => flash.destroy());

      const p = this.add.image(t.sprite.x, t.sprite.y, 'projectiles', m.projectile).setDepth(200);
      this.projectiles.add(p);
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
      (p as any).root = m.root;
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

      // VFX de impacto en la posición del enemigo (coordenadas correctas)
      const fx = this.add.image(e.x, e.y,
        fam === 'fire' ? 'fx' : fam === 'frost' ? 'fx' : fam === 'nature' ? 'fx' : 'fx',
        fam === 'fire' ? 'Fire Explosion' : fam === 'frost' ? 'Ice Explosion' : fam === 'nature' ? 'Poison Cloud' : 'Electric Discharge'
      ).setDepth(210);
      this.time.delayedCall(180, () => fx.destroy());

      // Efectos por familia (capturando valores)
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
      if (fam === 'nature' && proj.root) {
        const ms: number = proj.root.ms;
        (e as any).rootUntil = Math.max((e as any).rootUntil || 0, this.time.now + ms);
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
        Fluent Tower Defense — MVP++
      </h3>
      <div style={{ color: '#a9b7ff', fontFamily: 'monospace', fontSize: 12, marginBottom: 6 }}>
        Click coloca · <b>1</b>=⚡ / <b>2</b>=🔥 / <b>3</b>=❄ / <b>4</b>=🌿 · <b>←/→</b> cambia skin ·
        <b> Espacio</b> pausa · <b>F</b> x2 · <b>ENTER</b> inicia oleada ·
        Click torre para <b>Upgrade/Vender</b> · <b>C</b> cierra menú
      </div>
      <div ref={rootRef} style={{ width: '100%', height: 'calc(100vh - 120px)' }} />
      {!mounted && <div style={{ color: '#99a', fontFamily: 'monospace', marginTop: 8 }}>Cargando…</div>}
    </div>
  );
}
