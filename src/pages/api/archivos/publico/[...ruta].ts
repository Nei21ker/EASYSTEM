import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { Entorno } from '../../../../server/entorno';
import { leerArchivoPublico } from '../../../../server/servicios/archivos';

export const prerender = false;

/**
 * Fotos de producto, SIN sesión (las ven las pantallas y los tickets). Solo sirve claves `productos/…`; todo lo demás
 * responde 404. Cada foto tiene un nombre único: el navegador la guarda un año.
 */
export const GET: APIRoute = ({ params }) => leerArchivoPublico(env as unknown as Entorno, params.ruta as string);
