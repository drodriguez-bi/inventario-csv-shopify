# Sistema de Carga de Inventario por SKU (reemplazo, no suma) — Vercel

Sistema independiente en **Next.js + Postgres**, pensado para desplegarse en
Vercel. Sube un CSV (`sku`, `cantidad`) y **reemplaza** el inventario de una
sucursal específica de Shopify (usa `inventory_levels/set`, no `adjust`).

## 1. Requisitos
- Cuenta de Vercel (gratis sirve para empezar; para CSVs grandes conviene Pro
  por el límite de duración de funciones).
- Una app personalizada en Shopify Partners con permisos:
  `read_products, read_locations, read_inventory, write_inventory`.
- Node.js 18+ si quieres correrlo en local antes de desplegar.

## 2. Poner el código en GitHub
1. Crea un repositorio nuevo (puede ser privado) y sube todo este contenido.
   ```bash
   cd inventory-vercel
   git init
   git add .
   git commit -m "Sistema de carga de inventario"
   git remote add origin <URL_DE_TU_REPO>
   git push -u origin main
   ```

## 3. Crear el proyecto en Vercel
1. En vercel.com → **Add New > Project** → importa el repositorio.
2. Framework Preset: Vercel lo detecta solo como **Next.js**. No cambies nada.
3. Antes de dar deploy (o después, no importa), ve a la pestaña **Storage**
   del proyecto → **Create Database** → **Postgres** → sigue el asistente y
   conéctala al proyecto. Esto crea automáticamente las variables
   `POSTGRES_URL` y `POSTGRES_URL_NON_POOLING`.
4. Ve a **Settings > Environment Variables** y agrega:
   - `AUTH_SECRET` = una cadena aleatoria larga (genera una con
     `openssl rand -base64 32` en tu terminal).
5. Da clic en **Deploy**.

## 4. Cargar el esquema de base de datos
1. Ve a **Storage > tu base de datos > Query** (o conéctate con `psql` usando
   el `POSTGRES_URL_NON_POOLING` que te dio Vercel).
2. Pega y ejecuta el contenido de `db/schema.sql`.

## 5. Primer uso
1. Entra a la URL que te dio Vercel (`https://tu-proyecto.vercel.app`).
2. Como no hay usuarios todavía, te va a pedir crear el primer usuario
   administrador. Ese formulario se autodeshabilita después de usarse una vez.
3. Inicia sesión y ve a **Tiendas** para conectar cada tienda Shopify que vayas
   a administrar (ver sección 5.1 para crear la app en Shopify Partners).

### 5.1 Crear la app en Shopify Partners y conectarla

Shopify ya no entrega un token fijo directo al crear una app — ahora usa OAuth
(Client ID + Client Secret), así que el sistema hace ese "handshake" por ti.

