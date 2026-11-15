import { conSesion } from '../../../server/http';
import { listarTecnicosDeLocal } from '../../../server/servicios/ordenes';

export const prerender = false;

/** Técnicos activos a quienes se les puede dar un trabajo (de un local con ?localId=, o de todos los que se pueden ver). */
export const GET = conSesion(({ env, sesion, request }) => listarTecnicosDeLocal(env, sesion, new URL(request.url).searchParams.get('localId') ?? undefined));
