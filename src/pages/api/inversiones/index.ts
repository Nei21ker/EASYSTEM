import { esquemaInversion } from '../../../server/esquemas';
import { conSesion, leerJson } from '../../../server/http';
import { crearInversion, listarInversiones } from '../../../server/servicios/inversion';

export const prerender = false;

/** Compras y pérdidas anotadas (solo administrador y gerente). Filtros: desde, hasta (aaaa-mm-dd), localId, tipo. */
export const GET = conSesion(async ({ env, sesion, request }) => {
  const q = new URL(request.url).searchParams;
  const tipo = q.get('tipo');
  const limite = q.get('limite');
  return listarInversiones(env, sesion, {
    desde: q.get('desde') ?? undefined,
    hasta: q.get('hasta') ?? undefined,
    localId: q.get('localId') ?? undefined,
    tipo: tipo === 'COMPRA' || tipo === 'PERDIDA' ? tipo : undefined,
    limite: limite ? Number(limite) : undefined,
  });
});

/** Anota una compra o una pérdida (solo administrador y gerente). */
export const POST = conSesion(async ({ env, sesion, request }) => crearInversion(env, sesion, await leerJson(request, esquemaInversion)));
