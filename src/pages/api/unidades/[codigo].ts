import { conSesion } from '../../../server/http';
import { obtenerUnidadPorCodigo } from '../../../server/servicios/movimientos';

export const prerender = false;

/** La unidad con ese código (null si no existe o es de un local al que no se accede). */
export const GET = conSesion(async ({ env, sesion, params }) => ({
  unidad: await obtenerUnidadPorCodigo(env, sesion, decodeURIComponent(params.codigo as string)),
}));
