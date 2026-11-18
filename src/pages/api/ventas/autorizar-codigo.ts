import { esquemaAutorizarCodigo } from '../../../server/esquemas';
import { conSesion, leerJson } from '../../../server/http';
import { autorizarCodigoManual } from '../../../server/servicios/autorizaciones';

export const prerender = false;

/** Autoriza la elección manual para un producto. La gerencia se identifica con su sesión. */
export const POST = conSesion(async ({ env, sesion, request }) => autorizarCodigoManual(env, sesion, await leerJson(request, esquemaAutorizarCodigo)));
