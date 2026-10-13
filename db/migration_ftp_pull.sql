-- Ejecuta esto en el SQL Editor de Neon. Es seguro correrlo más de una vez.
-- Agrega el modo "el sistema lee el archivo desde un FTP/SFTP del proveedor"
-- y la tabla que recuerda la última cantidad aplicada de cada SKU (para
-- actualizar solo lo que cambió en cada lectura).

ALTER TABLE feeds ADD COLUMN IF NOT EXISTS ftp_protocol VARCHAR(10);
ALTER TABLE feeds ADD COLUMN IF NOT EXISTS ftp_host VARCHAR(255);
ALTER TABLE feeds ADD COLUMN IF NOT EXISTS ftp_port INT;
ALTER TABLE feeds ADD COLUMN IF NOT EXISTS ftp_user VARCHAR(255);
ALTER TABLE feeds ADD COLUMN IF NOT EXISTS ftp_password VARCHAR(255);
ALTER TABLE feeds ADD COLUMN IF NOT EXISTS ftp_path VARCHAR(500);
ALTER TABLE feeds ADD COLUMN IF NOT EXISTS last_pulled_at TIMESTAMPTZ;
ALTER TABLE feeds ADD COLUMN IF NOT EXISTS last_pull_status TEXT;

CREATE TABLE IF NOT EXISTS feed_snapshot (
    feed_id INT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    sku_key VARCHAR(100) NOT NULL,   -- SKU en minúsculas, para comparar
    sku VARCHAR(100) NOT NULL,
    qty INT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (feed_id, sku_key)
);
