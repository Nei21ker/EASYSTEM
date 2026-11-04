import { z } from 'zod';
import { conSesion, leerJson } from '../../../../../server/http';
import { guardarCuadre, obtenerCuadre } from '../../../../../server/servicios/cuadres';

export const prerender = false;

const esquema = z.object({
  contado: z.array(z.object({ metodo: z.string(), monto: z.number() })),
  fotos: z.array(z.object({ tipo: z.string(), path: z.string() })),
  notas: z.string().nullable().optional(),
  cerrar: z.boolean(),
});

/** El cuadre de ese local y día (`{ cuadre: null }` si todavía no existe). */
export const GET = conSesion(async ({ env, sesion, params }) => ({ cuadre: await obtenerCuadre(env, sesion, params.localId as string, params.fecha as string) }));

/** Guarda el borrador o cierra el cuadre. Lo esperado lo calcula el servidor. */
export const PUT = conSesion(async ({ env, sesion, request, params }) => {
  const datos = await leerJson(request, esquema);
  return guardarCuadre(env, sesion, { localId: params.localId as string, fecha: params.fecha as string, ...datos, notas: datos.notas ?? null } as never);
});
