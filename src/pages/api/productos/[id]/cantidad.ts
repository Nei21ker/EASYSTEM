import { z } from 'zod';
import { conSesion, leerJson } from '../../../../server/http';
import { establecerCantidadEnCarga } from '../../../../server/servicios/catalogo';

export const prerender = false;

/**
 * Corrige a mano la cantidad de un producto en el Local Servicio Técnico mientras se carga su inventario (sin foto o sin precio),
 * SIN dejar movimientos. Administrador, gerente y encargado de ese local.
 */
export const POST = conSesion(async ({ env, sesion, request, params }) => {
  const datos = await leerJson(request, z.object({ localId: z.string().min(1).max(100), cantidad: z.number().int().min(0).max(500) }));
  return establecerCantidadEnCarga(env, sesion, params.id!, datos.localId, datos.cantidad);
});
