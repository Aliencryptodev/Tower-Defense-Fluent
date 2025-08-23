// app/battle/page.tsx
import dynamic from 'next/dynamic';

// Fuerza render dinámico. Con esto ya no se intenta SSG/ISR.
export const dynamic = 'force-dynamic';
// (opcional, explícito) desactiva revalidate/caching en este segmento
export const revalidate = false;

// Carga el componente cliente que crea el juego Phaser
const BattleClient = dynamic(() => import('./BattleClient'), { ssr: false });

export default function Page() {
  return <BattleClient />;
}
