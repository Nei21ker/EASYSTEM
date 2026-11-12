import { conSesion } from '../../../../server/http';
import { completarIntercambio } from '../../../../server/servicios/intercambios';

export const prerender = false;

/** Mueve el lado que quedó en espera (lo que entregamos o lo que recibimos). */
export const POST = conSesion(({ env, sesion, params }) => completarIntercambio(env, sesion, params.id as string));
