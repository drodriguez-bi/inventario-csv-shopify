'use client';

import { useEffect, useState } from 'react';

type Store = { id: number; name: string; shop_domain: string; api_version: string; connected: boolean };

export default function StoresPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState('');
  const [shopDomain, setShopDomain] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [apiVersion, setApiVersion] = useState('');

  async function loadStores() {
    const res = await fetch('/api/stores');
    const data = await res.json();
    if (data.ok) setStores(data.stores);
  }

  useEffect(() => {
    loadStores();
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === '1') {
      setSuccess('¡Tienda conectada correctamente! Ya puedes usarla para subir inventario.');
    }
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    const res = await fetch('/api/stores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        shop_domain: shopDomain,
        client_id: clientId,
        client_secret: clientSecret,
        api_version: apiVersion,
      }),
    });
    const data = await res.json();
    setLoading(false);

    if (!data.ok) {
      setError(data.error || 'Error al agregar la tienda.');
      return;
    }

    setSuccess('Tienda guardada. Ahora dale clic en "Conectar con Shopify" para autorizarla.');
    setName('');
    setShopDomain('');
    setClientId('');
    setClientSecret('');
    setApiVersion('');
    loadStores();
  }

  async function handleDelete(id: number) {
    if (!confirm('¿Eliminar esta tienda?')) return;
    await fetch(`/api/stores/${id}`, { method: 'DELETE' });
    loadStores();
  }

  return (
    <>
      <h1>Tiendas Shopify</h1>
      {error && <p className="alert alert-error">{error}</p>}
      {success && <p className="alert alert-success">{success}</p>}

      <div className="card">
        <h2>Agregar tienda</h2>
        <form onSubmit={handleAdd}>
          <label>
            Nombre (para identificarla en el sistema)
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Stanley 1913 MX" required />
          </label>
          <label>
            Dominio myshopify
            <input
              value={shopDomain}
              onChange={(e) => setShopDomain(e.target.value)}
              placeholder="stanley-1913-mx.myshopify.com"
              required
            />
          </label>
          <label>
            Client ID (de tu app en Shopify Partners)
            <input value={clientId} onChange={(e) => setClientId(e.target.value)} required />
          </label>
          <label>
            Client Secret (de tu app en Shopify Partners)
            <input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} required />
          </label>
          <label>
            Versión de API (opcional)
            <input value={apiVersion} onChange={(e) => setApiVersion(e.target.value)} placeholder="2025-10" />
          </label>
          <button type="submit" disabled={loading}>{loading ? 'Guardando...' : 'Guardar tienda'}</button>
        </form>
        <p className="muted">
          En la configuración de tu app en Shopify Partners, agrega esta URL en <strong>Allowed redirection URL(s)</strong>:
          <br />
          <code>{typeof window !== 'undefined' ? window.location.origin : ''}/api/shopify/callback</code>
        </p>
      </div>

      <div className="card">
        <h2>Tiendas registradas</h2>
        {stores.length === 0 ? (
          <p className="muted">Aún no hay tiendas agregadas.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Nombre</th><th>Dominio</th><th>API</th><th>Estatus</th><th></th></tr>
            </thead>
            <tbody>
              {stores.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.shop_domain}</td>
                  <td>{s.api_version}</td>
                  <td>
                    {s.connected ? (
                      <span className="badge badge-success">Conectada</span>
                    ) : (
                      <span className="badge badge-warning">Pendiente</span>
                    )}
                  </td>
                  <td style={{ display: 'flex', gap: 8 }}>
                    <a href={`/api/shopify/install?storeId=${s.id}`}>
                      <button type="button">{s.connected ? 'Reconectar' : 'Conectar con Shopify'}</button>
                    </a>
                    <button className="btn-danger-sm" onClick={() => handleDelete(s.id)}>Eliminar</button>
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
