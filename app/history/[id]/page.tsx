'use client';

import { useEffect, useState } from 'react';

type Item = {
  id: number;
  sku: string;
  requested_qty: number;
  status: 'success' | 'not_found' | 'error';
  product_title: string | null;
  message: string | null;
};

type Upload = {
  id: number;
  store_name: string;
  location_name: string;
  filename: string;
  status: string;
  total_rows: number;
  success_count: number;
  not_found_count: number;
  error_count: number;
};

export default function UploadDetailPage({ params }: { params: { id: string } }) {
  const [upload, setUpload] = useState<Upload | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState<'all' | 'success' | 'not_found' | 'error'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const qs = filter !== 'all' ? `?filter=${filter}` : '';
    setLoading(true);
    fetch(`/api/upload/${params.id}${qs}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setUpload(data.upload);
          setItems(data.items);
        }
        setLoading(false);
      });
  }, [params.id, filter]);

  if (loading && !upload) {
    return <p className="muted">Cargando...</p>;
  }

  if (!upload) {
    return <p className="alert alert-error">Carga no encontrada.</p>;
  }

  return (
    <>
      <h1>Resultado de la carga #{upload.id}</h1>

      <div className="card">
        <p><strong>Tienda:</strong> {upload.store_name}</p>
        <p><strong>Sucursal:</strong> {upload.location_name}</p>
        <p><strong>Archivo:</strong> {upload.filename}</p>
        <p>
          <strong>Estatus:</strong>{' '}
          {upload.status === 'completed' ? (
            <span className="badge badge-success">Completada</span>
          ) : upload.status === 'processing' ? (
            <span className="badge badge-warning">Procesando...</span>
          ) : (
            <span className="badge badge-error">Falló</span>
          )}
        </p>

        <div className="summary-grid">
          <div className="summary-box total"><span>{upload.total_rows}</span>Total filas</div>
          <div className="summary-box success"><span>{upload.success_count}</span>Actualizados</div>
          <div className="summary-box warning"><span>{upload.not_found_count}</span>No encontrados</div>
          <div className="summary-box error"><span>{upload.error_count}</span>Errores</div>
        </div>
      </div>

      <div className="card">
        <div className="filter-bar">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todos</button>
          <button className={filter === 'success' ? 'active' : ''} onClick={() => setFilter('success')}>Actualizados</button>
          <button className={filter === 'not_found' ? 'active' : ''} onClick={() => setFilter('not_found')}>No encontrados</button>
          <button className={filter === 'error' ? 'active' : ''} onClick={() => setFilter('error')}>Errores</button>
        </div>

        <table className="table">
          <thead>
            <tr><th>SKU</th><th>Cantidad solicitada</th><th>Producto</th><th>Estatus</th><th>Detalle</th></tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td>{it.sku}</td>
                <td>{it.requested_qty}</td>
                <td>{it.product_title || '—'}</td>
                <td>
                  {it.status === 'success' ? (
                    <span className="badge badge-success">Actualizado</span>
                  ) : it.status === 'not_found' ? (
                    <span className="badge badge-warning">No encontrado</span>
                  ) : (
                    <span className="badge badge-error">Error</span>
                  )}
                </td>
                <td className="muted">{it.message}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={5} className="muted">Sin registros para este filtro.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
