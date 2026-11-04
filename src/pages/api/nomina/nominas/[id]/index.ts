import { conSesion } from '../../../../../server/http';
import { eliminarPagoPendiente, obtenerNomina } from '../../../../../server/servicios/nomina';

export const prerender = false;

export const GET = conSesion(({ env, sesion, params }) => obtenerNomina(env, sesion, params.id as string));

/** Borra un pago PENDIENTE (uno PAGADO no se puede borrar). */
export const DELETE = conSesion(async ({ env, sesion, params }) => {
  await eliminarPagoPendiente(env, sesion, params.id as string);
  return { ok: true };
});
