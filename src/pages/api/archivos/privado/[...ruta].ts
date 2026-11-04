import { conSesion } from '../../../../server/http';
import { borrarArchivosPrivados, leerArchivoPrivado, subirArchivoPrivado } from '../../../../server/servicios/archivos';

export const prerender = false;

/** Comprobantes de nómina y fotos de cuadre: SOLO con sesión y con el mismo acceso que los datos a los que respaldan. */
export const GET = conSesion(({ env, sesion, params }) => leerArchivoPrivado(env, sesion, params.ruta as string));

/** Sube el archivo (cuerpo = los bytes de la imagen; el tipo, en la cabecera Content-Type). */
export const PUT = conSesion(async ({ env, sesion, request, params }) => {
  await subirArchivoPrivado(env, sesion, params.ruta as string, await request.arrayBuffer(), request.headers.get('content-type') ?? '');
  return { ruta: params.ruta };
});

export const DELETE = conSesion(async ({ env, sesion, params }) => {
  await borrarArchivosPrivados(env, sesion, [params.ruta as string]);
  return { ok: true };
});
