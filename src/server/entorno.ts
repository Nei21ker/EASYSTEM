// Bindings del Worker (ver wrangler.jsonc). Las rutas leen `env` de 'cloudflare:workers' y lo pasan a los servicios.
export interface Entorno {
  DB: D1Database;
  FOTOS_PUBLICAS: R2Bucket;
  FOTOS_PRIVADAS: R2Bucket;
  BETTER_AUTH_SECRET: string;
  /** Base pública de las fotos de producto (sin barra final) */
  URL_FOTOS_PUBLICAS: string;
  /** Zona horaria del negocio (define dónde empieza y termina "el día" del cuadre). Por defecto America/Caracas */
  ZONA_HORARIA?: string;
}
