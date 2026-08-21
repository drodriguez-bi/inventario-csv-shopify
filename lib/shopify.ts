export type ShopifyStore = {
  shop_domain: string;
  access_token: string;
  api_version: string;
};

async function shopifyFetch(
  store: ShopifyStore,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<{ ok: boolean; httpCode: number; data: any; error: string | null }> {
  const url = `https://${store.shop_domain}/admin/api/${store.api_version}/${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': store.access_token,
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  // Rate limit: esperar y reintentar una vez
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1200));
    return shopifyFetch(store, method, path, body);
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return {
    ok: res.ok,
    httpCode: res.status,
    data,
    error: !res.ok ? JSON.stringify(data?.errors ?? data ?? res.statusText) : null,
  };
}

async function shopifyGraphQL(store: ShopifyStore, query: string, variables: Record<string, unknown>) {
  return shopifyFetch(store, 'POST', 'graphql.json', { query, variables });
}

export async function getLocations(
  store: ShopifyStore
): Promise<{ ok: boolean; locations: { id: number; name: string }[]; error: string | null }> {
  const result = await shopifyFetch(store, 'GET', 'locations.json');
  if (!result.ok) {
    return { ok: false, locations: [], error: result.error ?? 'No se pudo conectar con Shopify' };
  }
  const locations = (result.data?.locations ?? []).map((l: any) => ({ id: l.id, name: l.name }));
  return { ok: true, locations, error: null };
}

export async function findVariantBySku(
  store: ShopifyStore,
  sku: string
): Promise<
  | { found: true; inventoryItemId: number; productTitle: string; error: null }
  | { found: false; inventoryItemId?: undefined; productTitle?: undefined; error: string | null }
> {
  const query = `
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
  const result = await shopifyGraphQL(store, query, { q: `sku:"${safeSku}"` });

  if (!result.ok) {
    return { found: false, error: result.error };
  }

  const edges = result.data?.data?.productVariants?.edges ?? [];
  if (edges.length === 0) {
    return { found: false, error: null };
  }

  const node = edges[0].node;
  if (node.sku.trim() !== sku.trim()) {
    return { found: false, error: null };
  }

  const gid: string = node.inventoryItem.id; // gid://shopify/InventoryItem/123456789
  const inventoryItemId = parseInt(gid.split('/').pop() as string, 10);

  return {
    found: true,
    inventoryItemId,
    productTitle: node.product?.title ?? '',
    error: null,
  };
}

export async function setInventoryLevel(
  store: ShopifyStore,
  locationId: number,
  inventoryItemId: number,
  quantity: number
): Promise<{ ok: boolean; error: string | null }> {
  const result = await shopifyFetch(store, 'POST', 'inventory_levels/set.json', {
    location_id: locationId,
    inventory_item_id: inventoryItemId,
    available: quantity,
  });

  if (result.ok) {
    return { ok: true, error: null };
  }

  const errText = result.error ?? '';
  const notConnected =
    result.httpCode === 422 ||
    /not stocked/i.test(errText) ||
    /not found/i.test(errText);

  if (notConnected) {
    const connect = await shopifyFetch(store, 'POST', 'inventory_levels/connect.json', {
      location_id: locationId,
      inventory_item_id: inventoryItemId,
    });

    if (connect.ok) {
      const retry = await shopifyFetch(store, 'POST', 'inventory_levels/set.json', {
        location_id: locationId,
        inventory_item_id: inventoryItemId,
        available: quantity,
      });
      if (retry.ok) {
        return { ok: true, error: null };
      }
      return { ok: false, error: retry.error };
    }
  }

  return { ok: false, error: errText };
}
