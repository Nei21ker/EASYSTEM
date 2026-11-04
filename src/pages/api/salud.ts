import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { Entorno } from '../../server/entorno';

// Las rutas de /api corren en el Worker; el resto del sitio sigue siendo estático.
export const prerender = false;

/** Comprueba que D1 y R2 responden. Pública a propósito (no devuelve datos). */
export const GET: APIRoute = async () => {
  const e = env as unknown as Entorno;
  const fila = await e.DB.prepare('SELECT 1 AS uno').first<{ uno: number }>();
  // Solo lectura (head): la ruta es pública y escribir en R2 en cada llamada tendría costo
  let r2 = false;
  try {
    await e.FOTOS_PRIVADAS.head('salud/ping');
    r2 = true;
  } catch {
    r2 = false;
  }
  return Response.json({ ok: true, d1: fila?.uno === 1, r2 });
};
