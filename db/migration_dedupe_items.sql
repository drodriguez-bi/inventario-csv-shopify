-- Ejecuta esto UNA vez en el SQL Editor de Neon. Es seguro correrlo más de una vez.
--
-- 1) Limpia las filas repetidas dentro de una misma carga: de cada SKU conserva la fila
--    más antigua (la primera, que es la que realmente se aplicó) y borra las copias.
-- 2) Recalcula los contadores de todas las cargas con lo que quedó.
-- 3) Pone un candado para que una carga nunca vuelva a tener el mismo SKU dos veces.

DELETE FROM upload_items a
USING upload_items b
WHERE a.upload_id = b.upload_id
  AND lower(a.sku) = lower(b.sku)
  AND a.id > b.id;

UPDATE uploads u
SET success_count   = c.success,
    not_found_count = c.not_found,
    error_count     = c.error
FROM (
  SELECT upload_id,
         COUNT(*) FILTER (WHERE status = 'success')   AS success,
         COUNT(*) FILTER (WHERE status = 'not_found') AS not_found,
         COUNT(*) FILTER (WHERE status = 'error')     AS error
  FROM upload_items
  GROUP BY upload_id
) c
WHERE c.upload_id = u.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_upload_items_upload_sku
  ON upload_items (upload_id, lower(sku));
