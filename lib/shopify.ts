import crypto from 'crypto';

export type ShopifyStore = {
  shop_domain: string;
  access_token: string;
  api_version: string;
};

// --- Ritmo adaptativo -------------------------------------------------
// En vez de una pausa fija entre peticiones, seguimos el "presupuesto" real
// que Shopify nos va reportando en cada respuesta (extensions.cost.throttleStatus)
// y solo esperamos cuando de verdad nos estamos quedando sin margen. Esto deja
// ir mucho más rápido que una pausa fija conservadora, sin arriesgarnos a que
// Shopify nos frene con 429.
let budget = { available: 2000, restoreRate: 50, lastUpdated: Date.now() };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForBudget(estimatedCost: number) {
  const elapsedSec = (Date.now() - budget.lastUpdated) / 1000;
  const projected = Math.min(budget.available + elapsedSec * budget.restoreRate, 2000);
  const safetyMargin = 100;
  if (projected < estimatedCost + safetyMargin) {
    const waitSec = (estimatedCost + safetyMargin - projected) / budget.restoreRate;
    if (waitSec > 0) await sleep(waitSec * 1000);
  }
}

async function shopifyGraphQL(
  store: ShopifyStore,
  query: string,
  variables: Record<string, unknown>,
  estimatedCost = 15,
  attempt = 0
): Promise<{ ok: boolean; data: any; error: string | null }> {
  await waitForBudget(estimatedCost);

  const url = `https://${store.shop_domain}/admin/api/${store.api_version}/graphql.json`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': store.access_token,
    },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });

  // Rate limit real (por si acaso, aunque el ritmo adaptativo debería evitarlo)
  if (res.status === 429 && attempt < 4) {
    await sleep(1500);
    return shopifyGraphQL(store, query, variables, estimatedCost, attempt + 1);
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  const throttle = data?.extensions?.cost?.throttleStatus;
  if (throttle) {
    budget = {
      available: throttle.currentlyAvailable,
      restoreRate: throttle.restoreRate,
      lastUpdated: Date.now(),
    };
  }

  if (!res.ok) {
    return { ok: false, data: null, error: JSON.stringify(data ?? res.statusText) };
  }

  if (data?.errors) {
    const throttled =
      Array.isArray(data.errors) && data.errors.some((e: any) => e?.extensions?.code === 'THROTTLED');
    if (throttled && attempt < 4) {
      await sleep(1500 * (attempt + 1));
      return shopifyGraphQL(store, query, variables, estimatedCost, attempt + 1);
    }
    return { ok: false, data: null, error: JSON.stringify(data.errors) };
  }

  return { ok: true, data, error: null };
}

function gidToNumericId(gid: string): number {
  return parseInt(gid.split('/').pop() as string, 10);
}

export async function getLocations(
  store: ShopifyStore
): Promise<{ ok: boolean; locations: { id: number; name: string }[]; error: string | null }> {
  const query = `
    query getLocations {
      locations(first: 100) {
        edges { node { id name } }
      }
    }
  `;

  const result = await shopifyGraphQL(store, query, {});
  if (!result.ok) {
    return { ok: false, locations: [], error: result.error ?? 'No se pudo conectar con Shopify' };
  }

  const edges = result.data?.data?.locations?.edges ?? [];
  const locations = edges.map((e: any) => ({
    id: gidToNumericId(e.node.id),
    name: e.node.name,
  }));

  return { ok: true, locations, error: null };
}

/**
 * Busca la variante por SKU y de una vez trae la cantidad actual en la
 * sucursal indicada — todo en UNA sola llamada (antes eran dos).
 */
export async function findVariantBySku(
  store: ShopifyStore,
  sku: string,
  locationId?: number
): Promise<
  | { found: true; inventoryItemId: number; productTitle: string; currentQuantity: number; error: null }
  | { found: false; inventoryItemId?: undefined; productTitle?: undefined; currentQuantity?: undefined; error: string | null }
