// app/battle/page.tsx
import nextDynamic from 'next/dynamic';

// Fuerza render dinámico (sin SSG/ISR) para esta ruta
export const dynamic = 'force-dynamic';
export const revalidate = false;

// Carga del cliente (sin SSR) para Phaser
const BattleClient = nextDynamic(() => import('./BattleClient'), { ssr: false });

export default function Page() {
  return <BattleClient />;
}
