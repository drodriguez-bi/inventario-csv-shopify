-- Ejecuta esto en el SQL Editor de Neon (además de las migraciones anteriores).

ALTER TABLE uploads ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'manual';
-- valores usados: 'manual' (subida desde la pantalla) | 'gifan' (feed automático)

-- upload_items.status ya es VARCHAR libre (no ENUM estricto), así que el nuevo
-- valor 'pending' funciona sin alterar el tipo de columna. Se usa mientras un
-- item del feed automático todavía no ha sido procesado por el cron.