> {
  const locationGid = locationId ? `gid://shopify/Location/${locationId}` : null;

  const query = locationGid
    ? `
      query getVariantBySku($q: String!, $locationId: ID!) {
        productVariants(first: 1, query: $q) {
          edges {
            node {
              id
              sku
              inventoryItem {
                id
                inventoryLevel(locationId: $locationId) {
                  quantities(names: ["available"]) { quantity }
                }
              }
              product { title }
            }
          }
        }
      }
    `
    : `
      query getVariantBySku($q: String!) {
        productVariants(first: 1, query: $q) {
          edges {
            node {
              id
              sku
              inventoryItem { id }
              product { title }
            }
          }
        }
      }
    `;

  const safeSku = sku.replace(/"/g, '');
  const variables: Record<string, unknown> = { q: `sku:"${safeSku}"` };
  if (locationGid) variables.locationId = locationGid;

  const result = await shopifyGraphQL(store, query, variables, 10);

  if (!result.ok) {
    return { found: false, error: result.error };
  }

  const edges = result.data?.data?.productVariants?.edges ?? [];
  if (edges.length === 0) {
    return { found: false, error: null };
  }

  const node = edges[0].node;
  if (node.sku.trim().toLowerCase() !== sku.trim().toLowerCase()) {
    return { found: false, error: null };
  }

  const inventoryItemId = gidToNumericId(node.inventoryItem.id);
  const quantities = node.inventoryItem?.inventoryLevel?.quantities ?? [];
  const currentQuantity = quantities.length > 0 ? quantities[0].quantity : 0;

  return {
    found: true,
    inventoryItemId,
    productTitle: node.product?.title ?? '',
    currentQuantity,
    error: null,
  };
}

export type VariantLookup =
  | { found: false }
  | { found: true; inventoryItemId: number; productTitle: string; currentQuantity: number; stocked: boolean };

/**
 * Busca MUCHOS SKU en una sola consulta (un alias de GraphQL por SKU) y trae de
 * una vez la cantidad actual en la sucursal. Devuelve un mapa sku(minúsculas) -> resultado.
 */
export async function findVariantsBySkus(
  store: ShopifyStore,
  skus: string[],
  locationId: number
): Promise<{ ok: boolean; error: string | null; results: Map<string, VariantLookup> }> {
  const results = new Map<string, VariantLookup>();
  if (skus.length === 0) return { ok: true, error: null, results };

  const varDefs = skus.map((_, i) => `$q${i}: String!`).join(', ');
  const fields = skus
    .map(
      (_, i) => `
      v${i}: productVariants(first: 1, query: $q${i}) {
        edges {
          node {
            sku
            inventoryItem {
              id
              inventoryLevel(locationId: $locationId) {
                quantities(names: ["available"]) { quantity }
              }
            }
            product { title }
          }
        }
      }`
    )
    .join('\n');
  const query = `query lookupSkus($locationId: ID!, ${varDefs}) {${fields}\n}`;

  const variables: Record<string, unknown> = { locationId: `gid://shopify/Location/${locationId}` };
  skus.forEach((sku, i) => {
    variables[`q${i}`] = `sku:"${sku.replace(/"/g, '')}"`;
  });

  const res = await shopifyGraphQL(store, query, variables, 10 + skus.length * 8);
  if (!res.ok) return { ok: false, error: res.error, results };

  skus.forEach((sku, i) => {
    const edge = res.data?.data?.[`v${i}`]?.edges?.[0];
    const node = edge?.node;
    if (!node || String(node.sku ?? '').trim().toLowerCase() !== sku.trim().toLowerCase()) {
      results.set(sku.toLowerCase(), { found: false });
      return;
    }
    const level = node.inventoryItem?.inventoryLevel;
    const qtys = level?.quantities ?? [];
    results.set(sku.toLowerCase(), {
      found: true,
      inventoryItemId: gidToNumericId(node.inventoryItem.id),
      productTitle: node.product?.title ?? '',
      currentQuantity: qtys.length > 0 ? qtys[0].quantity : 0,
      stocked: !!level,
    });
  });

  return { ok: true, error: null, results };
}

export type BatchSetItem = { inventoryItemId: number; quantity: number; changeFromQuantity: number };
export type BatchSetResult = { ok: boolean; error: string | null; needsIndividual: boolean };

/**
 * Reemplaza la cantidad de MUCHOS productos en UNA sola llamada. Si Shopify rechaza
 * algunos, se excluyen y el resto se reintenta; lo que no se pueda atribuir con
 * certeza se marca "needsIndividual" para que el llamador lo procese uno por uno.
 */
export async function setInventoryLevelsBatch(
  store: ShopifyStore,
  locationId: number,
  items: BatchSetItem[]
): Promise<BatchSetResult[]> {
  const locationGid = `gid://shopify/Location/${locationId}`;
  const results: BatchSetResult[] = items.map(() => ({ ok: false, error: 'Sin resultado', needsIndividual: false }));
  let active = items.map((_, i) => i);

  const setMutation = `
    mutation setQuantities($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
      inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
        inventoryAdjustmentGroup { createdAt }
        userErrors { field message code }
      }
    }
  `;

  for (let attempt = 0; attempt < 2 && active.length > 0; attempt++) {
    const res = await shopifyGraphQL(
      store,
      setMutation,
      {
        input: {
          name: 'available',
          reason: 'correction',
          quantities: active.map((i) => ({
            inventoryItemId: `gid://shopify/InventoryItem/${items[i].inventoryItemId}`,
            locationId: locationGid,
            quantity: items[i].quantity,
            changeFromQuantity: items[i].changeFromQuantity,
          })),
        },
        idempotencyKey: crypto.randomUUID(),
      },
      10 + active.length * 3
    );

    if (!res.ok) {
      // Fallo de la petición completa (red, permisos, etc.): no tiene caso reintentar uno por uno.
      for (const i of active) results[i] = { ok: false, error: res.error, needsIndividual: false };
      return results;
    }

    const errs: any[] = res.data?.data?.inventorySetQuantities?.userErrors ?? [];
    if (errs.length === 0) {
      for (const i of active) results[i] = { ok: true, error: null, needsIndividual: false };
      return results;
    }

    // ¿Qué posiciones del lote fallaron? Shopify las indica en userErrors[].field
    // (ej. ["input","quantities","3","changeFromQuantity"]).
    const bad = new Map<number, string>();
    let unattributable = false;
    for (const e of errs) {
      const field: string[] = Array.isArray(e.field) ? e.field.map(String) : [];
      const at = field.indexOf('quantities');
      const pos = at >= 0 ? parseInt(field[at + 1], 10) : NaN;
      if (Number.isInteger(pos) && pos >= 0 && pos < active.length) {
        bad.set(pos, e.message);
      } else {
        unattributable = true;
      }
    }

    if (unattributable || bad.size === 0 || attempt === 1) {
      const msg = errs.map((e) => e.message).join('; ');
      for (const i of active) results[i] = { ok: false, error: msg, needsIndividual: true };
      return results;
    }

    for (const [pos, message] of bad) {
      results[active[pos]] = { ok: false, error: message, needsIndividual: false };
    }
    active = active.filter((_, pos) => !bad.has(pos));
  }

  return results;
}

/**
 * Reemplaza (no suma) la cantidad disponible en una sucursal. Solo activa
 * (conecta) el producto a esa sucursal si Shopify avisa que hace falta —
 * no lo hace por adelantado en cada producto, para ahorrar una llamada.
 */
export async function setInventoryLevel(
  store: ShopifyStore,
  locationId: number,
  inventoryItemId: number,
  quantity: number,
  changeFromQuantity: number
): Promise<{ ok: boolean; error: string | null }> {
  const inventoryItemGid = `gid://shopify/InventoryItem/${inventoryItemId}`;
  const locationGid = `gid://shopify/Location/${locationId}`;

  const setMutation = `
    mutation setQuantities($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
      inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
        inventoryAdjustmentGroup { createdAt }
        userErrors { field message code }
      }
    }
  `;

  async function trySet(fromQty: number) {
    return shopifyGraphQL(
      store,
      setMutation,
      {
        input: {
          name: 'available',
          reason: 'correction',
          quantities: [
            {
              inventoryItemId: inventoryItemGid,
              locationId: locationGid,
              quantity,
              changeFromQuantity: fromQty,
            },
          ],
        },
        idempotencyKey: crypto.randomUUID(),
      },
      15
    );
  }

  let setResult = await trySet(changeFromQuantity);

  if (!setResult.ok) {
    return { ok: false, error: setResult.error };
  }

  let setErrors = setResult.data?.data?.inventorySetQuantities?.userErrors ?? [];

  const needsActivation = setErrors.some(
    (e: any) => /not stocked|not found|not active|inactive/i.test(e.message)
  );

  if (needsActivation) {
    const activateMutation = `
      mutation activate($inventoryItemId: ID!, $locationId: ID!, $idempotencyKey: String!) {
        inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) @idempotent(key: $idempotencyKey) {
          inventoryLevel { id }
          userErrors { field message }
        }
      }
    `;
    const activateResult = await shopifyGraphQL(
      store,
      activateMutation,
      { inventoryItemId: inventoryItemGid, locationId: locationGid, idempotencyKey: crypto.randomUUID() },
      10
    );

    if (!activateResult.ok) {
      return { ok: false, error: activateResult.error };
    }
    const activateErrors = activateResult.data?.data?.inventoryActivate?.userErrors ?? [];
    const realActivateErrors = activateErrors.filter(
      (e: any) => !/already active|already exists/i.test(e.message)
    );
    if (realActivateErrors.length > 0) {
      return { ok: false, error: JSON.stringify(realActivateErrors) };
    }

    // Reintentar el set, ahora que sabemos que está recién conectado (parte de 0)
    setResult = await trySet(0);
    if (!setResult.ok) {
      return { ok: false, error: setResult.error };
    }
    setErrors = setResult.data?.data?.inventorySetQuantities?.userErrors ?? [];
  }

  if (setErrors.length > 0) {
    return { ok: false, error: JSON.stringify(setErrors) };
  }

  return { ok: true, error: null };
}
