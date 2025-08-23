// app/battle/page.tsx
'use client';

import NextDynamic from 'next/dynamic';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const BattleClient = NextDynamic(() => import('./BattleClient'), { ssr: false });

export default function Page() {
  return <BattleClient />;
}
