'use client';

// Importar Phaser SOLO en el navegador (evita "window is not defined" en Vercel)
let PhaserLib: any = null;
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  PhaserLib = require('phaser');
}

// ======== Tipos mínimos del mapa (no dependen de Phaser) ========
type MapPoint = { x:number; y:number };
type MapRect  = { x:number; y:number; w:number; h:number };
type MapDef = {
  name:string;
  tileSize:number; width:number; height:number;
  terrain:string;
  buildMask: MapRect[];
  paths: MapPoint[][];
  waves: {
    baseCount:number; countPerWave:number;
    baseHP:number; hpPerWave:number;
    baseSpeed:number; speedPerWave:number;
    spawnDelayMs:number; rewardBase:number;
  }
};

type FamKey = 'electric'|'fire'|'frost';

type TowerModel = {
  frame:string;
  fam: FamKey;
  cost:number;
  dmg:number;
  range:number;
  cd:number;
  projectile:'Lightning Bolt'|'Fireball'|'Ice Shard';
  chain?: { hops:number; falloff:number };
  slow?:  { factor:number; ms:number };
  dot?:   { dps:number; ms:number };
};

// ======== Modelos de torres ========
const ELECTRIC: TowerModel[] = [
  { frame:'Arc Coil I',     fam:'electric', cost:45, dmg:18, range:190, cd:700, projectile:'Lightning Bolt', chain:{hops:2,falloff:0.7} },
  { frame:'Tesla Grid III', fam:'electric', cost:85, dmg:30, range:210, cd:620, projectile:'Lightning Bolt', chain:{hops:3,falloff:0.7} },
  { frame:'Storm Lord V',   fam:'electric', cost:140,dmg:48, range:230, cd:540, projectile:'Lightning Bolt', chain:{hops:4,falloff:0.7} },
];
const FIRE: TowerModel[] = [
  { frame:'Flame Turret I',    fam:'fire', cost:45, dmg:14, range:150, cd:600, projectile:'Fireball', dot:{dps:6,ms:1200} },
  { frame:'Inferno Core III',  fam:'fire', cost:85, dmg:22, range:165, cd:520, projectile:'Fireball', dot:{dps:10,ms:1400} },
  { frame:'Phoenix Gate V',    fam:'fire', cost:140,dmg:30, range:180, cd:480, projectile:'Fireball', dot:{dps:16,ms:1600} },
];
const FROST: TowerModel[] = [
  { frame:'Ice Shard I',        fam:'frost', cost:45, dmg:16, range:180, cd:640, projectile:'Ice Shard', slow:{factor:0.7,ms:1200} },
  { frame:'Frost Cannon III',   fam:'frost', cost:85, dmg:26, range:200, cd:560, projectile:'Ice Shard', slow:{factor:0.6,ms:1500} },
  { frame:'Absolute Zero V',    fam:'frost', cost:140,dmg:40, range:220, cd:520, projectile:'Ice Shard', slow:{factor:0.5,ms:1800} },
];

const GROUPS: Record<FamKey,TowerModel[]> = {
  electric: ELECTRIC,
  fire: FIRE,
  frost: FROST,
};

// util: carga JSON de mapa
async function loadMapDef(name:string): Promise<MapDef> {
  const res = await fetch(`/maps/${name}.json`, { cache:'no-store' });
  if (!res.ok) throw new Error(`map ${name} not found`);
  return res.json();
}

