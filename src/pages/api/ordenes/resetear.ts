import { z } from 'zod';
import { conSesion, leerJson } from '../../../server/http';
import { resetearServicioTecnico } from '../../../server/servicios/ordenes';

export const prerender = false;

/**
 * Borra las órdenes de servicio de UN local y devuelve al inventario los repuestos que usaron (solo el administrador).
 * Con `{ "simular": true }` solo cuenta lo que haría, sin cambiar nada.
 */
export const POST = conSesion(async ({ env, sesion, request }) => {
  const { local_id, simular } = await leerJson(request, z.object({ local_id: z.string().min(1).max(100), simular: z.boolean().optional() }));
  return resetearServicioTecnico(env, sesion, { localId: local_id, simular });
});
