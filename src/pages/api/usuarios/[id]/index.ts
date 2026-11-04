import { z } from 'zod';
import { ROLES } from '../../../../server/authz';
import { conSesion, leerJson } from '../../../../server/http';
import { actualizarUsuario, eliminarUsuario } from '../../../../server/servicios/usuarios';

export const prerender = false;

const esquemaCambios = z.object({
  rol: z.enum(ROLES as [string, ...string[]]).optional(),
  localId: z.string().min(1).nullable().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

/** Cambia el rol, el local y/o el estado de un usuario. */
export const PATCH = conSesion(async ({ env, sesion, request, params }) => {
  const cambios = await leerJson(request, esquemaCambios);
  await actualizarUsuario(env, sesion, params.id as string, cambios as never);
  return { ok: true };
});

/** Elimina un usuario (cuenta, sesiones y perfil). */
export const DELETE = conSesion(async ({ env, sesion, params }) => {
  await eliminarUsuario(env, sesion, params.id as string);
  return { ok: true };
});