// ========= Escena (se define usando PhaserLib dentro del runtime del navegador) =========
function createSceneClass() {
  const Phaser = PhaserLib;

  return class TD extends Phaser.Scene {
    map!: MapDef;
    gold = 320;
    waveIndex = 0;
    laneToggle = 0;

    enemies!: any;
    projectiles!: any;
    towers: { sprite:any; model:TowerModel; last:number }[] = [];

    goldText!: any;
    infoText!: any;
    tooltip!: any;
    rangeCircle!: any;

    selFam: FamKey = 'electric';
    selIdx = 0;
    blockedTiles = new Set<string>();

    worldToTile(x:number,y:number){ return { tx:Math.floor(x/this.map.tileSize), ty:Math.floor(y/this.map.tileSize) }; }
    tileKey(tx:number,ty:number){ return `${tx},${ty}`; }

    preload() {
      this.load.atlas('terrain64', '/assets/terrain_atlas.png', '/assets/terrain_atlas.json');
      this.load.atlas('ui32',      '/assets/ui_atlas.png',      '/assets/ui_atlas.json');
      this.load.atlas('towers',    '/assets/towers_atlas.png',  '/assets/towers_atlas.json');
      this.load.atlas('enemies32', '/assets/enemies32_atlas.png','/assets/enemies32_atlas.json');
      this.load.atlas('projectiles','/assets/projectiles_atlas.png','/assets/projectiles_atlas.json');
      this.load.atlas('fx',        '/assets/effects_atlas.png', '/assets/effects_atlas.json');
    }

    async create() {
      const url = new URL(window.location.href);
      const mapName = (url.searchParams.get('map') || 'grass_dual').replace(/[^a-z0-9_\-]/gi,'');
      this.map = await loadMapDef(mapName);

      this.cameras.main.setBackgroundColor('#0c0e12');

      this.drawMapFromJSON(this.map);

      this.goldText = this.add.text(16,16, `🪙 ${this.gold}`, { color:'#ffd76a', fontFamily:'monospace', fontSize:'18px' }).setDepth(1000);
      this.infoText = this.add.text(16,34, `Click para colocar – 1=⚡ Electric / 2=🔥 Fire / 3=❄ Frost  · ←/→ cambia skin · pasa el mouse sobre una torre para ver DPS/Range`, { color:'#b7c7ff', fontFamily:'monospace', fontSize:'12px' }).setDepth(1000);
      this.tooltip = this.add.text(0,0,'',{ color:'#e8f4ff', fontFamily:'monospace', fontSize:'12px', align:'left', backgroundColor:'rgba(0,0,0,0.35)' }).setDepth(1200).setVisible(false);
      this.rangeCircle = this.add.circle(0,0, 50, 0x4cc2ff, 0.12).setStrokeStyle(2,0x4cc2ff,0.8).setDepth(200).setVisible(false);

      this.enemies = this.add.group();
      this.projectiles = this.add.group();

      this.input.on('pointerdown', (p:any)=>{
        const model = GROUPS[this.selFam][this.selIdx];
        const { tx, ty } = this.worldToTile(p.worldX, p.worldY);
        if (tx<0 || ty<0 || tx>=this.map.width || ty>=this.map.height) return;
        if (this.blockedTiles.has(this.tileKey(tx,ty))) return;
        if (this.gold < model.cost) return;

        this.gold -= model.cost;
        this.goldText.setText(`🪙 ${this.gold}`);

        const x = tx*this.map.tileSize + this.map.tileSize/2;
        const y = ty*this.map.tileSize + this.map.tileSize/2;
        const spr = this.add.image(x,y,'towers', model.frame).setDepth(300);
        this.towers.push({ sprite:spr, model, last:0 });

        spr.setInteractive({ cursor:'pointer' });
        spr.on('pointerover', ()=>{
          this.rangeCircle.setVisible(true).setPosition(spr.x, spr.y).setRadius(model.range);
          const dps = (model.dmg * 1000 / model.cd).toFixed(1);
          this.tooltip.setVisible(true).setPosition(spr.x+18, spr.y-18)
            .setText(`T: ${model.frame}\nDPS ${dps} · Range ${model.range} · CD ${model.cd}ms`);
        });
        spr.on('pointerout', ()=>{
          this.rangeCircle.setVisible(false);
          this.tooltip.setVisible(false);
        });
      });

      window.addEventListener('keydown', (e)=>{
        if (e.key==='1') { this.selFam='electric'; this.selIdx=0; }
        if (e.key==='2') { this.selFam='fire';     this.selIdx=0; }
        if (e.key==='3') { this.selFam='frost';    this.selIdx=0; }
        if (e.key==='ArrowLeft')  this.selIdx = (this.selIdx + GROUPS[this.selFam].length - 1) % GROUPS[this.selFam].length;
        if (e.key==='ArrowRight') this.selIdx = (this.selIdx + 1) % GROUPS[this.selFam].length;
      });

      this.setupWavesFromJSON(this.map);
    }

    drawMapFromJSON(map:MapDef){
      const mark = (x:number,y:number)=> this.blockedTiles.add(this.tileKey(x,y));

      for (const lane of map.paths) {
        for (const p of lane) {
          if (p.x>=0 && p.x<map.width && p.y>=0 && p.y<map.height) {
            const cx = p.x*map.tileSize + map.tileSize/2;
            const cy = p.y*map.tileSize + map.tileSize/2;
            this.add.image(cx,cy,'terrain64', map.terrain).setDepth(50);
            mark(p.x,p.y);
          }
        }
      }

      for (const r of map.buildMask) {
        for (let x=r.x; x<r.x+r.w; x++)
        for (let y=r.y; y<r.y+r.h; y++) mark(x,y);
      }
    }

    setupWavesFromJSON(map:MapDef){
      this.waveIndex = 0;
      const next = () => {
        this.waveIndex++;
        const W = map.waves;
        const count = W.baseCount + this.waveIndex*W.countPerWave;
        const hp    = W.baseHP    + this.waveIndex*W.hpPerWave;
        const speed = W.baseSpeed + this.waveIndex*W.speedPerWave;

        const pathIdx = (this.laneToggle++ % 2 === 0) ? 0 : 1;
        const pathTiles = map.paths[pathIdx];
        const pathWorld = pathTiles.map(pt => ({
          x: pt.x*map.tileSize + map.tileSize/2,
          y: pt.y*map.tileSize + map.tileSize/2
        }));

        for (let i=0;i<count;i++){
          this.time.delayedCall(i*W.spawnDelayMs, ()=> this.spawnEnemy(pathWorld, hp, speed));
        }

        if (this.waveIndex % 3 === 0) {
          const other = map.paths[pathIdx?0:1].map(pt=>({
            x: pt.x*map.tileSize + map.tileSize/2,
            y: pt.y*map.tileSize + map.tileSize/2
          }));
          for (let i=0;i<Math.floor(count*0.7);i++){
            this.time.delayedCall(i*W.spawnDelayMs, ()=> this.spawnEnemy(other, Math.floor(hp*0.9), speed));
          }
        }

        this.time.delayedCall(count*W.spawnDelayMs + 5500, next);
      };
      next();
    }

    spawnEnemy(path:{x:number;y:number}[], hp:number, speed:number){
      const start = path[0];
      const e = this.add.image(start.x, start.y, 'enemies32', 'Goblin Scout').setDepth(120);
      this.enemies.add(e);
      (e as any).hp = hp;
      (e as any).maxhp = hp;
      (e as any).speed = speed;
      (e as any).pathIndex = 1;

      const bar = this.add.rectangle(e.x, e.y-18, 24, 3, 0x57ff57).setOrigin(0.5,0.5).setDepth(121);
      (e as any).hpbar = bar;

      (e as any).updateTick = ()=>{
        const i = (e as any).pathIndex;
        if (i >= path.length) { e.destroy(); bar.destroy(); return; }
        const target = path[i];
        const dx = target.x - e.x, dy = target.y - e.y;
        const dist = Math.hypot(dx,dy);
        const spd = (e as any).speed * (1/60);
        if (dist <= spd) { e.setPosition(target.x, target.y); (e as any).pathIndex++; }
        else { e.setPosition(e.x + (dx/dist)*spd, e.y + (dy/dist)*spd); }
        const ratio = Math.max(0, (e as any).hp / (e as any).maxhp);
        bar.setPosition(e.x, e.y-18).setScale(ratio,1);
      };
    }

    fireAt(t: {sprite:any; model:TowerModel}, target:any){
      const m = t.model;
      const p = this.add.image(t.sprite.x, t.sprite.y, 'projectiles', m.projectile).setDepth(200);
      this.projectiles.add(p);
      (p as any).vx = (target.x - p.x);
      (p as any).vy = (target.y - p.y);
      const len = Math.hypot((p as any).vx,(p as any).vy) || 1;
      const speed = 520;
      (p as any).vx = (p as any).vx / len * speed * (1/60);
      (p as any).vy = (p as any).vy / len * speed * (1/60);
      (p as any).dmg = m.dmg;
      (p as any).fam = m.fam;
      (p as any).slow = m.slow;
      (p as any).dot  = m.dot;
      (p as any).chain= m.chain;
      (p as any).ttl = 900;
    }

    chainLightning(origin:any, baseDmg:number, hops:number, falloff:number){
      const visited = new Set<any>();
      const queue:{ node:any; dmg:number; depth:number }[] = [];
      visited.add(origin);
      queue.push({ node: origin, dmg: baseDmg, depth: 0 });

      while (queue.length){
        const { node, dmg, depth } = queue.shift()!;
        if (depth>=hops) continue;

        let best:any = null;
        let bestD = 999999;
        this.enemies.getChildren().forEach((c:any)=>{
          if (!c || !c.active || visited.has(c)) return;
          const d = Phaser.Math.Distance.Between(node.x,node.y,c.x,c.y);
          if (d < 140 && d < bestD) { best=c; bestD=d; }
        });

        if (best){
          const g = this.add.graphics().setDepth(220);
          g.lineStyle(2,0x9ad0ff,0.85);
          g.beginPath(); g.moveTo(node.x,node.y); g.lineTo(best.x,best.y); g.strokePath();
          this.time.delayedCall(80, ()=> g.destroy());

          (best as any).hp -= Math.max(1, Math.round(dmg));
          visited.add(best);

          queue.push({ node:best, dmg: dmg*falloff, depth: depth+1 });
        }
      }
    }

    doHit(proj:any, enemy:any){
      const p:any = proj; const e:any = enemy;
      e.hp -= p.dmg;

      if (p.fam==='frost' && p.slow){
        const old = e.speed;
        e.speed = old * p.slow.factor;
        this.time.delayedCall(p.slow.ms, ()=> e && (e.speed = old));
      }
      if (p.fam==='fire' && p.dot){
        const ticks = Math.floor(p.dot.ms/300);
        for (let i=1;i<=ticks;i++){
          this.time.delayedCall(i*300, ()=> e && (e.hp -= Math.round(p.dot.dps*0.3)));
        }
      }
      if (p.fam==='electric' && p.chain){
        this.chainLightning(enemy, p.dmg, p.chain.hops, p.chain.falloff);
      }

      if (e.hp <= 0){
        const puff = this.add.image(e.x,e.y,'fx','Poison Cloud').setDepth(210);
        this.time.delayedCall(220, ()=> puff.destroy());

        e.hpbar?.destroy();
        e.destroy();
        this.gold += 6 + Math.floor(this.waveIndex*0.6);
        this.goldText.setText(`🪙 ${this.gold}`);
      }

      proj.destroy();
    }

    update(time:number, dt:number){
      this.enemies.getChildren().forEach((e:any)=> e?.updateTick?.());

      for (const t of this.towers){
        if (time < t.last + t.model.cd) continue;

        let best:any = null;
        let bestD= 1e9;
        this.enemies.getChildren().forEach((c:any)=>{
          if (!c || !c.active) return;
          const d = Phaser.Math.Distance.Between(t.sprite.x,t.sprite.y,c.x,c.y);
          if (d < t.model.range && d < bestD){ best=c; bestD=d; }
        });
        if (best){
          t.last = time;
          this.fireAt(t, best);
        }
      }

      this.projectiles.getChildren().forEach((p:any)=>{
        p.x += p.vx; p.y += p.vy; p.ttl -= dt;
        if (p.ttl<=0){ p.destroy(); return; }
        let hit:any = null;
        this.enemies.getChildren().some((e:any)=>{
          if (!e || !e.active) return false;
          const d = Phaser.Math.Distance.Between(p.x,p.y,e.x,e.y);
          if (d < 18){ hit=e; return true; }
          return false;
        });
        if (hit) this.doHit(p, hit);
      });
    }
  };
}

