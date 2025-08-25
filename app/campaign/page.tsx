'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

type RaceKey = 'human' | 'sliver' | 'alien';

type RaceInfo = {
  key: RaceKey;
  name: string;
  title: string;
  description: string;
  color: string;
  borderColor: string;
  glowColor: string;
};

const RACES: RaceInfo[] = [
  {
    key: 'human',
    name: 'Human',
    title: 'Terran Campaign',
    description: 'Masters of technology and warfare. Deploy bunkers, missiles, and automated defenses.',
    color: '#4a9eff',
    borderColor: '#2d5aa0',
    glowColor: '#4a9eff40'
  },
  {
    key: 'sliver',
    name: 'Sliver', 
    title: 'Zerg Campaign',
    description: 'Biological swarm creatures. Use living towers that grow and evolve over time.',
    color: '#b455ff',
    borderColor: '#7a3db3',
    glowColor: '#b455ff40'
  },
  {
    key: 'alien',
    name: 'Alien',
    title: 'Protoss Campaign', 
    description: 'Advanced psionic beings. Harness energy shields and devastating plasma weapons.',
    color: '#ffaa00',
    borderColor: '#cc7700',
    glowColor: '#ffaa0040'
  }
];

export default function RaceSelector() {
  const [selectedRace, setSelectedRace] = useState<RaceKey>('human');
  const [hoveredRace, setHoveredRace] = useState<RaceKey | null>(null);
  const router = useRouter();

  const handlePlayCampaign = () => {
    router.push(`/campaign/${selectedRace}`);
  };

  const handleCancel = () => {
    router.push('/');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black relative overflow-hidden">
      {/* Fondo con textura espacial */}
      <div className="absolute inset-0 opacity-20">
        <div className="absolute top-10 left-10 w-32 h-32 bg-blue-500 rounded-full blur-3xl opacity-30"></div>
        <div className="absolute bottom-20 right-20 w-48 h-48 bg-purple-500 rounded-full blur-3xl opacity-20"></div>
        <div className="absolute top-1/2 left-1/3 w-24 h-24 bg-yellow-500 rounded-full blur-2xl opacity-25"></div>
      </div>

      {/* Grid pattern overlay */}
      <div 
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px'
        }}
      ></div>

      {/* Título principal */}
      <div className="relative z-10 pt-16 pb-8">
        <h1 className="text-center text-4xl font-bold text-white tracking-wider">
          SELECT YOUR RACE
        </h1>
        <div className="mt-2 mx-auto w-32 h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-yellow-500"></div>
      </div>

      {/* Selector de razas */}
      <div className="relative z-10 flex flex-col items-center justify-center min-h-96 px-8">
        
        {/* Raza superior: Human */}
        <div className="mb-16">
          <RaceCard
            race={RACES[0]}
            isSelected={selectedRace === 'human'}
            isHovered={hoveredRace === 'human'}
            onClick={() => setSelectedRace('human')}
            onMouseEnter={() => setHoveredRace('human')}
            onMouseLeave={() => setHoveredRace(null)}
          />
        </div>

        {/* Razas inferiores: Sliver y Alien */}
        <div className="flex justify-center items-center gap-24">
          <RaceCard
            race={RACES[1]}
            isSelected={selectedRace === 'sliver'}
            isHovered={hoveredRace === 'sliver'}
            onClick={() => setSelectedRace('sliver')}
            onMouseEnter={() => setHoveredRace('sliver')}
            onMouseLeave={() => setHoveredRace(null)}
          />
          
          <RaceCard
            race={RACES[2]}
            isSelected={selectedRace === 'alien'}
            isHovered={hoveredRace === 'alien'}
            onClick={() => setSelectedRace('alien')}
            onMouseEnter={() => setHoveredRace('alien')}
            onMouseLeave={() => setHoveredRace(null)}
          />
        </div>
      </div>

      {/* Descripción de la raza seleccionada */}
      <div className="relative z-10 mt-12 px-8">
        {RACES.map(race => (
          <div
            key={race.key}
            className={`text-center transition-all duration-300 ${
              selectedRace === race.key ? 'opacity-100' : 'opacity-0 absolute inset-x-0'
            }`}
          >
            <h2 className="text-2xl font-semibold text-white mb-4">{race.title}</h2>
            <p className="text-gray-300 text-lg max-w-2xl mx-auto leading-relaxed">
              {race.description}
            </p>
          </div>
        ))}
      </div>

      {/* Botones de acción */}
      <div className="relative z-10 flex justify-center gap-8 mt-16 pb-16">
        <button
          onClick={handlePlayCampaign}
          className="px-8 py-4 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 
                     text-white font-semibold text-lg rounded-lg border-2 border-blue-400
                     shadow-lg shadow-blue-500/25 hover:shadow-blue-400/50 
                     transform hover:scale-105 transition-all duration-200
                     focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          PLAY CAMPAIGN
        </button>
        
        <button
          onClick={handleCancel}
          className="px-8 py-4 bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-500 hover:to-gray-600 
                     text-white font-semibold text-lg rounded-lg border-2 border-gray-400
                     shadow-lg shadow-gray-500/25 hover:shadow-gray-400/50 
                     transform hover:scale-105 transition-all duration-200
                     focus:outline-none focus:ring-2 focus:ring-gray-400"
        >
          CANCEL
        </button>
      </div>
    </div>
  );
}

