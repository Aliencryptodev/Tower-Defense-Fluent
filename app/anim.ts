// app/anim.ts
// Helpers de animaciones sin tipos de Phaser (SSR-safe)

export function listExistingFrames(
  scene: any,
  atlasKey: string,
  prefix: string,
  maxCheck = 32
): string[] {
  try {
    const tex = scene?.textures?.get?.(atlasKey);
    if (!tex) return [];

    const out: string[] = [];
    for (let i = 1; i <= maxCheck; i++) {
      const name = `${prefix}_${i}`;
      const has = typeof tex.hasFrame === 'function'
        ? tex.hasFrame(name)
        : typeof tex.getFrame === 'function'
          ? !!tex.getFrame(name)
          : false;

      if (has) out.push(name);
      else break; // paramos al primer hueco
    }
    return out;
  } catch {
    return [];
  }
}

type RegOpts = {
  atlas: string;
  key: string;
  prefix: string;
  fallbackFrame: string;
  fps?: number;
  repeat?: number;
};

/**
 * Crea la animación si existen frames con el prefijo dado.
 * Si no hay frames, registra una anim de 1 frame (fallback) para que play() no falle.
 */
export function registerAnimIfAny(
  scene: any,
  { atlas, key, prefix, fallbackFrame, fps = 12, repeat = -1 }: RegOpts
) {
  const frames = listExistingFrames(scene, atlas, prefix, 40);

  if (frames.length === 0) {
    if (!scene?.anims?.exists?.(key)) {
      scene.anims.create({
        key,
        frames: [{ key: atlas, frame: fallbackFrame }],
        frameRate: 1,
        repeat: 0,
      });
    }
    return;
  }

  if (!scene?.anims?.exists?.(key)) {
    scene.anims.create({
      key,
      frames: frames.map((f: string) => ({ key: atlas, frame: f })),
      frameRate: fps,
      repeat,
    });
  }
}
