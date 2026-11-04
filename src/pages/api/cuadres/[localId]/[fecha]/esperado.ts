import { conSesion } from '../../../../server/http';
import { calcularEsperadoCuadre } from '../../../../server/servicios/cuadres';

export const prerender = false;

/** Lo que el sistema esperaba cobrar ese día en ese local, por tipo de cobro. */
export const GET = conSesion(({ env, sesion, params }) => calcularEsperadoCuadre(env, sesion, params.localId as string, params.fecha as string));
