import { esquemaAutorizarPrecio } from '../../../server/esquemas';
import { conSesion, leerJson } from '../../../server/http';
import { autorizarPrecio } from '../../../server/servicios/autorizaciones';

export const prerender = false;

/**
 * Un encargado, gerente o administrador autoriza vender a un precio mayor al del catálogo (precio de promotor) tecleando SU correo y
 * contraseña. Devuelve una autorización firmada de 20 minutos, atada a quien vende, el local, el promotor y los precios.
 */
export const POST = conSesion(async ({ env, sesion, request }) => autorizarPrecio(env, sesion, await leerJson(request, esquemaAutorizarPrecio)));
