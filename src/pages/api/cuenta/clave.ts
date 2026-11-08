import { z } from 'zod';
import { conSesion, leerJson } from '../../../server/http';
import { cambiarMiClave } from '../../../server/servicios/usuarios';

export const prerender = false;

/**
 * Cambia la contraseña de quien tiene la sesión (cualquier rol): exige la actual, cierra las demás sesiones de la cuenta y
 * quita la marca de "clave temporal". Es la única ruta que atiende `conSesion` mientras la clave sea temporal.
 */
export const POST = conSesion(async ({ env, sesion, request }) => {
  const { actual, nueva } = await leerJson(request, z.object({ actual: z.string().max(200), nueva: z.string().max(200) }));
  await cambiarMiClave(env, sesion, actual, nueva);
  return { ok: true };
});
