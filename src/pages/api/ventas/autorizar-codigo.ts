import { esquemaAutorizarCodigo } from '../../../server/esquemas';
import { conSesion, leerJson } from '../../../server/http';
import { autorizarCodigoManual } from '../../../server/servicios/autorizaciones';

export const prerender = false;

/**
 * Un encargado, gerente o administrador autoriza, con SU correo y contraseña, que quien vende elija a mano el código de las unidades de
 * un producto (cuando la etiqueta no se puede leer). Devuelve una autorización firmada de 20 minutos.
 */
export const POST = conSesion(async ({ env, sesion, request }) => autorizarCodigoManual(env, sesion, await leerJson(request, esquemaAutorizarCodigo)));
