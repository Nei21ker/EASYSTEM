import { z } from 'zod';
import { conSesion, leerJson } from '../../../server/http';
import { resetearReportes } from '../../../server/servicios/ventas';

export const prerender = false;

/**
 * Deja los reportes en cero: borra las ventas, las devoluciones y los movimientos de compra y venta (solo el administrador).
 * No cambia el stock. Con `{ "simular": true }` solo cuenta lo que haría.
 */
export const POST = conSesion(async ({ env, sesion, request }) => {
  const { simular } = await leerJson(request, z.object({ simular: z.boolean().optional() }));
  return resetearReportes(env, sesion, { simular });
});
