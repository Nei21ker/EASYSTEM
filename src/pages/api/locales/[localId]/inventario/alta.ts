import { z } from 'zod';
import { conSesion, leerJson } from '../../../../../server/http';
import { asegurarEnLocal } from '../../../../../server/servicios/catalogo';

export const prerender = false;

/** Da de alta productos en el inventario de un local (stock 0, sin mínimo). */
export const POST = conSesion(async ({ env, sesion, request, params }) => {
  const { productoIds } = await leerJson(request, z.object({ productoIds: z.array(z.string()) }));
  await asegurarEnLocal(env, sesion, params.localId as string, productoIds);
  return { ok: true };
});
