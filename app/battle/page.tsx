'use client';

import dynamic from 'next/dynamic';

// Renderiza el juego solo en el cliente (sin SSR)
const BattleClient = dynamic(() => import('./BattleClient'), { ssr: false });

export const dynamic = 'force-dynamic';
export const revalidate = false;

export default function Page() {
  return <BattleClient />;
}
