'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useParams } from 'next/navigation';

type RaceKey = 'human' | 'sliver' | 'alien';

type LevelData = {
  id: number;
  name: string;
  stars: number; // 0-3 estrellas ganadas
  unlocked: boolean;
  completed: boolean;
};

type RaceConfig = {
  key: RaceKey;
  name: string;
  title: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    bg: string;
    glow: string;
  };
};

const RACE_CONFIGS: Record<RaceKey, RaceConfig> = {
  human: {
    key: 'human',
    name: 'Human',
    title: 'Terran Campaign',
    colors: {
      primary: '#4a9eff',
      secondary: '#2d5aa0', 
      accent: '#87ceeb',
      bg: 'from-blue-900 via-slate-900 to-gray-900',
      glow: '#4a9eff40'
    }
  },
  sliver: {
    key: 'sliver',
    name: 'Sliver',
    title: 'Zerg Campaign',
    colors: {
      primary: '#b455ff',
      secondary: '#7a3db3',
      accent: '#da70d6',
      bg: 'from-purple-900 via-slate-900 to-gray-900',
      glow: '#b455ff40'
    }
  },
  alien: {
    key: 'alien',
    name: 'Alien', 
    title: 'Protoss Campaign',
    colors: {
      primary: '#ffaa00',
      secondary: '#cc7700',
      accent: '#ffd700',
      bg: 'from-yellow-900 via-slate-900 to-gray-900',
      glow: '#ffaa0040'
    }
  }
};

// Por ahora, datos mock - luego vendrá de localStorage/backend
const generateLevels = (): LevelData[] => {
  return Array.from({ length: 10 }, (_, index) => ({
    id: index + 1,
    name: `Level ${index + 1}`,
    stars: index === 0 ? 3 : index === 1 ? 2 : index === 2 ? 1 : 0, // Mock: primeros niveles completados
    unlocked: index <= 2, // Mock: primeros 3 niveles desbloqueados
    completed: index <= 2
  }));
};

export default function CampaignRacePage() {
  const router = useRouter();
  const params = useParams();
  const raceKey = params.race as RaceKey;
  
  const race = RACE_CONFIGS[raceKey];
  const levels = generateLevels();

  if (!race) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Race not found</div>
      </div>
    );
  }

  const handleLevelClick = (level: LevelData) => {
    if (!level.unlocked) return;
    
    router.push(`/battle?race=${raceKey}&level=${level.id}`);
  };

  const handleBackToRaceSelector = () => {
    router.push('/campaign');
  };

  return (
    <div className={`min-h-screen bg-gradient-to-br ${race.colors.bg} relative overflow-hidden`}>
      {/* Efectos de fondo */}
      <div className="absolute inset-0 opacity-20">
        <div 
          className="absolute top-10 right-10 w-32 h-32 rounded-full blur-3xl opacity-40"
          style={{ backgroundColor: race.colors.primary }}
        ></div>
        <div 
          className="absolute bottom-20 left-20 w-48 h-48 rounded-full blur-3xl opacity-30"
          style={{ backgroundColor: race.colors.accent }}
        ></div>
      </div>

      {/* Header */}
      <div className="relative z-10 pt-8 pb-4">
        <div className="flex items-center justify-between px-8">
          <button
            onClick={handleBackToRaceSelector}
            className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg 
                       border border-gray-500 transition-colors duration-200 flex items-center gap-2"
          >
            ← Back to Races
          </button>
          
          <div className="text-center">
            <h1 className="text-4xl font-bold text-white tracking-wider">
              {race.title}
            </h1>
            <div 
              className="mt-2 mx-auto w-32 h-1 rounded-full"
              style={{ backgroundColor: race.colors.primary }}
            ></div>
          </div>
          
          <div className="w-32"> {/* Spacer for centering */}</div>
        </div>
      </div>

      {/* Mapa de niveles */}
      <div className="relative z-10 flex-1 px-8 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Grid de niveles */}
          <div className="grid grid-cols-5 gap-8">
            {levels.map((level) => (
              <LevelNode
                key={level.id}
                level={level}
                raceColors={race.colors}
                onClick={() => handleLevelClick(level)}
              />
            ))}
          </div>
          
          {/* Información adicional */}
          <div className="mt-12 text-center">
            <div className="bg-black bg-opacity-30 rounded-lg p-6 max-w-2xl mx-auto border"
                 style={{ borderColor: race.colors.primary + '40' }}>
              <h3 className="text-xl font-semibold text-white mb-4">Campaign Progress</h3>
              <div className="flex justify-center gap-8 text-white">
                <div>
                  <div className="text-2xl font-bold" style={{ color: race.colors.primary }}>
                    {levels.filter(l => l.completed).length}
                  </div>
                  <div className="text-sm text-gray-300">Levels Completed</div>
                </div>
                <div>
                  <div className="text-2xl font-bold" style={{ color: race.colors.accent }}>
                    {levels.reduce((total, l) => total + l.stars, 0)}
                  </div>
                  <div className="text-sm text-gray-300">Stars Earned</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-yellow-400">
                    {levels.filter(l => l.stars === 3).length}
                  </div>
                  <div className="text-sm text-gray-300">Perfect Scores</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Componente para cada nodo de nivel
function LevelNode({ 
  level, 
  raceColors, 
  onClick 
}: {
  level: LevelData;
  raceColors: RaceConfig['colors'];
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col items-center">
      {/* Nodo del nivel */}
      <div
        onClick={onClick}
        className={`
          relative w-24 h-24 rounded-full border-4 cursor-pointer
          flex items-center justify-center text-white font-bold text-lg
          transition-all duration-300 transform hover:scale-110
          ${level.unlocked 
            ? 'hover:shadow-lg' 
            : 'opacity-50 cursor-not-allowed'
          }
        `}
        style={{
          backgroundColor: level.completed ? raceColors.primary : '#374151',
          borderColor: level.unlocked ? raceColors.primary : '#6b7280',
          boxShadow: level.completed 
            ? `0 0 20px ${raceColors.glow}` 
            : level.unlocked 
              ? `0 0 10px ${raceColors.glow}` 
              : 'none'
        }}
      >
        {level.id}
        
        {/* Indicador de bloqueo */}
        {!level.unlocked && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-800 bg-opacity-80 rounded-full">
            <div className="text-gray-400 text-2xl">🔒</div>
          </div>
        )}
      </div>
      
      {/* Nombre del nivel */}
      <div className="mt-2 text-white text-sm font-medium">
        {level.name}
      </div>
      
      {/* Estrellas */}
      <div className="flex gap-1 mt-1">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className={`w-4 h-4 text-xs flex items-center justify-center ${
              index < level.stars ? 'text-yellow-400' : 'text-gray-500'
            }`}
          >
            ⭐
          </div>
        ))}
      </div>
      
      {/* Línea de conexión al siguiente nivel */}
      {level.id < 10 && (
        <div 
          className="w-1 h-8 mt-2 rounded-full"
          style={{ 
            backgroundColor: level.completed ? raceColors.primary + '60' : '#374151' 
          }}
        ></div>
      )}
    </div>
  );
}
