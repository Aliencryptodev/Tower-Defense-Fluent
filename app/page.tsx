// app/page.tsx  (Server Component)
import Link from "next/link";

const MAPS: { id: string; name: string; desc: string; preview?: string }[] = [
  { id: "grass_dual", name: "Grass — Dual Lanes", desc: "Dos carriles, ritmo alto." },
  // Si tienes más mapas en /public/maps/<id>.json, añádelos aquí:
  // { id: "desert_cross", name: "Desert — Cross", desc: "Cruces y atajos." },
  // { id: "ice_spiral", name: "Ice — Spiral", desc: "Espiral de sufrimiento." },
];

const DIFFS: { id: "easy"|"normal"|"hard"|"insane"; label: string; hint: string }[] = [
  { id: "easy",   label: "Easy",   hint: "Para calentar motores" },
  { id: "normal", label: "Normal", hint: "Experiencia base" },
  { id: "hard",   label: "Hard",   hint: "Más vida y velocidad" },
  { id: "insane", label: "Insane", hint: "Sólo para valientes" },
];

export default function Home() {
  return (
    <main style={{padding: "24px", fontFamily: "Inter, system-ui, sans-serif"}}>
      <h1 style={{color:"#e8f4ff", fontWeight:700, margin:"0 0 8px"}}>Fluent Tower Defense</h1>
      <p style={{color:"#a9b7ff", margin:0}}>Elige un mapa y dificultad</p>

      <div style={{
        display:"grid",
        gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",
        gap:16, marginTop:20
      }}>
        {MAPS.map(m => (
          <div key={m.id} style={{
            background:"linear-gradient(145deg,#141823,#0c0e12)",
            border:"1px solid #1b2235",
            borderRadius:16,
            padding:16,
            boxShadow:"0 4px 16px rgba(0,0,0,.35)"
          }}>
            <div style={{
              height:140,
              borderRadius:12,
              marginBottom:12,
              background: "radial-gradient(80% 80% at 50% 60%, #22304a 0%, #10141f 100%)",
              border:"1px solid #202a3f",
              display:"flex", alignItems:"center", justifyContent:"center",
              color:"#9ab4ff", fontWeight:600
            }}>
              {m.preview ? (
                // si más adelante pones una imagen en /public/previews/<id>.png
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.preview} alt={m.name} style={{width:"100%", height:"100%", objectFit:"cover", borderRadius:12}}/>
              ) : (
                <span>{m.name}</span>
              )}
            </div>
            <div style={{color:"#cfe0ff", fontWeight:600, marginBottom:4}}>{m.name}</div>
            <div style={{color:"#91a0bf", fontSize:13, marginBottom:12}}>{m.desc}</div>

            <div style={{display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8}}>
              {DIFFS.map(d => (
                <Link
                  key={d.id}
                  href={`/battle?map=${encodeURIComponent(m.id)}&diff=${d.id}`}
                  style={{
                    textDecoration:"none",
                    background:"#1a2236",
                    border:"1px solid #273150",
                    borderRadius:10,
                    padding:"8px 10px",
                    textAlign:"center",
                    color:"#cde0ff",
                    fontSize:12
                  }}
                >
                  {d.label}
                </Link>
              ))}
            </div>
            <div style={{color:"#6f7ba0", fontSize:12, marginTop:8}}>
              Consejo: puedes cambiar el mapa/dificultad desde la URL.
            </div>
          </div>
        ))}
      </div>

      <div style={{marginTop:28}}>
        <Link href="/editor" style={{color:"#7adfff", textDecoration:"underline"}}>
          Abrir Editor de Mapas JSON
        </Link>
      </div>
    </main>
  );
}
