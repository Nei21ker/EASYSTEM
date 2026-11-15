import { esquemaPagarTecnicos } from '../../../server/esquemas';
import { conSesion, leerJson } from '../../../server/http';
import { pagarTecnicos } from '../../../server/servicios/ordenes';

export const prerender = false;

/** Marca como pagada la parte del técnico de las órdenes elegidas (administrador, gerente, supervisor y encargado). */
export const POST = conSesion(async ({ env, sesion, request }) => pagarTecnicos(env, sesion, (await leerJson(request, esquemaPagarTecnicos)).ids));
