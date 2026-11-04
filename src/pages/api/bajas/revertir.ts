import { z } from 'zod';
import { conSesion, leerJson } from '../../../server/http';
import { revertirBaja } from '../../../server/servicios/traslados';

export const prerender = false;

/** Devuelve al stock piezas dadas de baja por error (administrador y gerente). */
export const POST = conSesion(async ({ env, sesion, request }) => {
  const { codigos } = await leerJson(request, z.object({ codigos: z.array(z.string()).max(500) }));
  return { revertidas: await revertirBaja(env, sesion, codigos) };
});
