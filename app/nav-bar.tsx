'use client';

import { useRouter } from 'next/navigation';

export default function NavBar({ username }: { username: string | null }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <nav className="topnav">
      <div className="brand">📦 Carga de Inventario</div>
      {username && (
        <div className="nav-links">
          <a href="/upload">Nueva carga</a>
          <a href="/history">Historial</a>
          <a href="/feeds">Feeds</a>
          <a href="/stores">Tiendas</a>
          <span className="nav-user">👤 {username}</span>
          <button className="logout" onClick={handleLogout}>Salir</button>
        </div>
      )}
    </nav>
  );
}
