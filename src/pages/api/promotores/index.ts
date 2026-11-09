import { esquemaNuevoPromotor } from '../../../server/esquemas';
import { conSesion, leerJson } from '../../../server/http';
import { buscarPromotorPorCedula, crearPromotor, listarPromotores } from '../../../server/servicios/promotores';

export const prerender = false;

/**
 * Directorio de promotores con lo pendiente con cada uno (administrador, gerente, encargado y contador).
 * Con `?cedula=` devuelve solo ese promotor (o null): es lo que usa el cobro del POS para completar los datos (también el vendedor).
 */
export const GET = conSesion(async ({ env, sesion, request }) => {
  const q = new URL(request.url).searchParams;
  const cedula = q.get('cedula');
  if (cedula !== null) return { promotor: await buscarPromotorPorCedula(env, sesion, cedula) };
  return listarPromotores(env, sesion, { localId: q.get('localId') ?? undefined, buscar: q.get('buscar') ?? undefined });
});

/** Agrega un promotor al directorio (administrador, gerente, encargado y contador). */
export const POST = conSesion(async ({ env, sesion, request }) => crearPromotor(env, sesion, await leerJson(request, esquemaNuevoPromotor)));
