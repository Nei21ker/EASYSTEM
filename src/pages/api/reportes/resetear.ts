import { z } from 'zod';
import { conSesion, leerJson } from '../../../server/http';
import { resetearReportes } from '../../../server/servicios/ventas';

export const prerender = false;

/**
 * Deja en cero los reportes de UN local: borra sus ventas, devoluciones y movimientos de compra y venta (solo el administrador).
 * No cambia el stock. Con `{ "simular": true }` solo cuenta lo que haría.
 */
export const POST = conSesion(async ({ env, sesion, request }) => {
  const { local_id, simular } = await leerJson(request, z.object({ local_id: z.string().min(1).max(100), simular: z.boolean().optional() }));
  return resetearReportes(env, sesion, { localId: local_id, simular });
});
