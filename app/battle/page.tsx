// Server Component: configura la ruta como 100% dinámica y sin caché
export const revalidate = false;
export const dynamic = 'force-dynamic';

import BattleClient from './BattleClient';

export default function Page() {
  return <BattleClient />;
}
