import { conSesion } from '../../../../server/http';
import { cerrarTraslado } from '../../../../server/servicios/traslados';

export const prerender = false;

/** Cierra el traslado: lo que no llegó vuelve al local de origen. */
export const POST = conSesion(({ env, sesion, params }) => cerrarTraslado(env, sesion, decodeURIComponent(params.id as string)));
