'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Papa from 'papaparse';

type Store = { id: number; name: string };
type Location = { id: number; name: string };

const BATCH_SIZE = 10;

export default function UploadPage() {
  const router = useRouter();

  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState('');
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, success: 0, notFound: 0, errors: 0 });

  useEffect(() => {
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

  function parseCsv(f: File): Promise<{ sku: string; qty: number }[]> {
    return new Promise((resolve, reject) => {
      Papa.parse(f, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim().toLowerCase(),
        complete: (results) => {
          const fields = (results.meta.fields || []).map((f) => f.trim().toLowerCase());
          const skuKey = fields.find((f) => f === 'sku');
          const qtyKey = fields.find((f) => ['cantidad', 'quantity', 'qty'].includes(f));

          if (!skuKey || !qtyKey) {
            reject(new Error('El CSV debe tener una columna "sku" y una columna "cantidad" (o "quantity"/"qty").'));
            return;
          }

          const rows = (results.data as Record<string, string>[])
            .map((row) => ({ sku: String(row[skuKey] ?? '').trim(), qty: parseInt(row[qtyKey] ?? '0', 10) || 0 }))
            .filter((r) => r.sku !== '');

          resolve(rows);
        },
        error: (err) => reject(err),
      });
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!storeId || !locationId || !file) {
      setError('Selecciona tienda, sucursal y archivo.');
      return;
    }

    let rows: { sku: string; qty: number }[];
    try {
      rows = await parseCsv(file);
    } catch (err: any) {
      setError(err.message || 'Error al leer el CSV.');
      return;
    }

    if (rows.length === 0) {
      setError('El CSV no contiene filas válidas.');
      return;
    }

    const locationName = locations.find((l) => String(l.id) === locationId)?.name ?? '';

    setProcessing(true);
    setProgress({ done: 0, total: rows.length, success: 0, notFound: 0, errors: 0 });

    // 1. Crear el registro de carga
    const startRes = await fetch('/api/upload/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: Number(storeId),
        locationId: Number(locationId),
        locationName,
        filename: file.name,
        totalRows: rows.length,
      }),
    });
    const startData = await startRes.json();
    if (!startData.ok) {
      setError(startData.error || 'No se pudo iniciar la carga.');
      setProcessing(false);
      return;
    }
    const uploadId = startData.uploadId;

    // 2. Procesar en lotes secuenciales, actualizando el progreso en vivo
    let done = 0;
    let success = 0;
    let notFound = 0;
    let errors = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);

      try {
        const res = await fetch('/api/upload/process-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uploadId,
            storeId: Number(storeId),
            locationId: Number(locationId),
            rows: chunk,
          }),
        });
        const data = await res.json();

        if (data.ok) {
          success += data.batchCounts.success;
          notFound += data.batchCounts.notFound;
          errors += data.batchCounts.errors;
        } else {
          errors += chunk.length;
        }
      } catch {
        errors += chunk.length;
      }

      done += chunk.length;
      setProgress({ done, total: rows.length, success, notFound, errors });
    }

    // 3. Marcar la carga como completada
    await fetch('/api/upload/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId }),
    });

    router.push(`/history/${uploadId}`);
  }

  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <>
      <h1>Nueva carga de inventario</h1>

      {stores.length === 0 ? (
        <p className="alert alert-error">
          No hay tiendas registradas. <a href="/stores">Agrega una tienda</a> primero.
        </p>
      ) : (
        <div className="card">
          {error && <p className="alert alert-error">{error}</p>}

          {!processing ? (
            <form onSubmit={handleSubmit}>
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

              <label>
                Archivo CSV
                <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
              </label>

              <p className="muted">
                El CSV debe tener columnas <code>sku</code> y <code>cantidad</code> (o <code>quantity</code>) en la primera fila.
                La cantidad indicada <strong>reemplazará</strong> el inventario actual de esa sucursal — no se suma.
              </p>

              <button type="submit" disabled={!storeId || !locationId || !file}>Procesar carga</button>
            </form>
          ) : (
            <div>
              <h2>Procesando carga...</h2>
              <div className="progress-bar">
                <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
              </div>
              <p className="muted">{progress.done} / {progress.total} filas procesadas ({percent}%)</p>
              <div className="summary-grid">
                <div className="summary-box success"><span>{progress.success}</span>Actualizados</div>
                <div className="summary-box warning"><span>{progress.notFound}</span>No encontrados</div>
                <div className="summary-box error"><span>{progress.errors}</span>Errores</div>
              </div>
              <p className="muted">No cierres esta pestaña hasta que termine.</p>
            </div>
          )}
        </div>
      )}
    </>
  );
}
