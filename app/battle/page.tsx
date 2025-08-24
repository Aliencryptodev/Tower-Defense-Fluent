import nextDynamic from 'next/dynamic';

// Fuerza render dinámico (sin SSG/ISR ni caché)
export const dynamic = 'force-dynamic';
export const revalidate = false;

const BattleClient = nextDynamic(() => import('./BattleClient'), { ssr: false });

export default function Page() {
  return <BattleClient />;
}
