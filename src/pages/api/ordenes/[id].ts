import { z } from 'zod';
import { conSesion, leerJson } from '../../../server/http';
import { actualizarOrden, obtenerOrden } from '../../../server/servicios/ordenes';
import { ErrorApi } from '../../../server/errores';

export const prerender = false;

const esquemaCambios = z.object({
  diagnostico: z.string().nullable().optional(),
  estado: z.enum(['pendiente', 'en_reparacion', 'listo', 'entregado']).optional(),
  tecnico_id: z.string().nullable().optional(),
  tecnico_nombre: z.string().nullable().optional(),
  mano_de_obra_usd: z.number().optional(),
});

export const GET = conSesion(async ({ env, sesion, params }) => {
  const orden = await obtenerOrden(env, sesion, params.id as string);
  if (!orden) throw new ErrorApi(404, 'La orden no existe.', 'no_existe');
  return orden;
});

/** Cambia estado, diagnóstico, técnico o mano de obra (los repuestos se mueven por su propia ruta). */
export const PATCH = conSesion(async ({ env, sesion, request, params }) =>
  actualizarOrden(env, sesion, params.id as string, (await leerJson(request, esquemaCambios)) as never)
);
