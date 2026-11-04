import { ErrorApi } from '../../../../server/errores';
import { conSesion } from '../../../../server/http';
import { eliminarFotoProducto, subirFotoProducto } from '../../../../server/servicios/archivos';

export const prerender = false;

/** Sube la foto de un producto (cuerpo = bytes; tipo en Content-Type). Devuelve la URL a guardar en `imagen_url`. */
export const PUT = conSesion(async ({ env, sesion, request, params }) => ({
  url: await subirFotoProducto(env, sesion, params.id as string, await request.arrayBuffer(), request.headers.get('content-type') ?? ''),
}));

/** Borra el archivo de una foto anterior: `?url=` con la URL guardada en el producto. */
export const DELETE = conSesion(async ({ env, sesion, request }) => {
  const url = new URL(request.url).searchParams.get('url');
  if (!url) throw new ErrorApi(400, 'Falta la dirección de la foto.', 'datos_invalidos');
  await eliminarFotoProducto(env, sesion, url);
  return { ok: true };
});
