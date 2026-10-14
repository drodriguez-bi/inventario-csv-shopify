'use client';

import { useEffect, useState, type CSSProperties } from 'react';

type FeedInfo = { ok: boolean; name?: string; storeName?: string; locationName?: string; error?: string };

export default function FeedUploadPage({ params }: { params: { token: string } }) {
  const [info, setInfo] = useState<FeedInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    fetch(`/api/feed/${params.token}`)
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo({ ok: false, error: 'No se pudo verificar el link.' }));
  }, [params.token]);

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`/api/feed/${params.token}`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (data.ok) {
        setResult({ ok: true, message: data.message || 'Archivo subido correctamente.' });
        setFile(null);
      } else {
        setResult({ ok: false, message: data.error || 'Ocurrió un error al subir el archivo.' });
      }
    } catch {
      setResult({ ok: false, message: 'No se pudo conectar con el servidor. Intenta de nuevo.' });
    } finally {
      setUploading(false);
    }
  }

  if (!info) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <p>Cargando...</p>
        </div>
      </div>
    );
  }

  if (!info.ok) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <h1 style={titleStyle}>Link no válido</h1>
          <p style={{ color: '#b3261e' }}>{info.error || 'Este link ya no está activo.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <h1 style={titleStyle}>📦 Subir inventario</h1>
        <p style={{ color: '#555', marginBottom: 24 }}>
          Esta carga actualizará el inventario de: <br />
          <strong>{info.storeName}</strong> — sucursal <strong>{info.locationName}</strong>
        </p>

        <label style={fileLabelStyle}>
          {file ? file.name : 'Selecciona tu archivo (.csv)'}
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={{ display: 'none' }}
          />
        </label>

        <button
          onClick={handleUpload}
          disabled={!file || uploading}
          style={{
            ...buttonStyle,
            opacity: !file || uploading ? 0.5 : 1,
            cursor: !file || uploading ? 'not-allowed' : 'pointer',
          }}
        >
          {uploading ? 'Subiendo, por favor espera...' : 'Subir archivo'}
        </button>

        {uploading && (
          <p style={{ color: '#777', fontSize: 14, marginTop: 12 }}>
            Esto puede tardar hasta un minuto. No cierres esta página.
          </p>
        )}

        {result && (
          <p
            style={{
              marginTop: 20,
              padding: '12px 16px',
              borderRadius: 8,
              backgroundColor: result.ok ? '#e6f6ec' : '#fdecea',
              color: result.ok ? '#1e7b3c' : '#b3261e',
            }}
          >
            {result.message}
          </p>
        )}
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#f4f5f7',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
  padding: 20,
};

const cardStyle: CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 40,
  maxWidth: 480,
  width: '100%',
  boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
  textAlign: 'center',
};

const titleStyle: CSSProperties = {
  fontSize: 24,
  marginBottom: 8,
};

const fileLabelStyle: CSSProperties = {
  display: 'block',
  border: '2px dashed #c0c0d0',
  borderRadius: 8,
  padding: '24px 16px',
  marginBottom: 20,
  cursor: 'pointer',
  color: '#444',
  fontSize: 15,
};

const buttonStyle: CSSProperties = {
  width: '100%',
  background: '#4b4bf0',
  color: '#fff',
  border: 'none',
  padding: '14px 20px',
  borderRadius: 8,
  fontSize: 16,
  fontWeight: 600,
};
