'use client';

import { useEffect, useState, type CSSProperties } from 'react';

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
  ftp_protocol: string | null;
  ftp_host: string | null;
  ftp_port: number | null;
  ftp_user: string | null;
  ftp_path: string | null;
  last_pulled_at: string | null;
  last_pull_status: string | null;
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

  // Cómo llega el archivo: el sistema lo lee de un FTP, o el proveedor lo sube a un link
  const [mode, setMode] = useState<'ftp' | 'upload'>('ftp');
  const [ftpProtocol, setFtpProtocol] = useState('ftp');
  const [ftpHost, setFtpHost] = useState('');
  const [ftpPort, setFtpPort] = useState('');
  const [ftpUser, setFtpUser] = useState('');
  const [ftpPassword, setFtpPassword] = useState('');
  const [ftpPath, setFtpPath] = useState('');

  const [pulling, setPulling] = useState<number | null>(null);
  const [pullMessages, setPullMessages] = useState<Record<number, { ok: boolean; text: string }>>({});

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
    if (mode === 'ftp' && (!ftpHost.trim() || !ftpUser.trim() || !ftpPassword.trim())) {
      setError('Para leer por FTP hacen falta servidor, usuario y contraseña.');
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
        ...(mode === 'ftp'
          ? {
              ftp_protocol: ftpProtocol,
              ftp_host: ftpHost.trim(),
              ftp_port: ftpPort,
              ftp_user: ftpUser.trim(),
              ftp_password: ftpPassword,
              ftp_path: ftpPath.trim(),
            }
          : {}),
      }),
    });
    const data = await res.json();
    setLoading(false);

    if (!data.ok) {
      setError(data.error || 'Error al crear el feed.');
      return;
    }

    setSuccess(
      mode === 'ftp'
        ? 'Feed creado. Dale "Leer ahora" para probar la conexión con el servidor.'
        : 'Feed creado. Copia el link de abajo y dáselo al proveedor.'
    );
    setName('');
    setStoreId('');
    setLocationId('');
    setLocations([]);
    setFtpHost('');
    setFtpPort('');
    setFtpUser('');
    setFtpPassword('');
    setFtpPath('');
    loadFeeds();
  }

  async function handleDelete(id: number) {
    if (!confirm('¿Eliminar este feed? Dejará de leerse/recibirse; el historial se conserva.')) return;
    await fetch(`/api/feeds/${id}`, { method: 'DELETE' });
    loadFeeds();
  }

  async function handlePull(id: number) {
    setPulling(id);
    setPullMessages((m) => ({ ...m, [id]: { ok: true, text: 'Conectando al servidor y leyendo el archivo...' } }));
    try {
      const res = await fetch(`/api/feeds/${id}/pull`, { method: 'POST' });
      const data = await res.json();
      const text = data.status || data.error || 'Sin respuesta';
      setPullMessages((m) => ({
        ...m,
        [id]: { ok: !!data.ok, text: data.ok ? `${text} — procesadas ahora: ${data.processed ?? 0}` : text },
      }));
    } catch {
      setPullMessages((m) => ({ ...m, [id]: { ok: false, text: 'No se pudo completar la solicitud.' } }));
    } finally {
      setPulling(null);
      loadFeeds();
    }
  }

  function feedUrl(token: string) {
    return `${origin}/feed/${token}`;
  }
  function apiUrl(token: string) {
    return `${origin}/api/feed/${token}`;
  }
  function inboxUrl() {
    return `${origin}/api/feed-inbox`;
  }
  function cronUrl() {
    return `${origin}/api/cron/pull-feeds?token=TU_CRON_SECRET`;
  }

  async function copyText(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setSuccess(`${label} copiado al portapapeles.`);
  }

  function fmtDate(d: string | null) {
    if (!d) return 'nunca';
    return new Date(d).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
  }

  const hasFtpFeeds = feeds.some((f) => f.ftp_host);

  return (
    <>
      <h1>Feeds automáticos</h1>
      <p className="muted">
        Un feed conecta a un proveedor (como Gifan) con una tienda y sucursal fijas, para que su inventario
        se actualice solo. Solo se actualizan los SKU cuya cantidad cambió.
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
                <option key={s.id} value={s.id}>{s.name} (#{s.id})</option>
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

          <label>
            ¿Cómo llega el archivo?
            <select value={mode} onChange={(e) => setMode(e.target.value as 'ftp' | 'upload')}>
              <option value="ftp">El sistema lo lee de un servidor FTP/SFTP del proveedor</option>
              <option value="upload">El proveedor lo sube a un link (o a una API)</option>
            </select>
          </label>

          {mode === 'ftp' && (
            <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <label>
                Protocolo
                <select value={ftpProtocol} onChange={(e) => setFtpProtocol(e.target.value)}>
                  <option value="ftp">FTP (puerto 21 por defecto)</option>
                  <option value="ftps">FTPS — FTP con TLS (puerto 21)</option>
                  <option value="sftp">SFTP (puerto 22 por defecto)</option>
                </select>
              </label>
              <label>
                Servidor (dirección IP o dominio)
                <input value={ftpHost} onChange={(e) => setFtpHost(e.target.value)} placeholder="187.174.75.10" />
              </label>
              <label>
                Puerto (opcional)
                <input value={ftpPort} onChange={(e) => setFtpPort(e.target.value)} placeholder={ftpProtocol === 'sftp' ? '22' : '21'} />
              </label>
              <label>
                Usuario
                <input value={ftpUser} onChange={(e) => setFtpUser(e.target.value)} autoComplete="off" />
              </label>
              <label>
                Contraseña
                <input type="password" value={ftpPassword} onChange={(e) => setFtpPassword(e.target.value)} autoComplete="new-password" />
              </label>
              <label>
                Archivo o carpeta (opcional)
                <input value={ftpPath} onChange={(e) => setFtpPath(e.target.value)} placeholder="Vacío = toma el .csv más reciente de la raíz" />
              </label>
            </div>
          )}

          <button type="submit" disabled={loading}>{loading ? 'Creando...' : 'Crear feed'}</button>
        </form>
      </div>

      {hasFtpFeeds && (
        <div className="card">
          <h2>Lectura automática cada 5 minutos</h2>
          <p className="muted">
            El sistema lee los servidores FTP cuando algo "toca" esta dirección. Configúrala en un servicio de
            cron (por ejemplo cron-job.org, gratis) cada 5 minutos, reemplazando TU_CRON_SECRET por el valor
            de la variable CRON_SECRET en Vercel:
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input readOnly value={cronUrl()} style={{ fontSize: 12, flex: 1, minWidth: 0 }} />
            <button type="button" onClick={() => copyText(cronUrl(), 'Dirección')}>Copiar</button>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Feeds existentes</h2>
        {feeds.length === 0 ? (
          <p className="muted">Aún no hay feeds creados.</p>
        ) : (
          feeds.map((f) => (
            <div key={f.id} style={{ border: '1px solid #eee', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <strong>{f.name}</strong>
                  <span className="muted"> — {f.store_name} · {f.location_name}</span>
                </div>
                <button className="btn-danger-sm" onClick={() => handleDelete(f.id)}>Eliminar</button>
              </div>

              {f.ftp_host ? (
                <>
                  <p className="muted" style={{ margin: '0 0 8px' }}>
                    Lee de <strong>{(f.ftp_protocol || 'ftp').toUpperCase()}</strong> · {f.ftp_host}
                    {f.ftp_port ? `:${f.ftp_port}` : ''} · usuario {f.ftp_user}
                    {f.ftp_path ? ` · ${f.ftp_path}` : ' · .csv más reciente de la raíz'}
                  </p>
                  <p className="muted" style={{ margin: '0 0 12px' }}>
                    Última lectura: {fmtDate(f.last_pulled_at)}
                    {f.last_pull_status ? ` — ${f.last_pull_status}` : ''}
                  </p>
                  <button type="button" onClick={() => handlePull(f.id)} disabled={pulling === f.id}>
                    {pulling === f.id ? 'Leyendo...' : 'Leer ahora'}
                  </button>
                  {pullMessages[f.id] && (
                    <p className={pullMessages[f.id].ok ? 'alert alert-success' : 'alert alert-error'} style={{ marginTop: 12 }}>
                      {pullMessages[f.id].text}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <label style={{ fontSize: 13 }}>
                    Link para subir el archivo (para personas, sin conocimientos técnicos)
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <input readOnly value={feedUrl(f.token)} style={{ fontSize: 12, flex: 1, minWidth: 0 }} />
                      <button type="button" onClick={() => copyText(feedUrl(f.token), 'Link')}>Copiar</button>
                    </div>
                  </label>

                  <label style={{ fontSize: 13, marginTop: 12 }}>
                    Link técnico simple (token en la URL, para pruebas rápidas con curl)
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <input readOnly value={apiUrl(f.token)} style={{ fontSize: 12, flex: 1, minWidth: 0 }} />
                      <button type="button" onClick={() => copyText(apiUrl(f.token), 'Link')}>Copiar</button>
                    </div>
                  </label>

                  <label style={{ fontSize: 13, marginTop: 12 }}>
                    API recomendada para integraciones automáticas (token en header, no en la URL)
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <input readOnly value={inboxUrl()} style={{ fontSize: 12, flex: 1, minWidth: 0 }} />
                      <button type="button" onClick={() => copyText(inboxUrl(), 'URL')}>Copiar URL</button>
                      <button type="button" onClick={() => copyText(f.token, 'Token')}>Copiar token</button>
                    </div>
                    <pre style={curlStyle}>
{`curl -X POST "${inboxUrl()}" \\
  -H "Authorization: Bearer ${f.token}" \\
  -H "Content-Type: text/csv" \\
  --data-binary @archivo.csv`}
                    </pre>
                  </label>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
}

const curlStyle: CSSProperties = {
  background: '#f7f7fa',
  padding: 12,
  borderRadius: 6,
  fontSize: 12,
  marginTop: 8,
  overflowX: 'auto',
};
