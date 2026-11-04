import { ErrorApi } from '../../../server/errores';
import { conSesion } from '../../../server/http';
import { listarCuadresDelDia } from '../../../server/servicios/cuadres';

export const prerender = false;

/** Los cuadres de un día (`?fecha=aaaa-mm-dd`) de los locales a los que el usuario accede. */
export const GET = conSesion(({ env, sesion, request }) => {
  const fecha = new URL(request.url).searchParams.get('fecha');
  if (!fecha) throw new ErrorApi(400, 'Falta el día del cuadre.', 'datos_invalidos');
  return listarCuadresDelDia(env, sesion, fecha);
});
