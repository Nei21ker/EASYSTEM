import { z } from 'zod';
import { conSesion, leerJson } from '../../../server/http';
import { resetearVentas } from '../../../server/servicios/ventas';

export const prerender = false;

/**
 * Borra todas las ventas y devoluciones y devuelve al stock las piezas vendidas (solo el administrador).
 * Con `{ "simular": true }` solo cuenta lo que haría, sin cambiar nada.
 */
export const POST = conSesion(async ({ env, sesion, request }) => {
  const { simular } = await leerJson(request, z.object({ simular: z.boolean().optional() }));
  return resetearVentas(env, sesion, { simular });
});
