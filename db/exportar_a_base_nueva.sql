-- MIGRAR A UNA BASE NUEVA: copia solo lo importante (usuarios, tiendas con su conexión a Shopify,
-- y feeds con su FTP). NO copia el historial de cargas, que es lo que llenó la base.
--
-- 1) Corre ESTE archivo en el SQL Editor de la base VIEJA. Devuelve UNA sola celda de texto
--    llamada script_para_la_base_nueva.
-- 2) Copia el contenido de esa celda completa.
-- 3) En el SQL Editor de la base NUEVA (donde ya corriste db/schema.sql), pégalo y córrelo.
--
-- OJO: el resultado trae tokens y contraseñas en texto. No lo pegues en chats ni lo guardes.

SELECT concat_ws(E'\n',
  (SELECT 'INSERT INTO users (id, username, password_hash, created_at) VALUES '
          || string_agg(format('(%L,%L,%L,%L)', id, username, password_hash, created_at), ',') || ';'
     FROM users),
  (SELECT 'INSERT INTO stores (id, name, shop_domain, client_id, client_secret, access_token, api_version, created_at) VALUES '
          || string_agg(format('(%L,%L,%L,%L,%L,%L,%L,%L)', id, name, shop_domain, client_id, client_secret, access_token, api_version, created_at), ',') || ';'
     FROM stores),
  (SELECT 'INSERT INTO feeds (id, name, store_id, location_id, location_name, token, ftp_protocol, ftp_host, ftp_port, ftp_user, ftp_password, ftp_path, created_at) VALUES '
          || string_agg(format('(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)', id, name, store_id, location_id, location_name, token, ftp_protocol, ftp_host, ftp_port, ftp_user, ftp_password, ftp_path, created_at), ',') || ';'
     FROM feeds),
  'SELECT setval(pg_get_serial_sequence(''users'', ''id''),  COALESCE((SELECT MAX(id) FROM users), 1));',
  'SELECT setval(pg_get_serial_sequence(''stores'', ''id''), COALESCE((SELECT MAX(id) FROM stores), 1));',
  'SELECT setval(pg_get_serial_sequence(''feeds'', ''id''),  COALESCE((SELECT MAX(id) FROM feeds), 1));'
) AS script_para_la_base_nueva;
