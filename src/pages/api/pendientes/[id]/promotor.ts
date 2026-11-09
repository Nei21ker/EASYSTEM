import { esquemaAsignarPromotor } from '../../../../server/esquemas';
import { conSesion, leerJson } from '../../../../server/http';
import { asignarPromotorAPendiente } from '../../../../server/servicios/pendientes';

export const prerender = false;

/** Ata un promotor registrado a un pendiente abierto que se creó sin sus datos. */
export const PUT = conSesion(async ({ env, sesion, request, params }) => asignarPromotorAPendiente(env, sesion, params.id as string, (await leerJson(request, esquemaAsignarPromotor)).promotorId));
