import { esquemaProveedor } from '../../../server/esquemas';
import { conSesion, leerJson } from '../../../server/http';
import { actualizarProveedor, eliminarProveedor } from '../../../server/servicios/inversion';

export const prerender = false;

/** Corrige un proveedor (solo administrador y gerente). */
export const PUT = conSesion(async ({ env, sesion, request, params }) => actualizarProveedor(env, sesion, params.id as string, await leerJson(request, esquemaProveedor)));

/** Quita un proveedor de la lista; los registros ya anotados conservan su nombre (solo administrador y gerente). */
export const DELETE = conSesion(async ({ env, sesion, params }) => {
  await eliminarProveedor(env, sesion, params.id as string);
  return { ok: true };
});
