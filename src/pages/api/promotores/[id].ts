import { esquemaNuevoPromotor } from '../../../server/esquemas';
import { conSesion, leerJson } from '../../../server/http';
import { actualizarPromotor } from '../../../server/servicios/promotores';

export const prerender = false;

/** Corrige los datos de un promotor (administrador, gerente, encargado y contador). */
export const PUT = conSesion(async ({ env, sesion, request, params }) => actualizarPromotor(env, sesion, params.id as string, await leerJson(request, esquemaNuevoPromotor)));
