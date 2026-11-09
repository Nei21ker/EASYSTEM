import { esquemaAutorizarDanados } from '../../../server/esquemas';
import { conSesion, leerJson } from '../../../server/http';
import { autorizarDanados } from '../../../server/servicios/autorizaciones';

export const prerender = false;

/**
 * Un gerente o administrador autoriza, con SU contraseña, botar 3 o más piezas defectuosas en una venta (productos por cantidad).
 * Devuelve una autorización firmada de 20 minutos, atada a quien vende, el local y la cantidad.
 */
export const POST = conSesion(async ({ env, sesion, request }) => autorizarDanados(env, sesion, await leerJson(request, esquemaAutorizarDanados)));
