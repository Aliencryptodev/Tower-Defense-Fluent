// app/battle/page.tsx (Server Component)
export const dynamic = 'force-dynamic';
export const revalidate = false;

import dynamicImport from 'next/dynamic';
const BattleClient = dynamicImport(() => import('./BattleClient'), { ssr: false });

export default function Page() {
  return <BattleClient />;
}
