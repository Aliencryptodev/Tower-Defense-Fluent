export const metadata = {
  title: "Fluent Tower Defense",
  description: "MVP sprites + atlas test"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body style={{margin:0, background:'#0b0b0b', color:'#eaeaea', fontFamily:'system-ui, sans-serif'}}>
        {children}
      </body>
    </html>
  );
}
