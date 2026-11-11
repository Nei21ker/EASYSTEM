import { z } from 'zod';
import { conSesion, leerJson } from '../../../server/http';
import { cambiarPreciosLote } from '../../../server/servicios/catalogo';

export const prerender = false;

/**
 * Pone el mismo precio (en dólares o fijo en bolívares) a los productos elegidos (solo administrador y gerente): sirve para
 * actualizar de una vez el precio en Bs de todos los vidrios cuando cambia.
 */
export const POST = conSesion(async ({ env, sesion, request }) => {
  const datos = await leerJson(
    request,
    z.object({
      ids: z.array(z.string().min(1).max(100)).max(3000),
      moneda: z.enum(['USD', 'BS']),
      precio: z.number().finite(),
    })
  );
  return cambiarPreciosLote(env, sesion, datos);
});
