// Las rutas son finas: validan la entrada, exigen sesión y llaman al servicio (las reglas finas están en usuarios.test.ts).
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { GET as listar, POST as crear } from '../../src/pages/api/usuarios/index';
import { DELETE as eliminar, PATCH as actualizar } from '../../src/pages/api/usuarios/[id]/index';
import { POST as cambiarClave } from '../../src/pages/api/usuarios/[id]/clave';
import { POST as cerrarSesion } from '../../src/pages/api/usuarios/[id]/cerrar-sesion';
import { GET as estado } from '../../src/pages/api/cuenta/estado';
import { GET as usuariosSistema } from '../../src/pages/api/suscripciones/usuarios';
import { POST as cambiarSuscripcion } from '../../src/pages/api/suscripciones/[localId]/index';
import { POST as cerrarSesionesLocal } from '../../src/pages/api/suscripciones/[localId]/cerrar-sesiones';

const env = crearEntornoDePrueba();
const { accesorios } = IDS_LOCALES;
let admin: UsuarioDePrueba;
let vendedor: UsuarioDePrueba;

const json = (cuerpo: unknown, method = 'POST'): RequestInit => ({ method, body: JSON.stringify(cuerpo), headers: { 'content-type': 'application/json' } });
type Ruta = (contexto: never) => Promise<Response> | Response;
const llamar = (ruta: unknown, usuario: UsuarioDePrueba | null, url: string, init: RequestInit = {}, params: Record<string, string> = {}) =>
  (ruta as Ruta)({ request: peticionComo(usuario, url, init), params } as never) as Promise<Response>;

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
  vendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
});

describe('/api/usuarios', () => {
  it('sin sesión todo responde 401', async () => {
    expect((await llamar(listar, null, '/api/usuarios')).status).toBe(401);
    expect((await llamar(crear, null, '/api/usuarios', json({}))).status).toBe(401);
  });

  it('el administrador lista y crea; el vendedor recibe 403', async () => {
    const lista = await llamar(listar, admin, '/api/usuarios');
    expect(lista.status).toBe(200);
    expect(((await lista.json()) as unknown[]).length).toBe(2);

    const cuerpo = { email: 'nuevo@prueba.com', nombre: 'Nuevo Usuario', clave: 'Clave-nueva-123', rol: 'vendedor', localId: accesorios };
    const creado = await llamar(crear, admin, '/api/usuarios', json(cuerpo));
    expect(creado.status).toBe(200);
    expect(await creado.json()).toEqual({ id: expect.any(String) });
    expect((await llamar(crear, vendedor, '/api/usuarios', json({ ...cuerpo, email: 'otro@prueba.com' }))).status).toBe(403);
  });

  it('un cuerpo inválido responde 400', async () => {
    const r = await llamar(crear, admin, '/api/usuarios', json({ email: 'no-es-correo', nombre: 'A', clave: '1', rol: 'rey' }));
    expect(r.status).toBe(400);
    expect(((await r.json()) as { codigo: string }).codigo).toBe('datos_invalidos');
  });

  it('PATCH, clave, cierre de sesión y DELETE sobre un usuario', async () => {
    const id = vendedor.id;
    expect((await llamar(actualizar, admin, `/api/usuarios/${id}`, json({ status: 'inactive' }, 'PATCH'), { id })).status).toBe(200);
    expect((await llamar(cambiarClave, admin, `/api/usuarios/${id}/clave`, json({ clave: 'Clave-otra-12345' }), { id })).status).toBe(200);
    expect((await llamar(cerrarSesion, admin, `/api/usuarios/${id}/cerrar-sesion`, json({}), { id })).status).toBe(200);
    expect((await llamar(eliminar, admin, `/api/usuarios/${id}`, { method: 'DELETE' }, { id })).status).toBe(200);
    expect((await llamar(eliminar, admin, '/api/usuarios/no-existe', { method: 'DELETE' }, { id: 'no-existe' })).status).toBe(404);
  });
});

describe('/api/cuenta y /api/suscripciones', () => {
  it('el estado de la cuenta responde 401 sin sesión y los datos con ella', async () => {
    expect((await llamar(estado, null, '/api/cuenta/estado')).status).toBe(401);
    const r = await llamar(estado, vendedor, '/api/cuenta/estado');
    expect(await r.json()).toMatchObject({ acceso: true, motivo: 'ok' });
  });

  it('un usuario desactivado recibe el motivo (200), no un error', async () => {
    await env.DB.prepare("UPDATE perfiles SET status = 'inactive' WHERE id = ?").bind(vendedor.id).run();
    const r = await llamar(estado, vendedor, '/api/cuenta/estado');
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ acceso: false, motivo: 'usuario_inactivo' });
  });

  it('suscripciones: lista del sistema, cambio de estado y cierre de sesiones, solo del administrador', async () => {
    expect((await llamar(usuariosSistema, admin, '/api/suscripciones/usuarios')).status).toBe(200);
    expect((await llamar(usuariosSistema, vendedor, '/api/suscripciones/usuarios')).status).toBe(403);

    const params = { localId: accesorios };
    const cambio = await llamar(cambiarSuscripcion, admin, `/api/suscripciones/${accesorios}`, json({ estado: 'SUSPENDED', vence: null, cambiarVencimiento: false }), params);
    expect(cambio.status).toBe(200);
    expect((await llamar(cambiarSuscripcion, admin, `/api/suscripciones/${accesorios}`, json({ estado: 'ROTO' }), params)).status).toBe(400);

    const cierre = await llamar(cerrarSesionesLocal, admin, `/api/suscripciones/${accesorios}/cerrar-sesiones`, json({}), params);
    expect(await cierre.json()).toEqual({ cerradas: 1 });
  });
});
