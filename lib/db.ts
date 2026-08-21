import { neon } from '@neondatabase/serverless';

// Vercel Postgres (integración nativa con Neon) expone la cadena de conexión
// como DATABASE_URL. Si en tu proyecto quedó como POSTGRES_URL, también funciona.
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error(
    'Falta la variable de entorno DATABASE_URL (o POSTGRES_URL). Configúrala en Vercel > Storage.'
  );
}

export const sql = neon(connectionString);
