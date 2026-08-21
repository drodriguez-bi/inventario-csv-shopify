'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/setup')
      .then((r) => r.json())
      .then((d) => {
        setNeedsSetup(!!d.needsSetup);
        setChecking(false);
      })
      .catch(() => setChecking(false));
  }, []);

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== password2) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setLoading(true);
    const res = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    setLoading(false);
    if (!data.ok) {
      setError(data.error || 'Error al crear el usuario.');
      return;
    }
    setNeedsSetup(false);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    setLoading(false);
    if (!data.ok) {
      setError(data.error || 'Error al iniciar sesión.');
      return;
    }
    router.push('/upload');
    router.refresh();
  }

  if (checking) {
    return <div className="card auth-card">Cargando...</div>;
  }

  if (needsSetup) {
    return (
      <div className="card auth-card">
        <h1>Crear usuario administrador</h1>
        <p className="muted">Este formulario solo aparece una vez, para crear el primer usuario del sistema.</p>
        {error && <p className="alert alert-error">{error}</p>}
        <form onSubmit={handleSetup}>
          <label>
            Usuario
            <input value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          <label>
            Contraseña
            <input type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <label>
            Confirmar contraseña
            <input type="password" minLength={8} value={password2} onChange={(e) => setPassword2(e.target.value)} required />
          </label>
          <button type="submit" disabled={loading}>{loading ? 'Creando...' : 'Crear usuario'}</button>
        </form>
      </div>
    );
  }

  return (
    <div className="card auth-card">
      <h1>Iniciar sesión</h1>
      {error && <p className="alert alert-error">{error}</p>}
      <form onSubmit={handleLogin}>
        <label>
          Usuario
          <input value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        </label>
        <label>
          Contraseña
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button type="submit" disabled={loading}>{loading ? 'Entrando...' : 'Entrar'}</button>
      </form>
    </div>
  );
}
