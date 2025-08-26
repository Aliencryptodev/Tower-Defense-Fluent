// app/lib/anim.ts

export type AnimCfg = {
  atlas: string;        // nombre del atlas cargado en Phaser (load.atlas key)
  key: string;          // nombre de la anim en el anims manager
  prefix: string;       // prefijo de frames (ej: 'goblin_walk' => goblin_walk_1,2,...)
  fallbackFrame: string;// frame de respaldo si no hay secuencia
  fps?: number;         // frameRate
  repeat?: number;      // -1 loop, 0 no-loop
};

/**
 * Crea la animación si no existe. Busca frames que empiecen por `prefix`
 * en el atlas, los ordena por sufijo numérico y crea la animación.
 * Tipado laxo para evitar problemas de TS en SSR/dynamic import.
 */
export function registerAnimIfAny(scene: any, cfg: AnimCfg) {
  if (!scene || !scene.anims) return;

  const fps = cfg.fps ?? 10;
  const repeat = cfg.repeat ?? -1;

  if (scene.anims.exists(cfg.key)) return;

  const tex = scene.textures?.get?.(cfg.atlas);
  let frameNames: string[] = [];

  // Detecta frames del atlas que empiezan por el prefijo
  if (tex && tex.getFrameNames) {
    try {
      const names: string[] = tex.getFrameNames();
      frameNames = names.filter(n => n.startsWith(cfg.prefix));
      // Ordena por sufijo numérico si existe (p.ej. foo_1, foo_2, ...)
      frameNames.sort((a, b) => {
        const na = parseInt(a.replace(/^\D+/g, ''), 10) || 0;
        const nb = parseInt(b.replace(/^\D+/g, ''), 10) || 0;
        return na - nb;
      });
    } catch {}
  }

  if (frameNames.length === 0) {
    // Animación “fija” con un único frame
    scene.anims.create({
      key: cfg.key,
      frames: [{ key: cfg.atlas, frame: cfg.fallbackFrame }],
      frameRate: fps,
      repeat
    });
    return;
  }

  scene.anims.create({
    key: cfg.key,
    frames: frameNames.map(f => ({ key: cfg.atlas, frame: f })),
    frameRate: fps,
    repeat
  });
}
