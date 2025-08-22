'use client';
import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { registerAnimIfAny } from '@/app/lib/anim';

const TILE = 64;
const GRID_W = 18;
const GRID_H = 9;

const TERRAIN_FRAMES = {
  grass: 'Grass Path',
  snow:  'Snow Path',
  stone: 'Stone Path',
  lava:  'Lava Path',
} as const;

function drawPathCell(scene: Phaser.Scene, gx: number, gy: number, biome: keyof typeof TERRAIN_FRAMES, mask: number) {
  const cx = gx * TILE + TILE / 2, cy = gy * TILE + TILE / 2;
  const frame = TERRAIN_FRAMES[biome];
  const horiz = (mask & 2) || (mask & 8);
  const vert  = (mask & 1) || (mask & 4);
  if (!horiz && !vert) { scene.add.image(cx, cy, 'terrain64', frame).setDepth(0); return; }
  if (horiz) scene.add.image(cx, cy, 'terrain64', frame).setAngle(0).setDepth(0);
  if (vert)  scene.add.image(cx, cy, 'terrain64', frame).setAngle(90).setDepth(0);
}

function renderPath(scene: Phaser.Scene, grid: number[][], biome: keyof typeof TERRAIN_FRAMES) {
  const H = grid.length, W = grid[0].length;
  const v = (x:number,y:number)=> (x>=0&&x<W&&y>=0&&y<H&&grid[y][x]===1)?1:0;
  for (let y=0; y<H; y++) for (let x=0; x<W; x++) {
    if (!grid[y][x]) continue;
    const mask = (v(x,y-1)?1:0)+(v(x+1,y)?2:0)+(v(x,y+1)?4:0)+(v(x-1,y)?8:0);
    drawPathCell(scene, x, y, biome, mask);
  }
}

export default function BattlePage() {
  const ref = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!ref.current || gameRef.current) return;

    class TD extends Phaser.Scene {
      placed: Phaser.GameObjects.Sprite[] = [];
      constructor(){ super('TD'); }
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

        const grid = [
          Array(GRID_W).fill(1),
          Array(GRID_W).fill(0),
          Array(GRID_W).fill(1),
        ];
        renderPath(this, grid, 'grass');

        this.add.image(24, 24, 'ui32', 'icon_gold').setScrollFactor(0).setDepth(1000).setOrigin(0,0);
        this.add.image(24, 56, 'ui32', 'icon_crystals').setScrollFactor(0).setDepth(1000).setOrigin(0,0);
        this.add.image(24, 88, 'ui32', 'icon_energy').setScrollFactor(0).setDepth(1000).setOrigin(0,0);
        this.add.image(24,120, 'ui32', 'icon_xp').setScrollFactor(0).setDepth(1000).setOrigin(0,0);

        registerAnimIfAny(this, { atlas:'towers', key:'frost_idle',   prefix:'frost_idle',   fallbackFrame:'frost_idle_1' });
        registerAnimIfAny(this, { atlas:'towers', key:'frost_attack', prefix:'frost_attack', fallbackFrame:'frost_idle_1', fps:14, repeat:0 });
        registerAnimIfAny(this, { atlas:'enemies32', key:'goblin_walk',  prefix:'goblin_walk',  fallbackFrame:'goblin_walk_1' });
        registerAnimIfAny(this, { atlas:'enemies32', key:'goblin_death', prefix:'goblin_death', fallbackFrame:'goblin_walk_1', fps:14, repeat:0 });

        this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
          const gx = Math.floor(p.x / TILE), gy = Math.floor(p.y / TILE);
          if (gx<0||gx>=GRID_W||gy<0||gy>=GRID_H) return;
          const x = gx*TILE + TILE/2, y = gy*TILE + TILE/2;
          const t = this.add.sprite(x, y, 'towers');
          t.play('frost_idle'); t.setDepth(y);
          this.placed.push(t);
        });

        this.time.delayedCall(500, () => {
          const pathY = TILE/2;
          const startX = GRID_W*TILE + 40;
          for (let i=0; i<8; i++) {
            const e = this.add.sprite(startX + i*50, pathY, 'enemies32');
            e.play('goblin_walk'); e.setDepth(e.y);
            this.tweens.add({
              targets: e, x: -40, duration: 8000 + i*200,
              onComplete: () => { e.play('goblin_death'); this.time.delayedCall(400, ()=> e.destroy()); }
            });
          }
        });

        this.time.addEvent({
          delay: 1500, loop: true,
          callback: () => {
            this.placed.forEach(t => t.play('frost_attack'));
            this.time.delayedCall(300, () => this.placed.forEach(t => t.play('frost_idle')));
          }
        });
      }
    }

    gameRef.current = new Phaser.Game({
      type: Phaser.AUTO,
      width: GRID_W * TILE,
      height: GRID_H * TILE,
      parent: ref.current!,
      backgroundColor: '#0e0e0e',
      scene: [TD],
      render: { pixelArt: true, antialias: false }
    });

    return () => { gameRef.current?.destroy(true); gameRef.current = null; };
  }, []);

  return <div style={{ width: '100%', height: '100%', display:'flex', justifyContent:'center' }}>
    <div ref={ref} />
  </div>;
}
