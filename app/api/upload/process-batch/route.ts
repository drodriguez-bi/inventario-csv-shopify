import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { findVariantBySku, setInventoryLevel } from '@/lib/shopify';

// Evita que Next.js intente analizar/optimizar esta ruta estáticamente
// (necesario por las dependencias de BD/auth usadas aquí).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Permite que el lote tenga tiempo suficiente (varias llamadas secuenciales a Shopify).
// En plan Hobby el máximo real es 60s; en Pro puedes subir esto hasta 300.
export const maxDuration = 60;

type Row = { sku: string; qty: number };

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 });
  }

  const { uploadId, storeId, locationId, rows } = (await req.json()) as {
    uploadId: number;
    storeId: number;
    locationId: number;
    rows: Row[];
  };

  if (!uploadId || !storeId || !locationId || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'Datos incompletos' }, { status: 400 });
  }

  const storeRows = await sql`SELECT * FROM stores WHERE id = ${storeId}`;
  const storeRow = storeRows[0];
  if (!storeRow) {
    return NextResponse.json({ ok: false, error: 'Tienda no encontrada' }, { status: 404 });
  }
  const store = {
    shop_domain: storeRow.shop_domain,
    access_token: storeRow.access_token,
    api_version: storeRow.api_version,
  };

  const results: { sku: string; qty: number; status: string; productTitle: string | null; message: string }[] = [];

  let success = 0;
  let notFound = 0;
  let errors = 0;

  for (const { sku, qty } of rows) {
    const variant = await findVariantBySku(store, sku, locationId);

    if (variant.error) {
      errors++;
      results.push({ sku, qty, status: 'error', productTitle: null, message: `Error buscando SKU: ${variant.error}` });
    } else if (!variant.found) {
      notFound++;
      results.push({ sku, qty, status: 'not_found', productTitle: null, message: 'SKU no encontrado en la tienda' });
    } else {
      const setResult = await setInventoryLevel(store, locationId, variant.inventoryItemId, qty, variant.currentQuantity);
      if (setResult.ok) {
        success++;
        results.push({
          sku,
          qty,
          status: 'success',
          productTitle: variant.productTitle,
          message: `Inventario actualizado a ${qty}`,
        });
      } else {
        errors++;
        results.push({
          sku,
          qty,
          status: 'error',
          productTitle: variant.productTitle,
          message: `Error al actualizar: ${setResult.error}`,
        });
      }
    }
  }

  // Insertar todos los resultados del lote
  for (const r of results) {
    await sql`
      INSERT INTO upload_items (upload_id, sku, requested_qty, status, product_title, message)
      VALUES (${uploadId}, ${r.sku}, ${r.qty}, ${r.status}, ${r.productTitle}, ${r.message})
    `;
  }

  await sql`
    UPDATE uploads
    SET success_count = success_count + ${success},
        not_found_count = not_found_count + ${notFound},
        error_count = error_count + ${errors}
    WHERE id = ${uploadId}
  `;

  return NextResponse.json({ ok: true, results, batchCounts: { success, notFound, errors } });
}
