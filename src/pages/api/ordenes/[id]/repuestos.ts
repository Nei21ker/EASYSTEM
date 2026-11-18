import { z } from 'zod';
import { conSesion, leerJson } from '../../../../server/http';
import { cambiarRepuestoOrden, listarRepuestosOrden } from '../../../../server/servicios/repuestosOrden';

export const prerender = false;

const id = z.string().min(1).max(100);
const esquema = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('agregar'), productoId: id, origen: id, cantidad: z.number().int().min(1).max(500) }),
  z.object({ accion: z.literal('escanear'), codigo: id }),
  z.object({ accion: z.literal('quitar'), productoId: id, origen: id.optional() }),
]);

export const GET = conSesion(({ env, sesion, params }) => listarRepuestosOrden(env, sesion, params.id!));
export const POST = conSesion(async ({ env, sesion, params, request }) =>
  cambiarRepuestoOrden(env, sesion, params.id!, await leerJson(request, esquema)));
