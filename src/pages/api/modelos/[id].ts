import { conSesion } from '../../../server/http';
import { eliminarModelo } from '../../../server/servicios/catalogo';

export const prerender = false;

export const DELETE = conSesion(async ({ env, sesion, params }) => {
  await eliminarModelo(env, sesion, params.id as string);
  return { ok: true };
});
