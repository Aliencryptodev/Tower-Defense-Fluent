// app/battle/page.tsx  (SERVER COMPONENT)
import NextDynamic from 'next/dynamic';

// Fuerza render dinámico (evita SSG/ISR)
export const dynamic = 'force-dynamic';
export const revalidate = false;

// Cargar el cliente de Phaser sólo en el navegador
const BattleClient = NextDynamic(() => import('./BattleClient'), { ssr: false });

export default function Page() {
  return <BattleClient />;
}
