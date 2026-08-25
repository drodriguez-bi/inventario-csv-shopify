import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { findVariantBySku, setInventoryLevel } from '@/lib/shopify';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Cuántas filas procesa como máximo en una sola ejecución del cron, para no
// pasarnos del tiempo máximo permitido por la función serverless.
const BATCH_SIZE = 25;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function GET(req: NextRequest) {
  // Vercel Cron agrega automáticamente este header cuando la variable de
  // entorno CRON_SECRET está configurada. También aceptamos un token manual
  // por query param, por si quieres disparar esto con un cron externo
  // (ej. cron-job.org) en vez del cron nativo de Vercel.
  const authHeader = req.headers.get('authorization');
  const tokenParam = req.nextUrl.searchParams.get('token');
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return NextResponse.json({ ok: false, error: 'Falta configurar CRON_SECRET.' }, { status: 500 });
  }

  const authorized = authHeader === `Bearer ${expected}` || tokenParam === expected;
  if (!authorized) {
    return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });
  }

  // Tomamos un lote de items pendientes, con los datos de su carga (tienda/sucursal)
  const pendingItems = await sql`
    SELECT ui.id AS item_id, ui.sku, ui.requested_qty, ui.upload_id,
           u.store_id, u.location_id
    FROM upload_items ui
    JOIN uploads u ON u.id = ui.upload_id
    WHERE ui.status = 'pending'
    ORDER BY ui.id
    LIMIT ${BATCH_SIZE}
  `;

  if (pendingItems.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, message: 'No hay filas pendientes.' });
  }

  // Agrupamos por tienda para no repetir la consulta de credenciales por cada fila
  const storeCache = new Map<number, any>();
  async function getStore(storeId: number) {
    if (storeCache.has(storeId)) return storeCache.get(storeId);
    const rows = await sql`SELECT * FROM stores WHERE id = ${storeId}`;
    const store = rows[0];
    storeCache.set(storeId, store);
    return store;
  }

  let processed = 0;
  const touchedUploadIds = new Set<number>();

  for (let i = 0; i < pendingItems.length; i++) {
    const item: any = pendingItems[i];
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

    const variant = await findVariantBySku(store, item.sku);

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
      const setResult = await setInventoryLevel(store, item.location_id, variant.inventoryItemId, item.requested_qty);
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
    if (i < pendingItems.length - 1) {
      await sleep(600); // respeta el rate limit de Shopify
    }
  }

  // Actualizamos contadores y, si ya no quedan pendientes, marcamos la carga como completada.
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

  return NextResponse.json({ ok: true, processed, remaining_check: 'puede haber más pendientes, el cron los tomará en la siguiente corrida' });
}
