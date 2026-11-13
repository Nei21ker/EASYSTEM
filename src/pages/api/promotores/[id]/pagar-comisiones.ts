import { esquemaPagarComisiones } from '../../../../server/esquemas';
import { conSesion, leerJson } from '../../../../server/http';
import { pagarComisionesPromotor } from '../../../../server/servicios/pendientes';

export const prerender = false;

/** Marca como pagadas, de una vez, las comisiones pendientes que se le muestran de un promotor (administrador, gerente y contador). */
export const POST = conSesion(async ({ env, sesion, request, params }) => {
  const datos = await leerJson(request, esquemaPagarComisiones);
  return pagarComisionesPromotor(env, sesion, params.id as string, datos.ids, datos.nota);
});
