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

### 8.4 Lo que le das al proveedor

Ese mismo link es al que el proveedor debe mandar una petición `POST` con el
CSV:
```
POST https://tu-dominio.vercel.app/api/feed/9f2a1b7c4e8d...
Content-Type: text/csv

sku,cantidad
ABC-001,25
ABC-002,0
```
También acepta `multipart/form-data` con un campo llamado `file`, por si su
sistema solo sabe subir archivos. Además reconoce automáticamente el formato
real que usa Gifan (columnas `Item-number` y `Ubicado`), así que no necesitas
pedirles que cambien nada de su archivo.

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

## 9. Desarrollo local (opcional)
```bash
npm install
vercel env pull .env.local   # trae las variables desde tu proyecto en Vercel
npm run dev
```