// ========= Componente React =========
import React, { useEffect, useRef, useState } from 'react';

export default function BattleClient(){
  const rootRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<any>(null);
  const [mounted,setMounted] = useState(false);

  useEffect(()=>{
    if (!PhaserLib) return; // en SSR no hay Phaser
    setMounted(true);

    const TD = createSceneClass();
    const config:any = {
      type: PhaserLib.AUTO,
      width: 1180,
      height: 680,
      parent: rootRef.current || undefined,
      backgroundColor: '#0c0e12',
      physics: { default: 'arcade' },
      scene: TD,
    };

    gameRef.current = new PhaserLib.Game(config);

    return ()=> {
      try { gameRef.current?.destroy(true); } catch {}
      gameRef.current = null;
    };
  },[]);

  return (
    <div style={{padding:'8px'}}>
      <h3 style={{color:'#e8f4ff',fontFamily:'monospace',margin:'4px 0'}}>Fluent Tower Defense — MVP</h3>
      <div style={{color:'#a9b7ff',fontFamily:'monospace',fontSize:12,marginBottom:6}}>
        Click para colocar · <b>1</b>=⚡ Electric / <b>2</b>=🔥 Fire / <b>3</b>=❄ Frost · <b>←/→</b> cambia skin · pasa el mouse sobre una torre para ver <b>DPS/Range</b>
      </div>
      <div ref={rootRef} />
      {!mounted && <div style={{color:'#99a',fontFamily:'monospace',marginTop:8}}>Cargando…</div>}
    </div>
  );
}
