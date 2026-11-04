import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { Entorno } from '../../../server/entorno';
import { respuestaError } from '../../../server/http';
import { estadoCuenta } from '../../../server/servicios/cuenta';

export const prerender = false;

/**
 * Estado de la cuenta de quien pregunta. No usa `conSesion` a propósito: un usuario desactivado o con la sesión
 * cerrada a la fuerza debe recibir el MOTIVO (200), no un error, para llevarlo a la pantalla correcta.
 */
export const GET: APIRoute = async ({ request }) => {
  try {
    return Response.json(await estadoCuenta(env as unknown as Entorno, request));
  } catch (err) {
    return respuestaError(err);
  }
};
