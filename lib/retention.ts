import { sql } from '@/lib/db';

// Cuántos días de historial se conservan. Se puede cambiar con la variable de entorno
// HISTORY_RETENTION_DAYS en Vercel (ej. 30). Con 0 se desactiva la limpieza automática.
export function retentionDays(): number {
  const raw = process.env.HISTORY_RETENTION_DAYS?.trim();
  if (raw === undefined || raw === '') return 14;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 14;
}

/**
 * Borra el historial más viejo que `days` días. Las filas de detalle (upload_items) se borran en
 * cascada junto con su carga. Borra como máximo `batch` cargas por llamada, para que una limpieza
 * grande se haga poco a poco sin alargar el cron. No toca tiendas, feeds ni feed_snapshot.
 */
export async function pruneOldHistory(days: number = retentionDays(), batch = 200): Promise<number> {
  if (!Number.isFinite(days) || days < 1) return 0;

  const deleted = await sql`
    DELETE FROM uploads
    WHERE id IN (
      SELECT id FROM uploads
      WHERE started_at < NOW() - (${days}::int * INTERVAL '1 day')
      ORDER BY started_at
      LIMIT ${batch}
    )
    RETURNING id
  `;
  return deleted.length;
}
