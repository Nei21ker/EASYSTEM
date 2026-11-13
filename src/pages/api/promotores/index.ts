import { esquemaNuevoPromotor } from '../../../server/esquemas';
import { conSesion, leerJson } from '../../../server/http';
import { buscarPromotorPorCedula, crearPromotor, listarPromotores, listarPromotoresDelLocal } from '../../../server/servicios/promotores';

export const prerender = false;

/**
 * Directorio de promotores con lo pendiente con cada uno (administrador, gerente, encargado y contador).
 * Con `?para=venta` (y `localId` para administrador y gerente) devuelve los promotores registrados en ese local: lista del cobro
 * con precio de promotor (también el vendedor).
 * Con `?cedula=` devuelve solo ese promotor (o null): es lo que usa el cobro del POS para completar los datos (también el vendedor).
 */
export const GET = conSesion(async ({ env, sesion, request }) => {
  const q = new URL(request.url).searchParams;
  if (q.get('para') === 'venta') return listarPromotoresDelLocal(env, sesion, q.get('localId') ?? undefined);
  const cedula = q.get('cedula');
  if (cedula !== null) return { promotor: await buscarPromotorPorCedula(env, sesion, cedula) };
  return listarPromotores(env, sesion, { localId: q.get('localId') ?? undefined, buscar: q.get('buscar') ?? undefined });
});

/** Agrega un promotor al directorio (administrador, gerente, encargado y contador). */
export const POST = conSesion(async ({ env, sesion, request }) => crearPromotor(env, sesion, await leerJson(request, esquemaNuevoPromotor)));
