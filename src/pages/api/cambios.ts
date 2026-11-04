import { conSesion } from '../../server/http';
import { versionesVisibles } from '../../server/servicios/cambios';

export const prerender = false;

/** Versiones por tabla y local de lo que este usuario puede leer (el cliente las consulta cada pocos segundos). */
export const GET = conSesion(async ({ env, sesion }) => ({ versiones: await versionesVisibles(env, sesion) }));
