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
  estimatedCost = 15
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
  if (res.status === 429) {
    await sleep(1500);
    return shopifyGraphQL(store, query, variables, estimatedCost);
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
