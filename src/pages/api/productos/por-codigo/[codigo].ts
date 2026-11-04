import { conSesion } from '../../../../server/http';
import { obtenerProductoPorCodigo } from '../../../../server/servicios/catalogo';

export const prerender = false;

/** Producto con ese código de barras (null si no existe). */
export const GET = conSesion(async ({ env, sesion, params }) => ({
  producto: await obtenerProductoPorCodigo(env, sesion, decodeURIComponent(params.codigo as string)),
}));
