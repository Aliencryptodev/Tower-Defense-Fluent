'use client';

import nextDynamic from 'next/dynamic';

// Fuerza render dinámico y sin caché/ISR
export const dynamic = 'force-dynamic';
export const revalidate = false;

// Renderiza el juego solo en cliente (sin SSR)
const BattleClient = nextDynamic(() => import('./BattleClient'), { ssr: false });

export default function Page() {
  return <BattleClient />;
}
