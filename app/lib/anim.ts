'use client';

export function listExistingFrames(scene: Phaser.Scene, atlasKey: string, prefix: string, maxCheck = 32): string[] {
  // @ts-ignore
  const tex = scene.textures.get(atlasKey);
  const frames: string[] = [];
  for (let i = 1; i <= maxCheck; i++) {
    const key = `${prefix}_${i}`;
    // @ts-ignore
    if (tex && tex.has && tex.has(key)) frames.push(key); else if (i === 1) return []; else break;
  }
  return frames;
}

export function registerAnimIfAny(
  scene: Phaser.Scene,
  opts: { atlas: string; key: string; prefix: string; fps?: number; repeat?: number; fallbackFrame?: string }
) {
  const frames = listExistingFrames(scene, opts.atlas, opts.prefix);
  if (frames.length > 0) {
    scene.anims.create({
      key: opts.key,
      frames: frames.map((name) => ({ key: opts.atlas, frame: name })),
      frameRate: opts.fps ?? 12,
      repeat: opts.repeat ?? -1,
    });
    return true;
  } else if (opts.fallbackFrame) {
    scene.anims.create({
      key: opts.key,
      frames: [{ key: opts.atlas, frame: opts.fallbackFrame }],
      frameRate: 1,
      repeat: -1,
    });
    return true;
  }
  return false;
}
