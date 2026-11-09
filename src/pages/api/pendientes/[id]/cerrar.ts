import { esquemaCerrarPendiente } from '../../../../server/esquemas';
import { conSesion, leerJson } from '../../../../server/http';
import { cerrarPendiente } from '../../../../server/servicios/pendientes';

export const prerender = false;

/** Marca el pendiente como pagado, o lo anula si fue un error. */
export const POST = conSesion(async ({ env, sesion, request, params }) => {
  const datos = await leerJson(request, esquemaCerrarPendiente);
  return cerrarPendiente(env, sesion, params.id as string, datos.accion, datos.nota);
});
