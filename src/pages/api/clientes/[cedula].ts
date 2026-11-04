import { conSesion } from '../../../server/http';
import { buscarCliente } from '../../../server/servicios/clientes';

export const prerender = false;

/** Los datos de un cliente que ya compró (`{ cliente: null }` si es nuevo). La cédula va con su nacionalidad: V-12345678. */
export const GET = conSesion(async ({ env, sesion, params }) => ({ cliente: await buscarCliente(env, sesion, decodeURIComponent(params.cedula as string)) }));
