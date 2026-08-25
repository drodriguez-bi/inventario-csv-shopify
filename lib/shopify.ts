import crypto from 'crypto';

export type ShopifyStore = {
  shop_domain: string;
  access_token: string;
  api_version: string;
};

async function shopifyGraphQL(
  store: ShopifyStore,
  query: string,
  variables: Record<string, unknown>
): Promise<{ ok: boolean; data: any; error: string | null }> {
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

  // Rate limit: esperar y reintentar una vez
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1200));
    return shopifyGraphQL(store, query, variables);
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    return { ok: false, data: null, error: JSON.stringify(data ?? res.statusText) };
  }

  // Errores a nivel GraphQL (query/mutation inválida, permisos, etc.)
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
  if (node.sku.trim().toLowerCase() !== sku.trim().toLowerCase()) {
    return { found: false, error: null };
  }

  const inventoryItemId = gidToNumericId(node.inventoryItem.id);

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
  const inventoryItemGid = `gid://shopify/InventoryItem/${inventoryItemId}`;
  const locationGid = `gid://shopify/Location/${locationId}`;

  // 1) Asegurar que el producto está "activado" (conectado) en esa sucursal.
  //    Si ya lo estaba, Shopify simplemente no hace nada (no da error).
  const activateMutation = `
    mutation activate($inventoryItemId: ID!, $locationId: ID!, $idempotencyKey: String!) {
      inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) @idempotent(key: $idempotencyKey) {
        inventoryLevel { id }
        userErrors { field message }
      }
    }
  `;
  const activateResult = await shopifyGraphQL(store, activateMutation, {
    inventoryItemId: inventoryItemGid,
    locationId: locationGid,
    idempotencyKey: crypto.randomUUID(),
  });

  if (!activateResult.ok) {
    return { ok: false, error: activateResult.error };
  }
  const activateErrors = activateResult.data?.data?.inventoryActivate?.userErrors ?? [];
  if (activateErrors.length > 0) {
    // Si el error es "ya está activo" lo ignoramos; cualquier otro, lo reportamos.
    const realErrors = activateErrors.filter(
      (e: any) => !/already active|already exists/i.test(e.message)
    );
    if (realErrors.length > 0) {
      return { ok: false, error: JSON.stringify(realErrors) };
    }
  }

  // 2) Consultar la cantidad actual (ahora es obligatoria para el reemplazo,
  //    Shopify la usa como verificación de que no cambió entre medio).
  const currentQtyQuery = `
    query getCurrentQty($inventoryItemId: ID!, $locationId: ID!) {
      inventoryItem(id: $inventoryItemId) {
        inventoryLevel(locationId: $locationId) {
          quantities(names: ["available"]) {
            quantity
          }
        }
      }
    }
  `;
  const currentQtyResult = await shopifyGraphQL(store, currentQtyQuery, {
    inventoryItemId: inventoryItemGid,
    locationId: locationGid,
  });

  if (!currentQtyResult.ok) {
    return { ok: false, error: currentQtyResult.error };
  }

  const quantities = currentQtyResult.data?.data?.inventoryItem?.inventoryLevel?.quantities ?? [];
  const changeFromQuantity = quantities.length > 0 ? quantities[0].quantity : 0;

  // 3) Reemplazar (no sumar) la cantidad disponible en esa sucursal.
  const setMutation = `
    mutation setQuantities($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
      inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
        inventoryAdjustmentGroup { createdAt }
        userErrors { field message }
      }
    }
  `;
  const setResult = await shopifyGraphQL(store, setMutation, {
    input: {
      name: 'available',
      reason: 'correction',
      quantities: [
        {
          inventoryItemId: inventoryItemGid,
          locationId: locationGid,
          quantity,
          changeFromQuantity,
        },
      ],
    },
    idempotencyKey: crypto.randomUUID(),
  });

  if (!setResult.ok) {
    return { ok: false, error: setResult.error };
  }

  const setErrors = setResult.data?.data?.inventorySetQuantities?.userErrors ?? [];
  if (setErrors.length > 0) {
    return { ok: false, error: JSON.stringify(setErrors) };
  }

  return { ok: true, error: null };
}
