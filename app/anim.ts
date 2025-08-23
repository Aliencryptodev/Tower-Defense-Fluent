// app/anim.ts
// Helpers de animación sin tipos Phaser (compatibles con Vercel/SSR)

export type SceneLike = {
  textures?: any;
  anims?: any;
};

export function listExistingFrames(
  scene: SceneLike,
  atlasKey: string,
  prefix: string,
  maxCheck = 32
): string[] {
  const out: string[] = [];
  const tex = scene?.textures?.get?.(atlasKey);
  for (let i = 1; i <= maxCheck; i++) {
    const f = `${prefix}_${i}`;
    if (tex?.has?.(f) || tex?.frames?.[f]) out.push(f);
    else break;
  }
  return out;
}

type AnimDef = {
  atlas: string;
  key: string;
  prefix: string;
  fallbackFrame: string;
  fps?: number;
  repeat?: number;
};

export function registerAnimIfAny(scene: SceneLike, def: AnimDef): void {
  if (!scene?.anims) return;
  if (scene.anims.exists?.(def.key)) return;

  const frames = listExistingFrames(scene, def.atlas, def.prefix, 48);

  if (frames.length > 1) {
    scene.anims.create?.({
      key: def.key,
      frames: frames.map((frame: string) => ({ key: def.atlas, frame })),
      frameRate: def.fps ?? 12,
      repeat: def.repeat ?? -1,
    });
  } else {
    // Fallback a 1 frame (por si no hay secuencia)
    scene.anims.create?.({
      key: def.key,
      frames: [{ key: def.atlas, frame: def.fallbackFrame }],
      frameRate: 1,
      repeat: -1,
    });
  }
}
