import { z } from 'zod';
import { conSesion, leerJson } from '../../../server/http';
import { MAX_VENTAS_A_ELIMINAR, eliminarVentas } from '../../../server/servicios/ventas';

export const prerender = false;

/**
 * Elimina las ventas elegidas (administrador y gerente): devuelve al stock las piezas que dejaron vendidas y las quita de los reportes.
 * Con `{ "simular": true }` solo cuenta lo que haría, sin cambiar nada.
 */
export const POST = conSesion(async ({ env, sesion, request }) => {
  const { ids, simular } = await leerJson(request, z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(MAX_VENTAS_A_ELIMINAR), simular: z.boolean().optional() }));
  return eliminarVentas(env, sesion, ids, { simular });
});
