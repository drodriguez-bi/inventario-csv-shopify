import { neon } from '@neondatabase/serverless';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { unstable_noStore as noStore } from 'next/cache';

// IMPORTANTE 1 — conexión perezosa: se crea al ejecutar la primera consulta, no al importar
// este módulo. Si se creara al importar, Next.js fallaría en el build al "recolectar datos de
// página" de cada ruta API, incluso sin ejecutar ninguna consulta.
//
// IMPORTANTE 2 — SIN CACHÉ: Next.js 14 guarda en su "Data Cache" las peticiones fetch, y este
// driver consulta la base de datos con fetch (HTTP). Sin `cache: 'no-store'`, una consulta
// idéntica (mismo SQL y mismos parámetros) devolvía la respuesta VIEJA guardada en vez de volver
// a preguntarle a la base de datos, incluso con `dynamic = 'force-dynamic'`, y ese caché sobrevive
// entre despliegues. Resultado: pantallas y rutas mostrando datos de hace horas.
let cached: NeonQueryFunction<false, false> | null = null;

function getClient(): NeonQueryFunction<false, false> {
  if (cached) return cached;

  // Vercel Postgres (integración nativa con Neon) expone la cadena de conexión
  // como DATABASE_URL. Si en tu proyecto quedó como POSTGRES_URL, también funciona.
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

  if (!connectionString) {
    throw new Error(
      'Falta la variable de entorno DATABASE_URL (o POSTGRES_URL). Configúrala en Vercel > Storage.'
    );
  }

  cached = neon(connectionString, { fetchOptions: { cache: 'no-store' } });
  return cached;
}

// Se exporta como función normal (no como valor ya creado) para poder usarse
// exactamente igual que antes: sql`SELECT ...`
export function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  try {
    noStore(); // segunda barrera: la petición actual no usa el caché de datos de Next.js
  } catch {
    // fuera de una petición de Next.js (scripts, pruebas) no hace falta
  }
  return getClient()(strings, ...values);
}
