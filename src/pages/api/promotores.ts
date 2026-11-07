import { ErrorApi } from '../../server/errores';
import { conSesion } from '../../server/http';
import { listarPromotores } from '../../server/servicios/autorizaciones';

export const prerender = false;

/** Promotores activos de un local (`?localId=`), para elegirlos en el POS. */
export const GET = conSesion(({ env, sesion, request }) => {
  const localId = new URL(request.url).searchParams.get('localId');
  if (!localId) throw new ErrorApi(400, 'Indica el local.', 'datos_invalidos');
  return listarPromotores(env, sesion, localId);
});
