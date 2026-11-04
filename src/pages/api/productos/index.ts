import { esquemaProducto } from '../../../server/esquemas';
import { conSesion, leerJson } from '../../../server/http';
import { crearProducto, listarProductos } from '../../../server/servicios/catalogo';

export const prerender = false;

/** Catálogo con modelos compatibles e inventario de los locales a los que el usuario accede. */
export const GET = conSesion(({ env, sesion }) => listarProductos(env, sesion));

export const POST = conSesion(async ({ env, sesion, request }) => crearProducto(env, sesion, await leerJson(request, esquemaProducto)));