1. Entra a [partners.shopify.com](https://partners.shopify.com) → **Apps** →
   **Create app**.
2. Configúrala con distribución **Custom** (para una tienda específica, no
   pública en el App Store).
3. En **Configuration > Admin API integration**, activa estos scopes:
   `read_products`, `read_locations`, `read_inventory`, `write_inventory`.
4. En **Configuration > URLs**, agrega en **Allowed redirection URL(s)**:
   ```
   https://tu-proyecto.vercel.app/api/shopify/callback
   ```
   (usa tu dominio real de Vercel).
5. Guarda. Ve a la pestaña **API credentials** — ahí verás **Client ID** y
   **Client Secret**. Cópialos (el secret solo se muestra completo ahí).
6. En tu sistema, ve a **Tiendas** → llena el formulario con el nombre, el
   dominio `.myshopify.com` de la tienda, y ese Client ID / Client Secret →
   **Guardar tienda**.
7. En la tabla de tiendas, la nueva tienda aparece con estatus **Pendiente** y
   un botón **Conectar con Shopify** — dale clic.
8. Te manda a una pantalla de Shopify pidiendo autorizar los permisos en esa
   tienda → acepta.
9. Te regresa automáticamente a **Tiendas**, ahora con estatus **Conectada**.
   Internamente el sistema ya guardó el access token — no tienes que copiar
   nada más.
10. Dale **Probar conexión** a la tienda: pregunta a Shopify de verdad (nombre de la tienda y
    sucursales) y te dice en pantalla si el token falta, si Shopify lo rechaza, o si falta un
    permiso. Si algo falla al autorizar, el motivo aparece en rojo en la pantalla de Tiendas.

## 6. Uso normal
1. **Nueva carga** → elige la tienda → el sistema trae automáticamente las
   sucursales (locations) de esa tienda vía API → elige la sucursal correcta.
2. Sube el CSV con columnas `sku` y `cantidad` (también acepta `quantity` o
   `qty`), por ejemplo:
   ```csv
   sku,cantidad
   ABC-001,25
   ABC-002,0
   XYZ-100,10
   ```
3. El CSV se procesa **en lotes desde el navegador** (10 filas por lote) para
   evitar los límites de tiempo de las funciones serverless de Vercel. Verás
   una barra de progreso en vivo con actualizados / no encontrados / errores
   mientras se procesa.
4. Al terminar, te lleva al reporte completo con filtros por estatus.
5. **Historial** guarda todas las cargas anteriores con su reporte.

## 7. Notas técnicas
- **Por qué por lotes:** las funciones serverless de Vercel tienen un límite
  de duración (10-60s en Hobby, hasta 300s en Pro). Procesar todo el CSV en
  una sola petición podría truncarse en archivos grandes. Por eso el
  navegador llama a `/api/upload/process-batch` repetidamente con 10 filas
  cada vez — cada lote es una función corta e independiente, y de paso eso es
  lo que te da el estatus en vivo.
- **Rate limit de Shopify:** hay una pausa de ~600ms entre SKUs dentro de
  cada lote para respetar el límite de la API REST (~2 req/seg).
- **Tiempo estimado:** cuenta aproximadamente 1.2s por SKU (búsqueda +
  actualización). Para 1,000 SKUs son ~20 minutos con la pestaña abierta.
  Si sueles subir catálogos muy grandes, se puede mover el procesamiento a
  una cola en segundo plano (Vercel Cron + Queue) para que no dependa de
  mantener la pestaña abierta — avísame si lo necesitas.
- **Usuarios:** solo hay un administrador por defecto. Si necesitas más,
  se agregan directamente en la tabla `users` con un hash generado por
  `bcrypt.hash()`.
- Los access tokens de Shopify se guardan en la base de datos Postgres; el
  acceso a esa base debe quedar restringido solo a este proyecto.

## 8. Feeds automáticos (integración con proveedores como Gifan)

Además de la carga manual, el sistema te deja crear **feeds**: links únicos,
cada uno atado a una tienda y sucursal específica, para que un proveedor
externo (Gifan u otro) suba su inventario directamente — sin login, sin que
tú tengas que subir nada a mano. El archivo se procesa solo, en segundo plano.

### 8.1 Configurar la variable de entorno del cron

En Vercel → Settings → Environment Variables, agrega:

- `CRON_SECRET` — una clave secreta larga que tú inventas (ej. genera una con
  `openssl rand -hex 24`). Protege el endpoint que procesa la cola en segundo
  plano.

Después de agregarla, espera al siguiente deployment (o haz push de un cambio
cualquiera para que se recoja).

### 8.2 Correr la migración de base de datos

En el SQL Editor de Neon, ejecuta el contenido de `db/migration_feeds.sql`
(si tu base ya existía antes de este cambio).

### 8.3 Crear un feed

1. En el sistema, ve a **Feeds** (en el menú superior).
2. Llena el formulario: un nombre para identificarlo (ej. "Gifan"), la tienda,
   y la sucursal — igual que cuando haces una carga manual.
3. Dale **Crear feed**.
4. En la lista de abajo aparece el link generado — dale clic en **Copiar**.

Ese link se ve así:
```
https://tu-dominio.vercel.app/api/feed/9f2a1b7c4e8d...
```
La parte larga después de `/feed/` es la clave secreta — nadie puede usar el
link sin conocerla exacta.

### 8.4 Tres formas de conectar un feed, según quién lo use

**a) Página web (para una persona, sin conocimientos técnicos):**
El link que aparece primero en cada feed — se abre en cualquier navegador,
se elige el archivo con el mouse, y se le da clic a "Subir archivo". Es lo
que le das a alguien como el contacto de Gifan que usa FileZilla/Windows y no
programa nada.

