'use client';

import dynamic from 'next/dynamic';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';

const BattleClient = dynamic(() => import('./BattleClient'), { ssr: false });

function BattleContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const race = searchParams.get('race') as 'human' | 'sliver' | 'alien' | null;
  const level = searchParams.get('level');
  
  // Si no hay parámetros de campaña, usar valores por defecto (para testing)
  const gameConfig = {
    race: race || 'human',
    level: level ? parseInt(level) : 1,
    campaign: true
  };

  // Función para volver a la campaña
  const handleBackToCampaign = () => {
    if (race) {
      router.push(`/campaign/${race}`);
    } else {
      router.push('/campaign');
    }
  };

  return (
    <div className="w-full h-screen relative">
      {/* Botón para volver a la campaña */}
      {race && (
        <button
          onClick={handleBackToCampaign}
          className="absolute top-4 left-4 z-50 px-4 py-2 bg-gray-800 bg-opacity-80 
                     text-white rounded-lg border border-gray-600 hover:bg-gray-700 
                     transition-colors duration-200 flex items-center gap-2"
        >
          ← Back to Campaign
        </button>
      )}
      
      {/* Información del nivel actual */}
      {race && level && (
        <div className="absolute top-4 right-4 z-50 px-4 py-2 bg-gray-800 bg-opacity-80 
                        text-white rounded-lg border border-gray-600">
          <div className="text-sm font-medium">
            {race.charAt(0).toUpperCase() + race.slice(1)} Campaign - Level {level}
          </div>
        </div>
      )}
      
      <BattleClient gameConfig={gameConfig} />
    </div>
  );
}

export default function BattlePage() {
  return (
    <Suspense fallback={
      <div className="w-full h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading battle...</div>
      </div>
    }>
      <BattleContent />
    </Suspense>
  );
}
