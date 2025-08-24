'use client';

import React, { useEffect, useRef, useState } from 'react';

// Phaser solo en cliente
let PhaserLib: any = null;
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  PhaserLib = require('phaser');
}

/* ---------------- Tipos y utils ---------------- */
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

/* ---------------- Torres ---------------- */
const ELECTRIC: TowerModel[] = [
  { frame: 'Arc Coil I',     fam: 'electric', cost: 50,  dmg: 18, range: 190, cd: 680, projectile: 'Lightning Bolt', chain: { hops: 2, falloff: 0.72 } },
  { frame: 'Tesla Grid III', fam: 'electric', cost: 95,  dmg: 30, range: 210, cd: 600, projectile: 'Lightning Bolt', chain: { hops: 3, falloff: 0.72 } },
  { frame: 'Storm Lord V',   fam: 'electric', cost: 150, dmg: 48, range: 230, cd: 540, projectile: 'Lightning Bolt', chain: { hops: 4, falloff: 0.7 } },
];
const FIRE: TowerModel[] = [
  { frame: 'Flame Turret I',   fam: 'fire', cost: 50,  dmg: 14, range: 155, cd: 580, projectile: 'Fireball',   dot: { dps: 7,  ms: 1200 } },
  { frame: 'Inferno Core III', fam: 'fire', cost: 95,  dmg: 22, range: 170, cd: 520, projectile: 'Fireball',   dot: { dps: 12, ms: 1400 } },
  { frame: 'Phoenix Gate V',   fam: 'fire', cost: 150, dmg: 32, range: 185, cd: 480, projectile: 'Fireball',   dot: { dps: 18, ms: 1600 } },
];
const FROST: TowerModel[] = [
  { frame: 'Ice Shard I',       fam: 'frost', cost: 50,  dmg: 16, range: 180, cd: 640, projectile: 'Ice Shard', slow: { factor: 0.7, ms: 1200 } },
  { frame: 'Frost Cannon III',  fam: 'frost', cost: 95,  dmg: 26, range: 205, cd: 560, projectile: 'Ice Shard', slow: { factor: 0.6, ms: 1500 } },
  { frame: 'Absolute Zero V',   fam: 'frost', cost: 150, dmg: 40, range: 225, cd: 520, projectile: 'Ice Shard', slow: { factor: 0.5, ms: 1800 } },
];
const NATURE: TowerModel[] = [
  { frame: 'Thorn Vine I',      fam: 'nature', cost: 55,  dmg: 15, range: 175, cd: 620, projectile: 'Poison Dart', dot:{ dps: 8, ms: 1600 }, slow:{ factor:0.9, ms:800 } },
  { frame: 'Entangle Root III', fam: 'nature', cost: 100, dmg: 24, range: 195, cd: 560, projectile: 'Poison Dart', dot:{ dps:12, ms: 2000 }, slow:{ factor:0.85,ms:900 } },
  { frame: 'World Tree V',      fam: 'nature', cost: 160, dmg: 34, range: 215, cd: 520, projectile: 'Poison Dart', dot:{ dps:18, ms: 2400 }, slow:{ factor:0.82,ms:1000 } },
];

const GROUPS: Record<FamKey, TowerModel[]> = {
  electric: ELECTRIC, fire: FIRE, frost: FROST, nature: NATURE
};

