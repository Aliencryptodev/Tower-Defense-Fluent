// app/battle/page.tsx
'use client';

import dynamic from 'next/dynamic';

// Fuerza render dinámico (sin SSG/ISR)
export const dynamic = 'force-dynamic';
export const revalidate = false;

// Renderiza el juego solo en cliente (sin SSR)
const BattleClient = dynamic(() => import('./BattleClient'), { ssr: false });

export default function Page() {
  return <BattleClient />;
}
