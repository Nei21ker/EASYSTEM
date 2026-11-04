import { esquemaProducto } from '../../../../server/esquemas';
import { conSesion, leerJson } from '../../../../server/http';
import { actualizarProducto, eliminarProducto } from '../../../../server/servicios/catalogo';

export const prerender = false;

/** Edita un producto (el stock nunca se edita: cambia por movimientos). */
export const PATCH = conSesion(async ({ env, sesion, request, params }) =>
  actualizarProducto(env, sesion, params.id as string, await leerJson(request, esquemaProducto.partial()))
);

export const DELETE = conSesion(async ({ env, sesion, params }) => {
  await eliminarProducto(env, sesion, params.id as string);
  return { ok: true };
});
