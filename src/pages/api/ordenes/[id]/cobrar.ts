import { esquemaCobroOrden } from '../../../../server/esquemas';
import { conSesion, leerJson } from '../../../../server/http';
import { cobrarOrden } from '../../../../server/servicios/ordenes';

export const prerender = false;

/** Cobra la reparación: calcula el reparto entre la tienda y el técnico y deja la orden entregada. */
export const POST = conSesion(async ({ env, sesion, request, params }) =>
  cobrarOrden(env, sesion, params.id as string, (await leerJson(request, esquemaCobroOrden)) as never)
);
