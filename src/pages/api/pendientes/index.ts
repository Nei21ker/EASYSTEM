import { esquemaPendienteMercancia } from '../../../server/esquemas';
import { conSesion, leerJson } from '../../../server/http';
import { crearPendienteMercancia, listarPendientes } from '../../../server/servicios/pendientes';
import type { EstadoPendiente, TipoPendiente } from '../../../types/database.types';

export const prerender = false;

/** Pendientes con promotores, más recientes primero (administrador, gerente y encargado de su local; el contador, los de la nómina). */
export const GET = conSesion(({ env, sesion, request }) => {
  const q = new URL(request.url).searchParams;
  return listarPendientes(env, sesion, {
    estado: (q.get('estado') as EstadoPendiente | null) ?? undefined,
    tipo: (q.get('tipo') as TipoPendiente | null) ?? undefined,
    promotorId: q.get('promotorId') ?? undefined,
    localId: q.get('localId') ?? undefined,
    limite: q.get('limite') ? Number(q.get('limite')) : undefined,
  });
});

/** Anota la mercancía que un promotor se llevó y vendrá a pagar. Las comisiones no se crean aquí: las genera la venta con precio de promotor. */
export const POST = conSesion(async ({ env, sesion, request }) => crearPendienteMercancia(env, sesion, await leerJson(request, esquemaPendienteMercancia)));
