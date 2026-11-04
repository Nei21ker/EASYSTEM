import { conSesion } from '../../../server/http';
import { listarDestinos } from '../../../server/servicios/traslados';

export const prerender = false;

/** Locales a los que se puede enviar mercancía (todos los vigentes, aunque el usuario solo vea el suyo). */
export const GET = conSesion(({ env, sesion }) => listarDestinos(env, sesion));
