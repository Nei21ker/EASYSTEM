import { conSesion } from '../../../../server/http';
import { liberarEspera } from '../../../../server/servicios/espera';

export const prerender = false;

/** Suelta una venta en espera (deja de reservar el stock). No mueve nada. */
export const POST = conSesion(({ env, sesion, params }) => liberarEspera(env, sesion, params.id as string));
