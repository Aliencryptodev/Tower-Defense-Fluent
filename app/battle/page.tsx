// app/battle/page.tsx

import NextDynamic from 'next/dynamic';

// Fuerza render dinámico y sin caché/ISR para este segmento
export const dynamic = 'force-dynamic';
export const revalidate = false;

// Renderiza el juego SOLO en cliente (sin SSR)
const BattleClient = NextDynamic(() => import('./BattleClient'), { ssr: false });

export default function Page() {
  return <BattleClient />;
}