**b) Link técnico simple (token en la URL):**
Para pruebas rápidas con `curl` o Postman:
```
POST https://tu-dominio.vercel.app/api/feed/9f2a1b7c4e8d...
Content-Type: text/csv

sku,cantidad
ABC-001,25
ABC-002,0
```

**c) API recomendada para integraciones automáticas (token en header):**
Si el proveedor tiene su propio sistema/desarrollador, esta es la opción más
correcta — el token va en el header `Authorization`, no en la URL (más
estándar y evita que la clave quede expuesta en logs de URLs):
```
POST https://tu-dominio.vercel.app/api/feed-inbox
Authorization: Bearer 9f2a1b7c4e8d...
Content-Type: text/csv

sku,cantidad
ABC-001,25
```

Las tres opciones aceptan también `multipart/form-data` con un campo llamado
`file`. Y las tres reconocen automáticamente el formato real que usa Gifan
(columnas `Item-number` y `Ubicado`), así que no necesitas pedirles que
cambien nada de su archivo.

### 8.4.1 Validaciones que aplica el sistema

- Solo acepta archivos `.csv` (rechaza otros tipos con un error claro).
- Exige que existan las columnas de SKU y cantidad.
- Ignora (sin tronar) filas con cantidad negativa o inválida, y te avisa
  cuántas fueron.
- Si el archivo trae el mismo SKU repetido varias veces, usa la última
  aparición y te avisa cuántos duplicados encontró.
- Límite de 20,000 filas por archivo, como control de cordura.

### 8.5 Procesamiento: al instante, no espera al cron

En el momento en que el proveedor sube el archivo, el sistema **empieza a
procesarlo de inmediato**, dentro de esa misma petición (hasta ~35 filas
antes de responder). Si el archivo trae más filas que eso, el resto se
termina solo en los minutos siguientes — el límite real de qué tan rápido se
puede ir es de la propia API de Shopify (respeta un límite de velocidad, así
que actualizar cientos de productos toma varios minutos sin importar qué tan
bien esté armado el sistema).

