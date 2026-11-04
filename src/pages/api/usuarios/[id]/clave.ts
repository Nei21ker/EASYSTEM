import { z } from 'zod';
import { conSesion, leerJson } from '../../../../server/http';
import { cambiarClaveUsuario } from '../../../../server/servicios/usuarios';

export const prerender = false;

/** Fija una contraseña nueva (la clave nunca se puede volver a leer). */
export const POST = conSesion(async ({ env, sesion, request, params }) => {
  const { clave } = await leerJson(request, z.object({ clave: z.string().max(200) }));
  await cambiarClaveUsuario(env, sesion, params.id as string, clave);
  return { ok: true };
});
