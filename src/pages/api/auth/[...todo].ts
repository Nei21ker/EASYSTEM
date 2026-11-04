import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { crearAuth } from '../../../server/auth';
import type { Entorno } from '../../../server/entorno';

export const prerender = false;

/** Todas las rutas de Better-Auth (/api/auth/sign-in/email, /api/auth/get-session, /api/auth/sign-out…). */
export const ALL: APIRoute = ({ request }) => crearAuth(env as unknown as Entorno, new URL(request.url).origin).handler(request);
