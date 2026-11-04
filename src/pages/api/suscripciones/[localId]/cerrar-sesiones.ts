import { conSesion } from '../../../../server/http';
import { cerrarSesionesLocal } from '../../../../server/servicios/usuarios';

export const prerender = false;

/** Cierra las sesiones de todos los usuarios de un local (solo administrador). */
export const POST = conSesion(async ({ env, sesion, params }) => ({
  cerradas: await cerrarSesionesLocal(env, sesion, params.localId as string),
}));
