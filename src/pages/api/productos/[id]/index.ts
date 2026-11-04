import { esquemaProducto } from '../../../../server/esquemas';
import { conSesion, leerJson } from '../../../../server/http';
import { actualizarProducto, obtenerProductoPorId, eliminarProducto } from '../../../../server/servicios/catalogo';

export const prerender = false;

/** Un producto con sus modelos compatibles y el inventario de los locales a los que se accede (null si no existe). */
export const GET = conSesion(async ({ env, sesion, params }) => ({ producto: await obtenerProductoPorId(env, sesion, params.id as string) }));

/** Edita un producto (el stock nunca se edita: cambia por movimientos). */
export const PATCH = conSesion(async ({ env, sesion, request, params }) =>
  actualizarProducto(env, sesion, params.id as string, await leerJson(request, esquemaProducto.partial()))
);

export const DELETE = conSesion(async ({ env, sesion, params }) => {
  await eliminarProducto(env, sesion, params.id as string);
  return { ok: true };
});
