import { esquemaInversion } from '../../../server/esquemas';
import { conSesion, leerJson } from '../../../server/http';
import { actualizarInversion, eliminarInversion } from '../../../server/servicios/inversion';

export const prerender = false;

/** Corrige un registro de inversión (solo administrador y gerente). */
export const PUT = conSesion(async ({ env, sesion, request, params }) => actualizarInversion(env, sesion, params.id as string, await leerJson(request, esquemaInversion)));

/** Borra un registro de inversión (solo administrador y gerente). */
export const DELETE = conSesion(async ({ env, sesion, params }) => {
  await eliminarInversion(env, sesion, params.id as string);
  return { ok: true };
});
