import { esquemaProveedor } from '../../../server/esquemas';
import { conSesion, leerJson } from '../../../server/http';
import { crearProveedor, listarProveedores } from '../../../server/servicios/inversion';

export const prerender = false;

/** Lista de proveedores con lo comprado a cada uno (solo administrador y gerente). */
export const GET = conSesion(async ({ env, sesion }) => listarProveedores(env, sesion));

/** Agrega un proveedor a la lista (solo administrador y gerente). */
export const POST = conSesion(async ({ env, sesion, request }) => crearProveedor(env, sesion, await leerJson(request, esquemaProveedor)));
