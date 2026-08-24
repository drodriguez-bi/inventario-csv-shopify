-- Ejecuta esto en el SQL Editor de Neon SOLO SI ya habías corrido el schema.sql
-- original antes (es decir, ya tienes la tabla `stores` creada con la columna
-- access_token como obligatoria). Si vas a crear la base de datos desde cero,
-- ignora este archivo y usa directamente schema.sql (ya viene actualizado).

ALTER TABLE stores ADD COLUMN IF NOT EXISTS client_id VARCHAR(255);
ALTER TABLE stores ADD COLUMN IF NOT EXISTS client_secret VARCHAR(255);
ALTER TABLE stores ADD COLUMN IF NOT EXISTS oauth_state VARCHAR(64);
ALTER TABLE stores ALTER COLUMN access_token DROP NOT NULL;
