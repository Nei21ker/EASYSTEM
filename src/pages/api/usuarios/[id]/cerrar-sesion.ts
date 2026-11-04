import { conSesion } from '../../../../server/http';
import { cerrarSesionForzada } from '../../../../server/servicios/usuarios';

export const prerender = false;

/** Cierra a la fuerza las sesiones de un usuario (solo administrador). */
export const POST = conSesion(async ({ env, sesion, params }) => {
  await cerrarSesionForzada(env, sesion, params.id as string);
  return { ok: true };
});
