'use client';

import React, { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';

/** ---- Config general ---- */
const TILE = 64;                     // tamaño de casilla
const W = 1280;                      // ancho del canvas
const H = 720;                       // alto del canvas
const LANE_Y = 96;                   // y de la primera fila de camino
const LANE_Y2 = 256;                 // y de la segunda fila de camino

/** Familias/tipos de torre que mostraremos con las teclas 1–3 */
type FamKey = 'electric' | 'fire' | 'frost';

const FAMILY: Record<FamKey, {
  name: string;
  projectile: string;     // frame del atlas 'projectiles'
  fx: string;             // frame del atlas 'fx' para el impacto
  range: number;
  cooldownMs: number;
  baseDamage: number;
  /** Efectos opcionales */
  effects?: Partial<{
    // chain lightning
    chain: { jumps: number; radius: number; falloff: number[] };
    // estados
    slowPct: number; slowMs: number;
    burnDps: number; burnMs: number;
    poisonDps: number; poisonMs: number;
    critChance: number; critMul: number;
  }>;
}> = {
  electric: {
    name: 'ELECTRIC',
    projectile: 'Lightning Bolt',
    fx: 'Electric Discharge',
    range: 260,
    cooldownMs: 360,
    baseDamage: 18,
    effects: {
      chain: { jumps: 2, radius: 180, falloff: [0.6, 0.5] },
      critChance: 0.08, critMul: 2.0,
    }
  },
  fire: {
    name: 'FIRE',
    projectile: 'Fireball',
    fx: 'Fire Explosion',
    range: 220,
    cooldownMs: 520,
    baseDamage: 24,
    effects: {
      burnDps: 4, burnMs: 1600,
      critChance: 0.06, critMul: 1.8,
    }
  },
  frost: {
    name: 'FROST',
    projectile: 'Ice Shard',
    fx: 'Ice Explosion',
    range: 240,
    cooldownMs: 680,
    baseDamage: 22,
    effects: {
      slowPct: 0.35, slowMs: 1100,
    }
  }
};

/** Frames de los atlas para las torres (atlas 'towers') */
const TOWER_FRAMES: Record<FamKey, string[]> = {
  frost:    ['Ice Shard I', 'Frost Cannon III', 'Absolute Zero V'],
  fire:     ['Flame Turret I', 'Inferno Core III', 'Phoenix Gate V'],
  electric: ['Arc Coil I', 'Tesla Grid III', 'Storm Lord V'],
};

type Tower = {
  fam: FamKey;
  s: Phaser.GameObjects.Image;
  range: number;
  dmg: number;
  cdMs: number;
  lastShot: number;
};

type Enemy = {
  s: Phaser.GameObjects.Image;
  barBg?: Phaser.GameObjects.Rectangle;
  barFg?: Phaser.GameObjects.Rectangle;
  hp: number;
  max: number;
  speed: number;
  path: { x: number, y: number }[];
  idx: number;
  alive: boolean;
  // estados
  slowPct?: number; slowUntil?: number;
  burnDps?: number; burnUntil?: number;
  poisonDps?: number; poisonUntil?: number;
};

class TD extends Phaser.Scene {
  towers: Tower[] = [];
  enemies: Enemy[] = [];
  bullets: { s: Phaser.GameObjects.Image; vx: number; vy: number; fam: FamKey; dmg: number; target: Enemy | null }[] = [];
  gold = 100;
  goldText!: Phaser.GameObjects.Text;

  waveIndex = 0;
  nextSpawnAt = 0;
  laneToggle = 0;

  selectedFam: FamKey = 'electric';
  selectedTierIndex: number = 2; // por defecto el 3º frame (más vistoso)

  uiTop!: Phaser.GameObjects.Text;
  tooltip!: Phaser.GameObjects.Text;
  rangeCircle?: Phaser.GameObjects.Arc;
  hoveredTower?: Tower;

  constructor() { super('TD'); }

  preload() {
    // Carga de atlas (ya generados por el empaquetador)
    this.load.atlas('terrain64', '/assets/terrain_atlas.png', '/assets/terrain_atlas.json');
    this.load.atlas('ui32',      '/assets/ui_atlas.png',      '/assets/ui_atlas.json');
    this.load.atlas('towers',    '/assets/towers_atlas.png',  '/assets/towers_atlas.json');
    this.load.atlas('castles',   '/assets/castles_atlas.png', '/assets/castles_atlas.json');
    this.load.atlas('enemies32', '/assets/enemies32_atlas.png','/assets/enemies32_atlas.json');
    this.load.atlas('enemies40', '/assets/enemies40_atlas.png','/assets/enemies40_atlas.json');
    this.load.atlas('enemies48', '/assets/enemies48_atlas.png','/assets/enemies48_atlas.json');
    this.load.atlas('enemies64', '/assets/enemies64_atlas.png','/assets/enemies64_atlas.json');
    this.load.atlas('projectiles','/assets/projectiles_atlas.png','/assets/projectiles_atlas.json');
    this.load.atlas('fx',        '/assets/effects_atlas.png', '/assets/effects_atlas.json');
  }

  create() {
    this.cameras.main.setBackgroundColor('#0b0b0f');

    // Dibuja 2 caminos simples de césped
    this.drawLane(LANE_Y);
    this.drawLane(LANE_Y2);

    // HUD básico
    this.add.image(24, 24, 'ui32', 'icon_gold').setScrollFactor(0).setDepth(1000).setOrigin(0, 0);
    this.goldText = this.add.text(64, 20, String(this.gold), { fontFamily: 'monospace', fontSize: '18px', color: '#ffd76a' })
      .setScrollFactor(0).setDepth(1000);

    this.uiTop = this.add.text(8, 54, '', { fontFamily: 'monospace', fontSize: '14px', color: '#9bd' })
      .setScrollFactor(0).setDepth(1000);

    this.tooltip = this.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '12px', color: '#e7f', backgroundColor: 'rgba(0,0,0,0.45)' })
      .setDepth(1100).setVisible(false);

    // Input: click para colocar torre
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const gx = Math.floor(p.worldX / TILE) * TILE + TILE / 2;
      const gy = Math.floor(p.worldY / TILE) * TILE + TILE / 2;

      // evita colocar en el camino (dos filas)
      if (Math.abs(gy - LANE_Y) < TILE / 2 || Math.abs(gy - LANE_Y2) < TILE / 2) return;

      // coste simple
      const cost = 45;
      if (this.gold < cost) return;

      // frame de torre
      const frame = TOWER_FRAMES[this.selectedFam][this.selectedTierIndex] ?? TOWER_FRAMES[this.selectedFam][0];
      const s = this.add.image(gx, gy, 'towers', frame).setDepth(500);
      const fam = this.selectedFam;
      const cfg = FAMILY[fam];

      const t: Tower = {
        fam,
        s,
        range: cfg.range,
        dmg: cfg.baseDamage,
        cdMs: cfg.cooldownMs,
        lastShot: 0
      };
      this.towers.push(t);
      this.gold -= cost;
      this.goldText.setText(String(this.gold));
    });

    // Hover UI para mostrar DPS/Range
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const mx = p.worldX, my = p.worldY;
      const over = this.towers.find(t => Phaser.Math.Distance.Between(mx, my, t.s.x, t.s.y) <= TILE / 2);
      if (over) {
        this.hoveredTower = over;
        if (!this.rangeCircle) {
          this.rangeCircle = this.add.circle(over.s.x, over.s.y, over.range, 0x33aaff, 0.12)
            .setStrokeStyle(2, 0x33aaff, 0.8)
            .setDepth(300);
        } else {
          this.rangeCircle.setPosition(over.s.x, over.s.y).setRadius(over.range).setVisible(true);
        }
        const dps = Math.round((1000 / over.cdMs) * over.dmg);
        this.tooltip.setText(` ${FAMILY[over.fam].name} \n Range ${over.range}  ·  DPS ${dps} `)
          .setPosition(over.s.x + 20, over.s.y - 10).setVisible(true);
      } else {
        this.hoveredTower = undefined;
        this.rangeCircle?.setVisible(false);
        this.tooltip.setVisible(false);
      }
    });

    // Teclado: 1–3 cambia familia. Flechas izquierda/derecha cambian skin (tier)
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (e.key === '1') this.selectedFam = 'electric';
      if (e.key === '2') this.selectedFam = 'fire';
      if (e.key === '3') this.selectedFam = 'frost';
      if (e.key === 'ArrowLeft')  this.selectedTierIndex = (this.selectedTierIndex + TOWER_FRAMES[this.selectedFam].length - 1) % TOWER_FRAMES[this.selectedFam].length;
      if (e.key === 'ArrowRight') this.selectedTierIndex = (this.selectedTierIndex + 1) % TOWER_FRAMES[this.selectedFam].length;
    });

    // UI info selección
    this.time.addEvent({
      delay: 100,
      loop: true,
      callback: () => {
        const fam = FAMILY[this.selectedFam];
        const frame = TOWER_FRAMES[this.selectedFam][this.selectedTierIndex];
        this.uiTop.setText(
          `Torre ${frame}  —  Coste: 45 oro  —  ${fam.name}\n` +
          `Rango ${fam.range}  ·  DPS ~${Math.round((1000 / fam.cooldownMs) * fam.baseDamage)}  ·  CD ${fam.cooldownMs}ms`
        );
      }
    });

    // Empezamos waves
    this.waveIndex = 0;
    this.scheduleNextWave();
  }

  drawLane(y: number) {
    for (let x = TILE / 2; x < W; x += TILE) {
      this.add.image(x, y, 'terrain64', 'Grass Path').setDepth(50);
    }
  }

  scheduleNextWave() {
    this.waveIndex++;
    const now = this.time.now;
    // dificultad simple: +enemigos y +vida con waves
    const count = 10 + this.waveIndex * 2;
    const hp = 28 + this.waveIndex * 8;
    const speed = 52 + this.waveIndex * 2;

    // alterna camino superior/inferior
    const y = (this.laneToggle++ % 2 === 0) ? LANE_Y : LANE_Y2;
    const path = this.makeStraightPath(y);

    // spawnea uno cada 600ms
    for (let i = 0; i < count; i++) {
      this.time.delayedCall(i * 600, () => this.spawnEnemy(path, hp, speed));
    }

    // programa la siguiente wave
    this.nextSpawnAt = now + count * 600 + 5000;
    this.time.delayedCall(count * 600 + 5000, () => this.scheduleNextWave());
  }

  makeStraightPath(y: number) {
    const pts: { x: number, y: number }[] = [];
    for (let x = -TILE; x < W + TILE; x += TILE) pts.push({ x: x + TILE / 2, y });
    return pts;
  }

  spawnEnemy(path: { x: number, y: number }[], hp: number, speed: number) {
    const s = this.add.image(path[0].x, path[0].y, 'enemies32', 'Goblin Scout').setDepth(200);
    const e: Enemy = { s, hp, max: hp, speed, path, idx: 0, alive: true };
    e.barBg = this.add.rectangle(s.x, s.y - 18, 28, 5, 0x000000, 0.45).setDepth(400);
    e.barFg = this.add.rectangle(s.x, s.y - 18, 28, 5, 0x66ff66, 0.9).setDepth(401).setOrigin(0, 0.5).setX(s.x - 14);
    this.enemies.push(e);
  }

  update(time: number, dtMs: number) {
    const dt = dtMs / 1000;

    // mover enemigos
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const speedMul = 1 - (e.slowPct && e.slowUntil && this.time.now < e.slowUntil ? e.slowPct : 0);
      const spd = e.speed * speedMul;
      const tgt = e.path[Math.min(e.idx + 1, e.path.length - 1)];
      const dx = tgt.x - e.s.x, dy = tgt.y - e.s.y;
      const d = Math.hypot(dx, dy);
      if (d < 2) {
        if (e.idx < e.path.length - 2) e.idx++;
        else { // llegó al final
          e.alive = false;
          e.s.destroy(); e.barBg?.destroy(); e.barFg?.destroy();
          continue;
        }
      } else {
        const nx = (dx / d) * spd * dt;
        const ny = (dy / d) * spd * dt;
        e.s.x += nx; e.s.y += ny;
        e.barBg?.setPosition(e.s.x, e.s.y - 18);
        e.barFg?.setPosition(e.s.x - 14, e.s.y - 18);
      }

      // DoT burn/poison
      if (e.burnDps && e.burnUntil && this.time.now < e.burnUntil) {
        e.hp -= e.burnDps * dt;
      }
      if (e.poisonDps && e.poisonUntil && this.time.now < e.poisonUntil) {
        e.hp -= e.poisonDps * dt;
      }
      if (e.hp <= 0 && e.alive) {
        e.alive = false; e.s.destroy(); e.barBg?.destroy(); e.barFg?.destroy();
        this.gold += 4 + Math.floor(this.waveIndex / 2);
        this.goldText.setText(String(this.gold));
      } else {
        this.updateHpBar(e);
      }
    }

    // disparo torres
    for (const t of this.towers) {
      if (time - t.lastShot < t.cdMs) continue;
      const target = this.getNearestEnemy(t.s.x, t.s.y, t.range);
      if (!target) continue;
      t.lastShot = time;
      this.shoot(t, target);
    }

    // mover proyectiles
    for (const b of this.bullets) {
      b.s.x += b.vx * dt;
      b.s.y += b.vy * dt;
      if (b.target && b.target.alive && Phaser.Math.Distance.Between(b.s.x, b.s.y, b.target.s.x, b.target.s.y) < 14) {
        this.hit(b.target, b.s.x, b.s.y, b.fam, b.dmg, /*allowChain=*/true);
        b.s.destroy();
        b.target = null as any;
      }
      // fuera de límites
      if (b.s.x < -50 || b.s.x > W + 50 || b.s.y < -50 || b.s.y > H + 50) {
        b.s.destroy();
      }
    }
    // limpia proyectiles destruidos
    this.bullets = this.bullets.filter(b => b.s.active);
  }

  updateHpBar(e: Enemy) {
    const pct = Math.max(0, e.hp / e.max);
    if (e.barFg) e.barFg.width = 28 * pct;
    if (e.barFg) e.barFg.fillColor = pct > 0.5 ? 0x66ff66 : pct > 0.25 ? 0xffe066 : 0xff6666;
  }

  getNearestEnemy(x: number, y: number, range: number): Enemy | null {
    let best: Enemy | null = null, bd = Infinity;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = Phaser.Math.Distance.Between(x, y, e.s.x, e.s.y);
      if (d <= range && d < bd) { bd = d; best = e; }
    }
    return best;
  }

  shoot(t: Tower, target: Enemy) {
    const fam = t.fam;
    const proj = FAMILY[fam].projectile;
    const angle = Phaser.Math.Angle.Between(t.s.x, t.s.y, target.s.x, target.s.y);
    const spd = 520;
    const vx = Math.cos(angle) * spd;
    const vy = Math.sin(angle) * spd;
    const s = this.add.image(t.s.x, t.s.y, 'projectiles', proj).setDepth(800);
    this.bullets.push({ s, vx, vy, fam, dmg: t.dmg, target });
  }

  /** Impacto + estados + fx + (opcional) encadenado */
  hit(
    target: Enemy,
    x: number,
    y: number,
    fam: FamKey,
    baseDmg: number,
    allowChain: boolean = true     // ⬅️ evita recursión en rebotes
  ) {
    if (!target.alive) return;
    let dmg = baseDmg;

    const eff = FAMILY[fam].effects;
    if (eff?.critChance && Math.random() < eff.critChance) {
      dmg = Math.round(dmg * (eff.critMul ?? 2.0));
      this.flashText('CRIT!', x, y - 6, '#ffd76a');
    }

    target.hp -= dmg;

    // estados
    if (eff?.slowPct && eff?.slowMs)   { target.slowPct = Math.max(target.slowPct ?? 0, eff.slowPct); target.slowUntil   = this.time.now + eff.slowMs; }
    if (eff?.burnDps && eff?.burnMs)   { target.burnDps = eff.burnDps;   target.burnUntil   = this.time.now + eff.burnMs; }
    if (eff?.poisonDps && eff?.poisonMs) { target.poisonDps = eff.poisonDps; target.poisonUntil = this.time.now + eff.poisonMs; }

    const fx = this.add.image(x, y, 'fx', FAMILY[fam].fx).setDepth(900);
    this.time.delayedCall(120, () => fx.destroy());

    // ⚡ chain lightning: solo en el PRIMER impacto
    if (allowChain && eff?.chain && target.alive) {
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

  /** Rebotes del rayo: sin re-encadenar (no recursión) */
  chainLightning(
    x: number,
    y: number,
    first: Enemy,
    fam: FamKey,
    baseDmg: number,
    cfg: { jumps: number; radius: number; falloff: number[] }
  ) {
    const candidates = this.enemies
      .filter(e => e.alive && e !== first && Math.hypot(e.s.x - x, e.s.y - y) <= cfg.radius)
      .sort((a, b) => Math.hypot(a.s.x - x, a.s.y - y) - Math.hypot(b.s.x - x, b.s.y - y));

    const jumps = Math.min(cfg.jumps, candidates.length);
    for (let j = 0; j < jumps; j++) {
      const e = candidates[j];
      const mul = cfg.falloff[j] ?? 0.5;
      const dmg = Math.max(1, Math.round(baseDmg * mul));

      // rayo visual
      const g = this.add.graphics().setDepth(950);
      g.lineStyle(2, 0xffffaa, 0.8);
      g.beginPath(); g.moveTo(x, y); g.lineTo(e.s.x, e.s.y); g.strokePath();
      this.time.delayedCall(100, () => g.destroy());

      // rebote sin permitir más encadenado
      this.hit(e, e.s.x, e.s.y, fam, dmg, /*allowChain=*/false);
    }
  }

  flashText(text: string, x: number, y: number, color = '#fff') {
    const t = this.add.text(x, y, text, { fontFamily: 'monospace', fontSize: '12px', color })
      .setDepth(1000).setOrigin(0.5, 1);
    this.tweens.add({ targets: t, y: y - 12, alpha: 0, duration: 500, onComplete: () => t.destroy() });
  }
}

export default function BattlePage() {
  const ref = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!ref.current || gameRef.current) return;

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      width: W,
      height: H,
      parent: ref.current,
      backgroundColor: '#0b0b0f',
      scene: [TD],
      physics: { default: 'arcade' },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }
    };
    gameRef.current = new Phaser.Game(config);

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return (
    <div style={{ padding: 12 }}>
      <h2 style={{ fontFamily: 'monospace', margin: '6px 0' }}>Fluent Tower Defense — MVP</h2>
      <div style={{ fontFamily: 'monospace', fontSize: 13, opacity: 0.8, marginBottom: 8 }}>
        Click para colocar · 1=⚡ Electric / 2=🔥 Fire / 3=❄️ Frost · ←/→ cambia skin ·
        pasa el mouse sobre una torre para ver <b>DPS/Range</b>
      </div>
      <div ref={ref} />
      {!mounted && <p style={{ fontFamily: 'monospace' }}>Cargando…</p>}
    </div>
  );
}
