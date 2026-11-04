import { conSesion } from '../../../../server/http';
import { ErrorApi } from '../../../../server/errores';
import { listarNominas } from '../../../../server/servicios/nomina';

export const prerender = false;

/** Pagos cuyo período cae entre `desde` y `hasta` (aaaa-mm-dd). */
export const GET = conSesion(({ env, sesion, request }) => {
  const q = new URL(request.url).searchParams;
  const desde = q.get('desde');
  const hasta = q.get('hasta');
  if (!desde || !hasta) throw new ErrorApi(400, 'Indica el período con desde y hasta.', 'datos_invalidos');
  return listarNominas(env, sesion, desde, hasta);
});
