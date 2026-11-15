import { z } from 'zod';
import { conSesion, leerJson } from '../../../server/http';
import { resetearVentas } from '../../../server/servicios/ventas';

export const prerender = false;

/**
 * Borra las ventas y devoluciones de UN local y devuelve al stock las piezas vendidas (solo el administrador).
 * Con `{ "simular": true }` solo cuenta lo que haría, sin cambiar nada.
 */
export const POST = conSesion(async ({ env, sesion, request }) => {
  const { local_id, simular } = await leerJson(request, z.object({ local_id: z.string().min(1).max(100), simular: z.boolean().optional() }));
  return resetearVentas(env, sesion, { localId: local_id, simular });
});
