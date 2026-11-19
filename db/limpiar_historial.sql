-- LIMPIEZA DEL HISTORIAL — córrelo en el SQL Editor de Neon.
-- Las opciones que BORRAN están comentadas (con --): si corres el archivo completo solo se ejecutan
-- la consulta de tamaños y el índice. Para borrar, quita los -- de UNA sola opción (2A o 2B).
-- Nada de esto toca tiendas, feeds, usuarios ni feed_snapshot (la memoria de cantidades).

-- ─── 1) ¿Qué tabla está ocupando el espacio? (solo consulta, no borra nada) ───────────────
SELECT relname AS tabla,
       pg_size_pretty(pg_total_relation_size(relid)) AS tamano,
       n_live_tup AS filas_aprox
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC;

-- ─── 2A) Borrar TODO el historial (lo más rápido; libera el espacio de inmediato) ─────────
-- No se puede deshacer. Lo que estaba "pendiente" en la cola se pierde, pero no pasa nada:
-- en la siguiente lectura el sistema compara contra feed_snapshot y vuelve a encolar lo que
-- no se aplicó.
-- TRUNCATE upload_items, uploads RESTART IDENTITY;

-- ─── 2B) O conservar solo los últimos N días (cambia el 7 por los días que quieras) ───────
-- Es más lento que el TRUNCATE si hay muchísimas filas; si se tarda, córrelo varias veces.
-- DELETE FROM uploads WHERE started_at < NOW() - INTERVAL '7 days';

-- ─── 3) Índice para que la limpieza automática por fecha sea rápida (una sola vez) ────────
CREATE INDEX IF NOT EXISTS idx_uploads_started_at ON uploads(started_at);