// Componente individual para cada tarjeta de raza
function RaceCard({ 
  race, 
  isSelected, 
  isHovered, 
  onClick, 
  onMouseEnter, 
  onMouseLeave 
}: {
  race: RaceInfo;
  isSelected: boolean;
  isHovered: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  return (
    <div
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`
        relative w-48 h-48 cursor-pointer transition-all duration-300 transform
        ${isSelected ? 'scale-110' : 'scale-100'}
        ${isHovered ? 'scale-105' : ''}
      `}
    >
      {/* Marco exterior con glow */}
      <div 
        className={`
          absolute inset-0 rounded-lg transition-all duration-300
          ${isSelected ? 'shadow-lg' : 'shadow-md'}
        `}
        style={{
          backgroundColor: race.glowColor,
          boxShadow: isSelected 
            ? `0 0 30px ${race.color}80, 0 0 60px ${race.color}40`
            : `0 0 15px ${race.color}40`
        }}
      ></div>

      {/* Marco principal */}
      <div 
        className={`
          relative w-full h-full rounded-lg border-2 
          bg-gradient-to-br from-gray-800 to-gray-900
          flex flex-col items-center justify-center
          transition-all duration-300
        `}
        style={{
          borderColor: isSelected ? race.color : race.borderColor,
          backgroundImage: `linear-gradient(135deg, ${race.glowColor}, transparent 50%)`
        }}
      >
        {/* Ícono de la raza */}
        <div 
          className={`
            w-16 h-16 rounded-full mb-4 flex items-center justify-center
            text-2xl font-bold transition-all duration-300
          `}
          style={{
            backgroundColor: race.color + '20',
            color: race.color,
            border: `2px solid ${race.color}60`
          }}
        >
          {race.name.charAt(0).toUpperCase()}
        </div>

        {/* Nombre de la raza */}
        <h3 
          className="text-xl font-bold tracking-wider transition-colors duration-300"
          style={{ color: isSelected ? race.color : '#ffffff' }}
        >
          {race.name.toUpperCase()}
        </h3>

        {/* Indicador de selección */}
        {isSelected && (
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2">
            <div 
              className="w-3 h-3 rounded-full animate-pulse"
              style={{ backgroundColor: race.color }}
            ></div>
          </div>
        )}
      </div>

      {/* Efectos de esquinas */}
      <div className="absolute top-2 left-2 w-4 h-4 border-l-2 border-t-2 rounded-tl"
           style={{ borderColor: race.color }}></div>
      <div className="absolute top-2 right-2 w-4 h-4 border-r-2 border-t-2 rounded-tr"
           style={{ borderColor: race.color }}></div>
      <div className="absolute bottom-2 left-2 w-4 h-4 border-l-2 border-b-2 rounded-bl"
           style={{ borderColor: race.color }}></div>
      <div className="absolute bottom-2 right-2 w-4 h-4 border-r-2 border-b-2 rounded-br"
           style={{ borderColor: race.color }}></div>
    </div>
  );
}
