import { sql } from '@/lib/db';
import { findVariantBySku, setInventoryLevel } from '@/lib/shopify';

const CHUNK_SIZE = 15; // cuántas filas se piden a la BD por vuelta

/**
 * Procesa filas pendientes contra Shopify hasta agotar `maxDurationMs` o
 * hasta que ya no quede nada pendiente (lo que pase primero). El ritmo de
 * peticiones a Shopify se maneja de forma adaptativa dentro de lib/shopify.ts
 * (ya no hay una pausa fija aquí), así que esto va tan rápido como el
 * presupuesto real de la tienda lo permita.
 */
export async function processPendingBatch(maxDurationMs: number): Promise<{ processed: number; hasMore: boolean }> {
  const startedAt = Date.now();
  let processed = 0;
  const touchedUploadIds = new Set<number>();

  const storeCache = new Map<number, any>();
  async function getStore(storeId: number) {
    if (storeCache.has(storeId)) return storeCache.get(storeId);
    const rows = await sql`SELECT * FROM stores WHERE id = ${storeId}`;
    const store = rows[0];
    storeCache.set(storeId, store);
    return store;
  }

  while (Date.now() - startedAt < maxDurationMs) {
    const pendingItems = await sql`
      SELECT ui.id AS item_id, ui.sku, ui.requested_qty, ui.upload_id,
             u.store_id, u.location_id
      FROM upload_items ui
      JOIN uploads u ON u.id = ui.upload_id
      WHERE ui.status = 'pending'
      ORDER BY ui.id
      LIMIT ${CHUNK_SIZE}
    `;

    if (pendingItems.length === 0) {
      break;
    }

    for (const item of pendingItems as any[]) {
      if (Date.now() - startedAt > maxDurationMs) break;

      touchedUploadIds.add(item.upload_id);

      const storeRow = await getStore(item.store_id);
      if (!storeRow) {
        await sql`
          UPDATE upload_items SET status = 'error', message = 'Tienda no encontrada'
          WHERE id = ${item.item_id}
        `;
        processed++;
        continue;
      }

      const store = {
        shop_domain: storeRow.shop_domain,
        access_token: storeRow.access_token,
        api_version: storeRow.api_version,
      };

      const variant = await findVariantBySku(store, item.sku, item.location_id);

      if (variant.error) {
        await sql`
          UPDATE upload_items SET status = 'error', message = ${'Error buscando SKU: ' + variant.error}
          WHERE id = ${item.item_id}
        `;
      } else if (!variant.found) {
        await sql`
          UPDATE upload_items SET status = 'not_found', message = 'SKU no encontrado en la tienda'
          WHERE id = ${item.item_id}
        `;
      } else {
        const setResult = await setInventoryLevel(
          store,
          item.location_id,
          variant.inventoryItemId,
          item.requested_qty,
          variant.currentQuantity
        );
        if (setResult.ok) {
          await sql`
            UPDATE upload_items
            SET status = 'success', product_title = ${variant.productTitle}, message = ${'Inventario actualizado a ' + item.requested_qty}
            WHERE id = ${item.item_id}
          `;
        } else {
          await sql`
            UPDATE upload_items
            SET status = 'error', product_title = ${variant.productTitle}, message = ${'Error al actualizar: ' + setResult.error}
            WHERE id = ${item.item_id}
          `;
        }
      }

      processed++;
    }
  }

  for (const uploadId of touchedUploadIds) {
    const counts = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'success')   AS success,
        COUNT(*) FILTER (WHERE status = 'not_found') AS not_found,
        COUNT(*) FILTER (WHERE status = 'error')     AS error,
        COUNT(*) FILTER (WHERE status = 'pending')   AS pending
      FROM upload_items WHERE upload_id = ${uploadId}
    `;
    const c: any = counts[0];

    if (Number(c.pending) === 0) {
      await sql`
        UPDATE uploads
        SET success_count = ${c.success}, not_found_count = ${c.not_found}, error_count = ${c.error},
            status = 'completed', finished_at = NOW()
        WHERE id = ${uploadId}
      `;
    } else {
      await sql`
        UPDATE uploads
        SET success_count = ${c.success}, not_found_count = ${c.not_found}, error_count = ${c.error}
        WHERE id = ${uploadId}
      `;
    }
  }

  const remainingRows = await sql`SELECT COUNT(*)::int AS c FROM upload_items WHERE status = 'pending'`;
  const hasMore = (remainingRows[0] as any).c > 0;

  return { processed, hasMore };
}
