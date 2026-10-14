import './globals.css';
import { getSession } from '@/lib/auth';
import NavBar from './nav-bar';

export const metadata = {
  title: 'Carga de Inventario',
  description: 'Sistema de carga de inventario por SKU para Shopify',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  return (
    <html lang="es">
      <body>
        <NavBar username={session?.username ?? null} />
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
