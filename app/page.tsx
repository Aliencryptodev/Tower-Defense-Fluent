import Link from 'next/link';

// Actualizamos las razas a nuestro nuevo sistema
const races = [
  { key: 'human',  name: 'Human',  emoji: '🛡️', desc: 'Technology, missiles and mechs.' },
  { key: 'alien', name: 'Alien', emoji: '🔮', desc: 'Psionic energy and plasma.' },
  { key: 'sliver',    name: 'Sliver',    emoji: '🧬', desc: 'Biological swarm creatures.' },
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
    <main className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black text-white">
      <div className="max-w-6xl mx-auto p-6">
        
        {/* Header principal */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold tracking-wider mb-4">
            FLUENT TOWER DEFENSE
          </h1>
          <div className="w-48 h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-yellow-500 mx-auto"></div>
        </div>

        {/* Campaign Mode - Destacado */}
        <section className="mb-12">
          <div className="bg-gradient-to-r from-blue-900/30 via-purple-900/30 to-yellow-900/30 
                          rounded-3xl p-8 border border-gray-600 shadow-2xl">
            <div className="text-center">
              <h2 className="text-3xl font-bold mb-4">🏆 CAMPAIGN MODE</h2>
              <p className="text-lg text-gray-300 mb-6 max-w-2xl mx-auto">
                Experience the full story! Choose your race and battle through 10 challenging levels 
                with unique enemies and earn stars for perfect performance.
              </p>
              
              <Link 
                href="/campaign"
                className="inline-block px-12 py-4 bg-gradient-to-r from-blue-600 to-purple-600 
                           hover:from-blue-500 hover:to-purple-500 text-white font-bold text-xl 
                           rounded-xl shadow-lg shadow-blue-500/25 hover:shadow-blue-400/50 
                           transform hover:scale-105 transition-all duration-300 
                           border-2 border-blue-400"
              >
                START CAMPAIGN
              </Link>
            </div>
          </div>
        </section>

        {/* Quick Battle Mode */}
        <section>
          <div className="text-center mb-8">
            <h2 className="text-2xl font-semibold mb-2">⚡ QUICK BATTLE</h2>
            <p className="text-sm text-gray-400">
              Jump straight into action! Choose race, map and difficulty for instant battles.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {races.map((r) => (
              <div key={r.key} className="rounded-2xl p-6 bg-gray-800/50 border border-gray-600 shadow-lg backdrop-blur-sm">
                <div className="text-4xl mb-3">{r.emoji}</div>
                <div className="text-xl font-semibold mb-2">{r.name}</div>
                <div className="text-sm text-gray-300 mb-4">{r.desc}</div>
                
                <div className="text-xs text-gray-400 mb-3 uppercase tracking-wide">Available Maps</div>
                
                <div className="space-y-3">
                  {maps.map((m) => (
                    <div key={m.key} className="rounded-xl p-4 bg-gray-900/60 border border-gray-700">
                      <div className="font-medium text-sm mb-3 text-center">{m.name}</div>
                      <div className="grid grid-cols-3 gap-2">
                        {diffs.map((d) => (
                          <Link
                            key={d.key}
                            href={`/battle?race=${r.key}&map=${m.key}&diff=${d.key}`}
                            className="text-center text-xs rounded-lg px-3 py-2 
                                       bg-gray-800 border border-gray-600 
                                       hover:bg-gray-700 hover:border-gray-500 
                                       transition-all duration-200 
                                       hover:shadow-md hover:scale-105"
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
          </div>
        </section>

        {/* Footer info */}
        <div className="mt-12 text-center text-gray-500 text-sm">
          <p>Campaign Mode: Structured progression with story and unlockables</p>
          <p>Quick Battle: Instant action with custom settings</p>
        </div>
      </div>
    </main>
  );
}
