import { z } from 'zod';
import { ROLES } from '../../../server/authz';
import { conSesion, leerJson } from '../../../server/http';
import { crearUsuario, listarUsuarios } from '../../../server/servicios/usuarios';

export const prerender = false;

const esquemaNuevo = z.object({
  email: z.string().email('correo no válido'),
  nombre: z.string().min(2).max(120),
  clave: z.string().min(1).max(200),
  rol: z.enum(ROLES as [string, ...string[]]),
  localId: z.string().min(1).nullable().optional(),
});

/** Lista los usuarios (administrador: todos; gerente: sin administradores). */
export const GET = conSesion(({ env, sesion }) => listarUsuarios(env, sesion));

/** Crea un usuario (solo administrador y gerente, con las reglas de jerarquía). */
export const POST = conSesion(async ({ env, sesion, request }) => {
  const datos = await leerJson(request, esquemaNuevo);
  const id = await crearUsuario(env, sesion, { ...datos, rol: datos.rol as never, localId: datos.localId ?? null });
  return { id };
});
