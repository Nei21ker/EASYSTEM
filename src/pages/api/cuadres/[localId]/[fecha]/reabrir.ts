import { conSesion } from '../../../../../server/http';
import { reabrirCuadre } from '../../../../../server/servicios/cuadres';

export const prerender = false;

/** Reabre un cuadre cerrado (solo administrador y gerente). */
export const POST = conSesion(({ env, sesion, params }) => reabrirCuadre(env, sesion, params.localId as string, params.fecha as string));
