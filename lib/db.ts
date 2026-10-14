import { neon } from '@neondatabase/serverless';
import type { NeonQueryFunction } from '@neondatabase/serverless';

// IMPORTANTE: la conexión se crea de forma perezosa (solo al ejecutar la
// primera consulta en tiempo de ejecución), no al importar este módulo.
// Si se creara al importar, Next.js fallaría en el build al "recolectar
// datos de página" de cada ruta API, incluso sin ejecutar ninguna consulta.
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

  cached = neon(connectionString);
  return cached;
}

// Se exporta como función normal (no como valor ya creado) para poder usarse
// exactamente igual que antes: sql`SELECT ...`
export function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  return getClient()(strings, ...values);
}