/* ---------------- Escena ---------------- */
function createSceneClass() {
  const Phaser = PhaserLib;

  return class TD extends Phaser.Scene {
    map!: MapDef;
    gold = 320;
    waveIndex = 0;
    laneToggle = 0;

    enemies!: any;
    projectiles!: any;
    towers: { sprite: any; model: TowerModel; last: number }[] = [];

    goldText!: any;
    infoText!: any;
    tooltip!: any;
    rangeCircle!: any;

    // partículas compartidas
    fx!: any; // Phaser.GameObjects.Particles.ParticleEmitterManager

    // menú torres
    uiMenu?: any;
    uiMenuShowingFor?: any;

    selFam: FamKey = 'electric';
    selIdx = 0;
    blockedTiles = new Set<string>();
    ready = false;

    diff = { name: 'normal', countMul:1, hpMul:1, speedMul:1, rewardMul:1 };

    worldToTile(x: number, y: number) { return { tx: Math.floor(x / this.map.tileSize), ty: Math.floor(y / this.map.tileSize) }; }
    tileKey(tx: number, ty: number) { return `${tx},${ty}`; }

    parseDiff(){
      const url = new URL(window.location.href);
      const d = (url.searchParams.get('diff') || 'normal').toLowerCase();
      const preset = {
        easy:   { name:'easy',   countMul:0.9, hpMul:0.85, speedMul:0.95, rewardMul:1.1 },
        normal: { name:'normal', countMul:1.0, hpMul:1.0,  speedMul:1.0,  rewardMul:1.0 },
        hard:   { name:'hard',   countMul:1.1, hpMul:1.25, speedMul:1.1,  rewardMul:1.1 },
        insane: { name:'insane', countMul:1.25, hpMul:1.55, speedMul:1.18, rewardMul:1.2 },
      } as const;
      this.diff = (preset as any)[d] || preset.normal;
    }

    preload() {
      this.load.atlas('terrain64',  '/assets/terrain_atlas.png',     '/assets/terrain_atlas.json');
      this.load.atlas('ui32',       '/assets/ui_atlas.png',          '/assets/ui_atlas.json');
      this.load.atlas('towers',     '/assets/towers_atlas.png',      '/assets/towers_atlas.json');
      this.load.atlas('enemies32',  '/assets/enemies32_atlas.png',   '/assets/enemies32_atlas.json');
      this.load.atlas('enemies40',  '/assets/enemies40_atlas.png',   '/assets/enemies40_atlas.json');
      this.load.atlas('enemies48',  '/assets/enemies48_atlas.png',   '/assets/enemies48_atlas.json');
      this.load.atlas('projectiles','/assets/projectiles_atlas.png', '/assets/projectiles_atlas.json');
      this.load.atlas('fx',         '/assets/effects_atlas.png',     '/assets/effects_atlas.json');

      // sonidos (fallback si no existen)
      const load = (k:string, names:string[]) => { try { this.load.audio(k, names); } catch {} };
      load('coin',  ['/audio/coin.mp3','/audio/coin.wav']);
      load('place', ['/audio/place.mp3','/audio/place.wav']);
      load('shoot_fire', ['/audio/shoot_fire.mp3','/audio/shoot.mp3']);
      load('shoot_frost',['/audio/shoot_frost.mp3','/audio/shoot.mp3']);
      load('shoot_elec', ['/audio/shoot_elec.mp3','/audio/shoot.mp3']);
      load('shoot_nature',['/audio/shoot_nature.mp3','/audio/shoot.mp3']);
      load('hit', ['/audio/hit.mp3','/audio/shot.wav']);
    }

    async create() {
      this.enemies = this.add.group();
      this.projectiles = this.add.group();
      this.fx = this.add.particles('fx');

      this.parseDiff();

      // Mapa
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
        `Mapa: ${mapName} · Dificultad: ${this.diff.name} · Click coloca · 1=⚡ / 2=🔥 / 3=❄ / 4=🌿 · ←/→ cambia skin · SPACE pausa · F x2`,
        { color: '#b7c7ff', fontFamily: 'monospace', fontSize: '12px' }
      ).setDepth(1000);

      this.tooltip = this.add.text(0, 0, '', {
        color: '#e8f4ff', fontFamily: 'monospace', fontSize: '12px',
        backgroundColor: 'rgba(0,0,0,0.35)'
      }).setDepth(1200).setVisible(false);

      this.rangeCircle = this.add.circle(0, 0, 50, 0x4cc2ff, 0.12)
        .setStrokeStyle(2, 0x4cc2ff, 0.8).setDepth(200).setVisible(false);

      // Terreno
      this.drawMapFromJSON(this.map);

      // Click global: primero detectar torre, si no hay => colocar
      this.input.on('pointerdown', (p: any) => {
        if (this.tryOpenTowerMenuAt(p.worldX, p.worldY)) return; // si clic sobre torre, abre menú
        this.tryPlaceTowerAt(p.worldX, p.worldY);
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
        if (e.key.toLowerCase() === 'escape') this.hideTowerMenu();
      });

      // Oleadas
      this.setupWavesFromJSON(this.map);

      this.ready = true;
    }

    /* ----- helpers de UI torres ----- */
    tryOpenTowerMenuAt(wx:number, wy:number){
      // ¿clic cerca de alguna torre?
      let hit:any = null, bestD=9999;
      this.towers.forEach(t=>{
        const d = PhaserLib.Math.Distance.Between(wx, wy, t.sprite.x, t.sprite.y);
        if (d < 26 && d < bestD) { hit=t; bestD=d; }
      });
      if (hit) { this.showTowerMenu(hit); return true; }
      this.hideTowerMenu();
      return false;
    }

    showTowerMenu(tower:{sprite:any; model:TowerModel; last:number}){
      this.hideTowerMenu();
      this.uiMenuShowingFor = tower;

      const cx = tower.sprite.x, cy = tower.sprite.y;
      const bg = this.add.rectangle(cx, cy-54, 170, 70, 0x0b1220, 0.92).setStrokeStyle(1, 0x35507a).setDepth(900);
      const up = this.add.text(bg.x-70, bg.y-12, 'Upgrade', {fontFamily:'monospace', fontSize:'13px', color:'#96cafc'}).setDepth(901).setInteractive({useHandCursor:true});
      const sell = this.add.text(bg.x-70, bg.y+10, 'Vender', {fontFamily:'monospace', fontSize:'13px', color:'#ffd79a'}).setDepth(901).setInteractive({useHandCursor:true});
      const close = this.add.text(bg.x+58, bg.y-28, '✕', {fontFamily:'monospace', fontSize:'14px', color:'#9ab'}).setDepth(901).setInteractive({useHandCursor:true});

      up.on('pointerdown', () => { this.tryUpgradeTower(tower); });
      sell.on('pointerdown', () => { this.sellTower(tower); });
      close.on('pointerdown', () => this.hideTowerMenu());

      this.uiMenu = this.add.container(0,0,[bg,up,sell,close]);
    }

    hideTowerMenu(){
      this.uiMenu?.destroy();
      this.uiMenu = undefined;
      this.uiMenuShowingFor = undefined;
    }

    tryUpgradeTower(tower:{sprite:any; model:TowerModel; last:number}){
      const family = GROUPS[tower.model.fam];
      const idx = family.findIndex(m => m.frame === tower.model.frame);
      if (idx < 0 || idx >= family.length-1) return; // ya tope

      const next = family[idx+1];
      const cost = Math.max(0, next.cost - tower.model.cost);
      if (this.gold < cost) return;

      this.gold -= cost;
      this.goldText.setText(`🪙 ${this.gold}`);
      tower.model = next;
      tower.sprite.setFrame(next.frame);
      try { this.sound.play('place', { volume: 0.35 }); } catch {}
      this.hideTowerMenu();
    }

    sellTower(tower:{sprite:any; model:TowerModel; last:number}){
      const refund = Math.floor(tower.model.cost * 0.6);
      this.gold += refund;
      this.goldText.setText(`🪙 ${this.gold}`);
      tower.sprite.destroy();
      this.towers = this.towers.filter(t=>t!==tower);
      try { this.sound.play('coin', { volume: 0.35 }); } catch {}
      this.hideTowerMenu();
    }

    /* ----- colocación ----- */
    tryPlaceTowerAt(wx:number, wy:number){
      const model = GROUPS[this.selFam][this.selIdx];
      const { tx, ty } = this.worldToTile(wx, wy);
      if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) return;
      if (this.blockedTiles.has(this.tileKey(tx, ty))) return;
      if (this.gold < model.cost) return;

      // Evita que se coloque encima de una torre existente
      for (const t of this.towers) {
        if (PhaserLib.Math.Distance.Between(t.sprite.x, t.sprite.y, wx, wy) < this.map.tileSize*0.5) {
          return;
        }
      }

      this.gold -= model.cost;
      this.goldText.setText(`🪙 ${this.gold}`);
      try { this.sound.play('place', { volume: 0.4 }); } catch {}

      const x = tx * this.map.tileSize + this.map.tileSize / 2;
      const y = ty * this.map.tileSize + this.map.tileSize / 2;
      const spr = this.add.image(x, y, 'towers', model.frame).setDepth(300);
      this.towers.push({ sprite: spr, model, last: 0 });

      spr.setInteractive({ cursor: 'pointer' });
      spr.on('pointerdown', (pointer:any) => {
        this.showTowerMenu(this.towers.find(t=>t.sprite===spr)!);
        pointer?.event?.stopPropagation?.();
      });
      spr.on('pointerover', () => {
        this.rangeCircle.setVisible(true).setPosition(spr.x, spr.y).setRadius(model.range);
        const dps = (model.dmg * 1000 / model.cd).toFixed(1);
        this.tooltip.setVisible(true).setPosition(spr.x + 18, spr.y - 18)
          .setText(`T: ${model.frame}\nDPS ${dps} · Range ${model.range} · CD ${model.cd}ms`);
      });
      spr.on('pointerout', () => {
        this.rangeCircle.setVisible(false);
        this.tooltip.setVisible(false);
      });
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

    pickEnemyVisual() {
      const list: { key: string; frame: string }[] = [
        { key: 'enemies48', frame: 'Demon Lord' },
        { key: 'enemies48', frame: 'Death Knight' },
        { key: 'enemies40', frame: 'Armored Knight' },
        { key: 'enemies40', frame: 'Dark Mage' },
        { key: 'enemies32', frame: 'Goblin Scout' },
        { key: 'enemies32', frame: 'Orc Warrior' },
      ];
      for (const c of list) {
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
        let count = W.baseCount + this.waveIndex * W.countPerWave;
        let hp    = W.baseHP    + this.waveIndex * W.hpPerWave;
        let speed = W.baseSpeed + this.waveIndex * W.speedPerWave;

        // dificultad
        count = Math.max(1, Math.round(count * this.diff.countMul));
        hp = Math.max(1, Math.round(hp * this.diff.hpMul));
        speed = Math.max(20, speed * this.diff.speedMul);

        const reward = Math.round((W.rewardBase + Math.floor(this.waveIndex*0.6)) * this.diff.rewardMul);

        const pathIdx = (this.laneToggle++ % 2 === 0) ? 0 : 1;
        const pathTiles = map.paths[pathIdx];
        const pathWorld = pathTiles.map(pt => ({
          x: pt.x * map.tileSize + map.tileSize / 2,
          y: pt.y * map.tileSize + map.tileSize / 2,
        }));

        for (let i = 0; i < count; i++) {
          this.time.delayedCall(i * W.spawnDelayMs, () => this.spawnEnemy(pathWorld, hp, speed, reward));
        }

        if (this.waveIndex % 3 === 0) {
          const other = map.paths[pathIdx ? 0 : 1].map(pt => ({
            x: pt.x * map.tileSize + map.tileSize / 2,
            y: pt.y * map.tileSize + map.tileSize / 2,
          }));
          for (let i = 0; i < Math.floor(count * 0.7); i++) {
            this.time.delayedCall(i * W.spawnDelayMs, () => this.spawnEnemy(other, Math.floor(hp * 0.9), speed, reward));
          }
        }

        this.time.delayedCall(count * W.spawnDelayMs + 5500, next);
      };
      next();
    }

    spawnEnemy(path: { x: number; y: number }[], hp: number, speed: number, reward:number) {
      const start = path[0];
      const vis = this.pickEnemyVisual();
      const e = this.add.image(start.x, start.y, vis.key, vis.frame).setDepth(120);
      this.enemies.add(e);
      (e as any).hp = hp;
      (e as any).maxhp = hp;
      (e as any).speed = speed;
      (e as any).pathIndex = 1;
      (e as any).reward = reward;

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

    fireAt(t: { sprite: any; model: TowerModel }, target: any) {
      const m = t.model;
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
      (p as any).ttl = 900;

      // trail por familia
      let frameTrail = 'Electric Discharge';
      if (m.fam === 'fire') frameTrail = 'Fire Explosion';
      if (m.fam === 'frost') frameTrail = 'Ice Explosion';
      if (m.fam === 'nature') frameTrail = 'Poison Cloud';

      const emitter = this.fx.createEmitter({
        frame: frameTrail,
        speed: 0,
        lifespan: 320,
        scale: { start: 0.45, end: 0 },
        alpha: { start: 0.85, end: 0 },
        frequency: 60,
        quantity: 1,
        follow: p,
        blendMode: 'ADD'
      });
      (p as any)._em = emitter;

      const shootKey = m.fam === 'fire' ? 'shoot_fire' :
                       m.fam === 'frost' ? 'shoot_frost' :
                       m.fam === 'nature'? 'shoot_nature' : 'shoot_elec';
      try { this.sound.play(shootKey, { volume: 0.25 }); } catch {}
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
          g.lineStyle(2, 0x9ad0ff, 0.9);
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

      // quita trail
      proj._em?.stop(); this.time.delayedCall(350, ()=> proj._em?.remove());

      e.hp -= baseDmg;

      if (fam === 'frost' && proj.slow) {
        const slowFactor: number = proj.slow.factor;
        const slowMs: number = proj.slow.ms;
        const old = e.speed;
        e.speed = old * slowFactor;
        this.time.delayedCall(slowMs, () => e && (e.speed = old));
      }
      if ((fam === 'fire' || fam==='nature') && proj.dot) {
        const dotDps: number = proj.dot.dps;
        const dotMs: number = proj.dot.ms;
        const ticks = Math.floor(dotMs / 300);
        for (let i = 1; i <= ticks; i++) {
          this.time.delayedCall(i * 300, () => e && (e.hp -= Math.round(dotDps * 0.3)));
        }
        // nature aplica un slow leve si tiene slow definido
        if (fam==='nature' && proj.slow){
          const old = e.speed;
          e.speed = old * proj.slow.factor;
          this.time.delayedCall(proj.slow.ms, ()=> e && (e.speed = old));
        }
      }
      if (fam === 'electric' && proj.chain) {
        this.chainLightning(enemy, baseDmg, proj.chain.hops as number, proj.chain.falloff as number);
      }

      // puff FX
      const puffFrame = fam==='fire' ? 'Fire Explosion'
                        : fam==='frost' ? 'Ice Explosion'
                        : fam==='nature' ? 'Poison Cloud'
                        : 'Electric Discharge';
      const puff = this.add.image(e.x, e.y, 'fx', puffFrame).setDepth(210);
      this.time.delayedCall(220, () => puff.destroy());

      try { this.sound.play('hit', { volume: 0.2 }); } catch {}

      if (e.hp <= 0) {
        e.hpbar?.destroy();
        e.destroy();
        this.gold += (e.reward ?? 6);
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
        if (p.ttl <= 0) { p._em?.stop(); this.time.delayedCall(250, ()=>p._em?.remove()); p.destroy(); return; }
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

/* ---------------- Componente React ---------------- */
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
        <b> Space</b> pausa · <b>F</b> x2 · Click torre para <b>Upgrade/Vender</b>
      </div>
      <div ref={rootRef} style={{ width: '100%', height: 'calc(100vh - 120px)' }} />
      {!mounted && <div style={{ color: '#99a', fontFamily: 'monospace', marginTop: 8 }}>Cargando…</div>}
    </div>
  );
}
