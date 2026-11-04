import { z } from 'zod';
import { esquemaProducto } from '../../../server/esquemas';
import { conSesion, leerJson } from '../../../server/http';
import { crearProductosLote } from '../../../server/servicios/catalogo';

export const prerender = false;

/** Importador: crea hasta 100 productos por petición (solo administrador y gerente). */
export const POST = conSesion(async ({ env, sesion, request }) => {
  const { filas } = await leerJson(request, z.object({ filas: z.array(esquemaProducto) }));
  return crearProductosLote(env, sesion, filas);
});
