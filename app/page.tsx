import Link from "next/link";

export default function Home() {
  return (
    <main style={{padding:24}}>
      <h1>Fluent Tower Defense</h1>
      <ul>
        <li><Link href="/battle">/battle</Link> — escena de prueba</li>
        <li><Link href="/battle/assets">/battle/assets</Link> — diagnóstico de atlases</li>
      </ul>
    </main>
  );
}
