-- Ejecutar una sola vez contra tu base de datos Postgres de Vercel
-- (Storage tab > tu base de datos > Query, o con `psql "$POSTGRES_URL"`)

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stores (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    shop_domain VARCHAR(255) NOT NULL, -- ej: stanley-1913-mx.myshopify.com
    client_id VARCHAR(255),            -- de tu app en Shopify Partners (Client ID)
    client_secret VARCHAR(255),        -- de tu app en Shopify Partners (Client Secret)
    access_token VARCHAR(255),         -- se llena solo, tras completar la conexión OAuth
    oauth_state VARCHAR(64),           -- uso interno, temporal, durante la conexión
    api_version VARCHAR(20) NOT NULL DEFAULT '2024-01',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS uploads (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id),
    store_id INT NOT NULL REFERENCES stores(id),
    location_id BIGINT NOT NULL,
    location_name VARCHAR(255),
    filename VARCHAR(255),
    total_rows INT DEFAULT 0,
    success_count INT DEFAULT 0,
    not_found_count INT DEFAULT 0,
    error_count INT DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'processing', -- processing | completed | failed
    started_at TIMESTAMPTZ DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS upload_items (
    id SERIAL PRIMARY KEY,
    upload_id INT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    sku VARCHAR(100) NOT NULL,
    requested_qty INT NOT NULL,
    status VARCHAR(20) NOT NULL, -- success | not_found | error
    product_title VARCHAR(255),
    message TEXT
);

CREATE INDEX IF NOT EXISTS idx_upload_items_upload_id ON upload_items(upload_id);
CREATE INDEX IF NOT EXISTS idx_upload_items_sku ON upload_items(sku);
