import { z } from 'zod';
import { conSesion, leerJson } from '../../../server/http';
import { reemplazarCompatibilidadesLote } from '../../../server/servicios/catalogo';

export const prerender = false;

/** Importador: reemplaza las compatibilidades de varios productos (solo administrador y gerente). */
export const POST = conSesion(async ({ env, sesion, request }) => {
  const { pares, productoIds } = await leerJson(
    request,
    z.object({ pares: z.array(z.object({ producto_id: z.string(), modelo_id: z.string() })), productoIds: z.array(z.string()) })
  );
  await reemplazarCompatibilidadesLote(env, sesion, pares, productoIds);
  return { ok: true };
});
