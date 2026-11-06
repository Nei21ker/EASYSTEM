import { z } from 'zod';
import { esquemaProductoRapido } from '../../../server/esquemas';
import { conSesion, leerJson } from '../../../server/http';
import { crearProductosRapidos } from '../../../server/servicios/catalogo';

export const prerender = false;

/** Alta rápida: crea hasta 100 productos de una vez con solo nombre, categoría y precio (administrador, gerente y encargado). */
export const POST = conSesion(async ({ env, sesion, request }) => {
  const { filas } = await leerJson(request, z.object({ filas: z.array(esquemaProductoRapido) }));
  return crearProductosRapidos(env, sesion, filas);
});
