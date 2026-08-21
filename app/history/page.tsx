import { sql } from '@/lib/db';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const uploads = await sql`
    SELECT u.*, s.name AS store_name
    FROM uploads u JOIN stores s ON s.id = u.store_id
    ORDER BY u.started_at DESC
    LIMIT 100
  `;

  return (
    <>
      <h1>Historial de cargas</h1>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>#</th><th>Fecha</th><th>Tienda</th><th>Sucursal</th><th>Archivo</th>
              <th>Total</th><th>Actualizados</th><th>No encontrados</th><th>Errores</th><th>Estatus</th><th></th>
            </tr>
          </thead>
          <tbody>
            {uploads.map((u: any) => (
              <tr key={u.id}>
                <td>#{u.id}</td>
                <td>{new Date(u.started_at).toLocaleString('es-MX')}</td>
                <td>{u.store_name}</td>
                <td>{u.location_name}</td>
                <td>{u.filename}</td>
                <td>{u.total_rows}</td>
                <td>{u.success_count}</td>
                <td>{u.not_found_count}</td>
                <td>{u.error_count}</td>
                <td>
                  {u.status === 'completed' ? (
                    <span className="badge badge-success">Completada</span>
                  ) : u.status === 'processing' ? (
                    <span className="badge badge-warning">Procesando</span>
                  ) : (
                    <span className="badge badge-error">Falló</span>
                  )}
                </td>
                <td><Link href={`/history/${u.id}`}>Ver detalle</Link></td>
              </tr>
            ))}
            {uploads.length === 0 && (
              <tr><td colSpan={11} className="muted">Aún no hay cargas registradas.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
