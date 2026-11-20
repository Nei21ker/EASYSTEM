import { z } from 'zod';
import { conSesion, leerJson } from '../../../server/http';
import { eliminarOrdenes } from '../../../server/servicios/ordenes';

export const prerender = false;

export const POST = conSesion(async ({ env, sesion, request }) => {
  const { local_id, ids } = await leerJson(request, z.object({
    local_id: z.string().min(1).max(100),
    ids: z.array(z.string().min(1).max(100)).min(1).max(50),
  }));
  return eliminarOrdenes(env, sesion, local_id, ids);
});
