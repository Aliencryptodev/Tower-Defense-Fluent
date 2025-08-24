// app/battle/page.tsx
'use client';

import dynamicImport from 'next/dynamic';

// Fuerza render dinámico (sin SSG/ISR) y sin cache
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Renderiza el juego solo en cliente (sin SSR)
const BattleClient = dynamicImport(() => import('./BattleClient'), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 12, color: '#a9b7ff', fontFamily: 'monospace' }}>
      Cargando el motor de juego…
    </div>
  ),
});

export default function Page() {
  return <BattleClient />;
}
