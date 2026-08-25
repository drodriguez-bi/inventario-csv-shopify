-- Ejecuta esto en el SQL Editor de Neon (reemplaza el enfoque anterior de
-- variables de entorno fijas GIFAN_STORE_ID/GIFAN_LOCATION_ID/GIFAN_FEED_TOKEN,
-- que ya NO se usan si aplicas esta migración).

CREATE TABLE IF NOT EXISTS feeds (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    store_id INT NOT NULL REFERENCES stores(id),
    location_id BIGINT NOT NULL,
    location_name VARCHAR(255),
    token VARCHAR(64) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE uploads ADD COLUMN IF NOT EXISTS feed_id INT REFERENCES feeds(id);
ALTER TABLE uploads ALTER COLUMN user_id DROP NOT NULL;
