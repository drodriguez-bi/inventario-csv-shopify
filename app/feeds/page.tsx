'use client';

import { useEffect, useState } from 'react';

type Store = { id: number; name: string };
type Location = { id: number; name: string };
type Feed = {
  id: number;
  name: string;
  token: string;
  store_id: number;
  store_name: string;
  location_name: string;
  created_at: string;
};

export default function FeedsPage() {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [origin, setOrigin] = useState('');

  const [stores, setStores] = useState<Store[]>([]);
  const [name, setName] = useState('');
  const [storeId, setStoreId] = useState('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState('');
  const [loadingLocations, setLoadingLocations] = useState(false);

  async function loadFeeds() {
    const res = await fetch('/api/feeds');
    const data = await res.json();
    if (data.ok) setFeeds(data.feeds);
  }

  useEffect(() => {
    setOrigin(window.location.origin);
    loadFeeds();
    fetch('/api/stores')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setStores(d.stores);
      });
  }, []);

  async function handleStoreChange(id: string) {
    setStoreId(id);
    setLocationId('');
    setLocations([]);
    if (!id) return;

    setLoadingLocations(true);
    try {
      const res = await fetch(`/api/locations?storeId=${id}`);
      const data = await res.json();
      if (!data.ok || data.locations.length === 0) {
        setError('No se pudieron obtener las sucursales: ' + (data.error || 'sin sucursales'));
        return;
      }
      setError('');
      setLocations(data.locations);
    } finally {
      setLoadingLocations(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!name.trim() || !storeId || !locationId) {
      setError('Nombre, tienda y sucursal son obligatorios.');
      return;
    }

    const locationName = locations.find((l) => String(l.id) === locationId)?.name ?? '';

    setLoading(true);
    const res = await fetch('/api/feeds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        store_id: Number(storeId),
        location_id: Number(locationId),
        location_name: locationName,
      }),
    });
    const data = await res.json();
    setLoading(false);

    if (!data.ok) {
      setError(data.error || 'Error al crear el feed.');
      return;
    }

    setSuccess('Feed creado. Copia el link de abajo y dáselo al proveedor.');
    setName('');
    setStoreId('');
    setLocationId('');
    setLocations([]);
    loadFeeds();
  }

  async function handleDelete(id: number) {
    if (!confirm('¿Eliminar este feed? El link dejará de funcionar.')) return;
    await fetch(`/api/feeds/${id}`, { method: 'DELETE' });
    loadFeeds();
  }

  function feedUrl(token: string) {
    return `${origin}/feed/${token}`;
  }

  function apiUrl(token: string) {
    return `${origin}/api/feed/${token}`;
  }

  async function copyUrl(token: string) {
    await navigator.clipboard.writeText(feedUrl(token));
    setSuccess('Link copiado al portapapeles.');
  }

  async function copyApiUrl(token: string) {
    await navigator.clipboard.writeText(apiUrl(token));
    setSuccess('Link de API copiado al portapapeles.');
  }

  return (
    <>
      <h1>Feeds automáticos</h1>
      <p className="muted">
        Un feed es un link único, con su propia clave secreta, para que un proveedor (como Gifan) suba
        su inventario — sin necesidad de que tú subas nada a mano. El archivo se procesa solo, en segundo plano.
      </p>
      <p className="muted">
        <strong>Link para subir el archivo:</strong> es una página web simple — el proveedor solo la abre
        en su navegador, elige el archivo y le da clic a "Subir". No necesita usuario, contraseña, ni
        conocimientos técnicos.<br />
        <strong>Link técnico (API):</strong> es para cuando el proveedor tiene su propio sistema/desarrollador
        y puede mandar el archivo automáticamente por código, sin abrir ninguna página.
      </p>


      {error && <p className="alert alert-error">{error}</p>}
      {success && <p className="alert alert-success">{success}</p>}

      <div className="card">
        <h2>Crear nuevo feed</h2>
        <form onSubmit={handleCreate}>
          <label>
            Nombre (para identificarlo, ej. "Gifan")
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Gifan" required />
          </label>

          <label>
            Tienda
            <select value={storeId} onChange={(e) => handleStoreChange(e.target.value)} required>
              <option value="">Selecciona una tienda</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>

          <label>
            Sucursal (location)
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} required disabled={!storeId || loadingLocations}>
              <option value="">
                {!storeId ? 'Selecciona primero una tienda' : loadingLocations ? 'Cargando sucursales...' : 'Selecciona una sucursal'}
              </option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>

          <button type="submit" disabled={loading}>{loading ? 'Creando...' : 'Crear feed'}</button>
        </form>
      </div>

      <div className="card">
        <h2>Feeds existentes</h2>
        {feeds.length === 0 ? (
          <p className="muted">Aún no hay feeds creados.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Nombre</th><th>Tienda</th><th>Sucursal</th><th>Link para subir el archivo</th><th>Link técnico (API)</th><th></th></tr>
            </thead>
            <tbody>
              {feeds.map((f) => (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td>{f.store_name}</td>
                  <td>{f.location_name}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input readOnly value={feedUrl(f.token)} style={{ fontSize: 12, width: 260 }} />
                      <button type="button" onClick={() => copyUrl(f.token)}>Copiar</button>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input readOnly value={apiUrl(f.token)} style={{ fontSize: 12, width: 260 }} />
                      <button type="button" onClick={() => copyApiUrl(f.token)}>Copiar</button>
                    </div>
                  </td>
                  <td>
                    <button className="btn-danger-sm" onClick={() => handleDelete(f.id)}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
