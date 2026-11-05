import { ErrorApi } from '../../../../server/errores';
import { conSesion } from '../../../../server/http';
import { eliminarFotoProducto, subirFotoProducto, subirMiniaturaProducto } from '../../../../server/servicios/archivos';

export const prerender = false;

/**
 * Sube la foto de un producto (cuerpo = bytes; tipo en Content-Type). Devuelve la URL a guardar en `imagen_url`.
 * Con `?miniatura=<URL de la foto>` sube, en cambio, la miniatura de esa foto (la que usan las listas).
 */
export const PUT = conSesion(async ({ env, sesion, request, params }) => {
  const bytes = await request.arrayBuffer();
  const tipo = request.headers.get('content-type') ?? '';
  const deFoto = new URL(request.url).searchParams.get('miniatura');
  if (deFoto) return { url: await subirMiniaturaProducto(env, sesion, params.id as string, deFoto, bytes, tipo) };
  return { url: await subirFotoProducto(env, sesion, params.id as string, bytes, tipo) };
});

/** Borra el archivo de una foto anterior (y su miniatura): `?url=` con la URL guardada en el producto. */
export const DELETE = conSesion(async ({ env, sesion, request }) => {
  const url = new URL(request.url).searchParams.get('url');
  if (!url) throw new ErrorApi(400, 'Falta la dirección de la foto.', 'datos_invalidos');
  await eliminarFotoProducto(env, sesion, url);
  return { ok: true };
});
