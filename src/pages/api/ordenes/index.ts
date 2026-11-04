import { z } from 'zod';
import { conSesion, leerJson } from '../../../server/http';
import { crearOrden, listarOrdenes } from '../../../server/servicios/ordenes';

export const prerender = false;

const esquemaNueva = z.object({
  local_id: z.string(),
  cliente_cedula: z.string(),
  cliente_nombre: z.string(),
  cliente_telefono: z.string(),
  equipo_marca: z.string(),
  equipo_modelo: z.string(),
  equipo_imei: z.string().nullable().optional(),
  accesorios_recibidos: z.string().nullable().optional(),
  falla_reportada: z.string(),
  registrado_nombre: z.string().nullable().optional(),
});

export const GET = conSesion(({ env, sesion, request }) => {
  const q = new URL(request.url).searchParams;
  return listarOrdenes(env, sesion, { limite: q.get('limite') ? Number(q.get('limite')) : undefined, localId: q.get('localId') ?? undefined });
});

export const POST = conSesion(async ({ env, sesion, request }) => crearOrden(env, sesion, (await leerJson(request, esquemaNueva)) as never));

