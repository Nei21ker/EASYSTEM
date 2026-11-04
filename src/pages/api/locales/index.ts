import { conSesion } from '../../../server/http';
import { listarLocalesVisibles } from '../../../server/servicios/catalogo';

export const prerender = false;

/** Locales que el usuario puede ver (administrador, gerente y contador: todos; el resto, el suyo). */
export const GET = conSesion(({ env, sesion }) => listarLocalesVisibles(env, sesion));