Para que ese resto se termine en minutos y no esperar hasta el cron una vez
al día (límite del plan Hobby gratuito), configura un disparador externo
gratuito como [cron-job.org](https://cron-job.org) apuntando cada 1-2 minutos
a:
```
GET https://tu-dominio.vercel.app/api/cron/process-feed?token=TU_CRON_SECRET
```
El Cron Job nativo de Vercel (en `vercel.json`, una vez al día) queda como
respaldo por si el disparador externo llegara a fallar algún día.

### 8.6 Ver el resultado

Las cargas de cada feed aparecen en **Historial** igual que las manuales,
marcadas con la etiqueta **"Automática (nombre del feed)"** — puedes entrar
al detalle para ver en tiempo real cuántas ya se actualizaron mientras el
resto se sigue procesando.

### 8.7 Administrar feeds

Desde la misma pantalla de **Feeds** puedes crear tantos como necesites (uno
por proveedor, o varios para distintas tiendas/sucursales) y eliminarlos —
al eliminar uno, ese link deja de funcionar de inmediato.

### 8.8 Feeds que LEEN de un FTP/SFTP (el proveedor ya tiene su servidor)

Cuando el proveedor ya publica su archivo en un servidor FTP/SFTP (como Gifan, que
lo refresca cada 5 minutos), el sistema va a leerlo por su cuenta:

1. Corre `db/migration_ftp_pull.sql` en el SQL Editor de Neon (una sola vez).
2. En **Feeds → Crear nuevo feed**, elige *"El sistema lo lee de un servidor FTP/SFTP del
   proveedor"* y captura protocolo, servidor, usuario y contraseña. Deja "Archivo o carpeta"
   vacío para que tome el `.csv` más reciente de la raíz (o escribe la ruta exacta).
3. Dale **Leer ahora** en la tarjeta del feed: conecta, descarga y muestra el resultado
   (o el error exacto si no pudo conectarse). La primera lectura encola todos los SKU.
4. Para que se lea solo cada 5 minutos, configura un cron externo (gratis, ej.
   [cron-job.org](https://cron-job.org)) que haga `GET` cada 5 minutos a:
   ```
   https://tu-dominio.vercel.app/api/cron/pull-feeds?token=TU_CRON_SECRET
   ```
   La dirección responde en pocos segundos y sigue procesando Shopify en segundo plano
   (hasta ~45 s por llamada), así que no choca con el límite de 30 s de cron-job.org.
   El procesamiento va por bloques de 50 productos (una búsqueda y una escritura por
   bloque, en vez de una llamada por producto), por lo que una carga inicial de cientos
   de SKU debería terminar en pocas llamadas. Si queda algo pendiente, la siguiente
   llamada lo continúa.
   El cron nativo de Vercel en `vercel.json` corre una vez al día como respaldo (el plan
   Hobby no permite más seguido; con plan Pro se puede cambiar a `*/5 * * * *`).

**Mantenimiento:** si en el historial una carga muestra cada SKU repetido (por ejemplo
3,688 filas cuando el archivo trae 922), corre `db/migration_dedupe_items.sql` en Neon: borra
las copias, recalcula los contadores y pone un candado para que una carga nunca pueda tener
el mismo SKU dos veces.

**Qué hace en cada lectura:** descarga el archivo, lo compara contra la última cantidad
aplicada de cada SKU, y manda a Shopify **solo los que cambiaron**. Si Shopify ya tiene esa
cantidad, ni siquiera escribe. Si el archivo cambia otra vez antes de terminar de procesar,
lo pendiente viejo queda como "Reemplazado" y se usa lo más reciente. Cada lectura con
cambios aparece en **Historial** como carga automática; las lecturas sin cambios no generan
registro (solo actualizan "Última lectura" en la tarjeta del feed).

**Formato del archivo:** acepta con encabezados (`sku`/`Item-number` y
`cantidad`/`qty`/`Ubicado`) o sin encabezados (2 columnas: SKU, cantidad).

**Notas:**
- Usuario y contraseña del FTP se guardan en la base de datos (igual que los tokens de
  Shopify) y nunca se muestran de nuevo en pantalla.
- Un SKU que Shopify no encuentra se registra y no se reintenta hasta que su cantidad
  cambie. Un SKU que da error al escribir sí se reintenta en cada lectura.
- Vercel no tiene IP fija: si el servidor del proveedor solo acepta conexiones desde IPs
  autorizadas, no podrá conectarse.

## 8.9 Diagnóstico: ¿qué base de datos y qué tiendas ve el sistema?

Con tu sesión iniciada, abre `https://tu-dominio.vercel.app/api/debug/db`. Muestra el servidor de
base de datos que usa el sistema (sin usuario ni contraseña) y las tiendas que ve, con el largo de
cada token (nunca el token). Sirve para comparar contra lo que ves en el SQL Editor de Neon: si el
servidor o las tiendas no coinciden, el sistema y el editor están mirando bases distintas.

### Nota técnica: las consultas a la base de datos nunca usan caché

Next.js 14 guarda en su caché de datos las peticiones `fetch`, y el driver de Neon consulta por
HTTP con `fetch`. Aun con `dynamic = 'force-dynamic'`, una consulta idéntica devolvía la respuesta
vieja guardada, y ese caché sobrevive entre despliegues (síntomas: una tienda que sigue "sin token"
después de conectarla, "Última lectura" que no avanza, contadores del historial desfasados).
`lib/db.ts` ahora manda cada consulta con `cache: 'no-store'` y `noStore()`. No quites eso.

## 9. Desarrollo local (opcional)
```bash
npm install
vercel env pull .env.local   # trae las variables desde tu proyecto en Vercel
npm run dev
```
