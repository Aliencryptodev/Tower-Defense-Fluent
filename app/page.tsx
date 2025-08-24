// app/page.tsx
import Link from 'next/link';

const races = [
  { key: 'terran',  name: 'Terran',  emoji: '🛡️', desc: 'Balas, misiles y mechs.' },
  { key: 'protoss', name: 'Protoss', emoji: '🔮', desc: 'Energía psiónica y escudos.' },
  { key: 'zerg',    name: 'Zerg',    emoji: '🧬', desc: 'Biomasa y enjambre.' },
];

const maps = [
  { key: 'grass_dual', name: 'Grass Dual' },
  { key: 'desert_snake', name: 'Desert Snake' },
];

const diffs = [
  { key: 'easy', name: 'Easy' },
  { key: 'normal', name: 'Normal' },
  { key: 'hard', name: 'Hard' },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#0c0e12] text-white">
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-4">Fluent Tower Defense — Selector</h1>
        <p className="text-sm text-[#b7c7ff] mb-6">
          Elige <b>Raza</b>, <b>Mapa</b> y <b>Dificultad</b>. (Temas/HUD StarCraft-like vendrán por raza)
        </p>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {races.map((r) => (
            <div key={r.key} className="rounded-2xl p-4 bg-[#131823] border border-[#22304a] shadow">
              <div className="text-3xl">{r.emoji}</div>
              <div className="text-lg font-semibold mt-2">{r.name}</div>
              <div className="text-xs text-[#a9b7ff] mt-1">{r.desc}</div>
              <div className="mt-3 text-xs text-[#94a3b8]">Mapas</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {maps.map((m) => (
                  <div key={m.key} className="rounded-xl p-3 bg-[#0f141f] border border-[#1e2a40]">
                    <div className="font-medium text-sm">{m.name}</div>
                    <div className="mt-2 grid grid-cols-3 gap-1">
                      {diffs.map((d) => (
                        <Link
                          key={d.key}
                          href={`/battle?race=${r.key}&map=${m.key}&diff=${d.key}`}
                          className="text-center text-[11px] rounded-lg px-2 py-1 bg-[#182132] border border-[#24324c] hover:bg-[#1b2740] transition"
                        >
                          {d.name}
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
