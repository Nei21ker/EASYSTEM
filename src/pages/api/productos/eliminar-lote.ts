import { z } from 'zod';
import { conSesion, leerJson } from '../../../server/http';
import { eliminarProductosLote } from '../../../server/servicios/catalogo';

export const prerender = false;

/**
 * Borra hasta 100 productos ingresados por error (solo administrador y gerente). Los que ya tienen ventas, traslados o bajas no
 * se tocan y vuelven en `bloqueados` con el motivo.
 */
export const POST = conSesion(async ({ env, sesion, request }) => {
  const { ids } = await leerJson(request, z.object({ ids: z.array(z.string().min(1).max(100)) }));
  return eliminarProductosLote(env, sesion, ids);
});
