// Cambiar la propia contraseña (cualquier rol) y la clave temporal que obliga a cambiarla en el primer ingreso.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { POST as cambiarMiClave } from '../../src/pages/api/cuenta/clave';
import { GET as estado } from '../../src/pages/api/cuenta/estado';
import { GET as locales } from '../../src/pages/api/locales/index';
import { POST as crearUsuario } from '../../src/pages/api/usuarios/index';
import { POST as claveDeOtro } from '../../src/pages/api/usuarios/[id]/clave';
import { crearAuth } from '../../src/server/auth';
import { verificarClave } from '../../src/server/password';

const env = crearEntornoDePrueba();
const { accesorios } = IDS_LOCALES;
let admin: UsuarioDePrueba;
let vendedor: UsuarioDePrueba;

const json = (cuerpo: unknown, method = 'POST'): RequestInit => ({ method, body: JSON.stringify(cuerpo), headers: { 'content-type': 'application/json' } });
type Ruta = (contexto: never) => Promise<Response> | Response;
const llamar = (ruta: unknown, usuario: UsuarioDePrueba | null, url: string, init: RequestInit = {}, params: Record<string, string> = {}) =>
  (ruta as Ruta)({ request: peticionComo(usuario, url, init), params } as never) as Promise<Response>;
const cambiar = (usuario: UsuarioDePrueba | null, actual: string, nueva: string) => llamar(cambiarMiClave, usuario, '/api/cuenta/clave', json({ actual, nueva }));
const codigo = async (r: Response) => ((await r.json()) as { codigo?: string }).codigo;
const hashDe = async (id: string) => (await env.DB.prepare("SELECT password FROM account WHERE userId = ? AND providerId = 'credential'").bind(id).first<{ password: string }>())!.password;
const marca = async (id: string) => (await env.DB.prepare('SELECT debe_cambiar_clave AS m FROM perfiles WHERE id = ?').bind(id).first<{ m: number }>())!.m;

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
  vendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
});

describe('cambiar mi clave', () => {
  it('sin sesión responde 401', async () => {
    expect((await cambiar(null, 'x', 'Otra-clave-123')).status).toBe(401);
  });

  it('un vendedor (que no gestiona usuarios) puede cambiar la suya: la nueva queda guardada y la anterior deja de servir', async () => {
    const r = await cambiar(vendedor, vendedor.clave, 'Clave-nueva-456');
    expect(r.status).toBe(200);
    const hash = await hashDe(vendedor.id);
    expect(await verificarClave('Clave-nueva-456', hash)).toBe(true);
    expect(await verificarClave(vendedor.clave, hash)).toBe(false);
  });

  it('con la clave actual equivocada no cambia nada (400) y la guardada sigue siendo la de antes', async () => {
    const antes = await hashDe(vendedor.id);
    const r = await cambiar(vendedor, 'no-es-la-actual', 'Clave-nueva-456');
    expect(r.status).toBe(400);
    expect(await codigo(r)).toBe('clave_actual_incorrecta');
    expect(await hashDe(vendedor.id)).toBe(antes);
  });

  it('la nueva debe tener 8 caracteres y ser distinta de la actual', async () => {
    expect(await codigo(await cambiar(vendedor, vendedor.clave, 'corta'))).toBe('clave_corta');
    expect(await codigo(await cambiar(vendedor, vendedor.clave, vendedor.clave))).toBe('clave_igual');
  });

  it('5 intentos fallidos seguidos bloquean (429), incluso con la clave actual correcta', async () => {
    for (let i = 0; i < 5; i++) expect((await cambiar(vendedor, `mala-${i}`, 'Clave-nueva-456')).status).toBe(400);
    const r = await cambiar(vendedor, vendedor.clave, 'Clave-nueva-456');
    expect(r.status).toBe(429);
    expect(await codigo(r)).toBe('demasiados_intentos');
    // y el bloqueo es de esa persona: otra cuenta no se ve afectada
    expect((await cambiar(admin, admin.clave, 'Clave-nueva-456')).status).toBe(200);
  });

  it('un acierto borra los fallos anteriores', async () => {
    for (let i = 0; i < 4; i++) await cambiar(vendedor, `mala-${i}`, 'Clave-nueva-456');
    expect((await cambiar(vendedor, vendedor.clave, 'Clave-nueva-456')).status).toBe(200);
    const fila = await env.DB.prepare('SELECT count FROM rateLimit WHERE key = ?').bind(`clave-propia:${vendedor.id}`).first();
    expect(fila).toBeNull();
  });

  it('cierra las demás sesiones de la cuenta y conserva la actual', async () => {
    // una segunda sesión (otro equipo) de la misma cuenta
    await crearAuth(env, 'http://localhost:8787').handler(
      new Request('http://localhost:8787/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:8787', 'cf-connecting-ip': '10.9.9.9' },
        body: JSON.stringify({ email: vendedor.email, password: vendedor.clave }),
      })
    );
    const cuenta = async () => ((await env.DB.prepare('SELECT count(*) AS n FROM session WHERE userId = ?').bind(vendedor.id).first<{ n: number }>())!.n);
    expect(await cuenta()).toBe(2);
    expect((await cambiar(vendedor, vendedor.clave, 'Clave-nueva-456')).status).toBe(200);
    expect(await cuenta()).toBe(1);
    expect((await llamar(estado, vendedor, '/api/cuenta/estado')).status).toBe(200); // la sesión desde la que se cambió sigue viva
  });
});

describe('clave temporal', () => {
  it('la cuenta que crea un administrador nace con la clave por cambiar; las demás cuentas no', async () => {
    const cuerpo = { email: 'nuevo@prueba.com', nombre: 'Nuevo Usuario', clave: 'Clave-temporal-1', rol: 'vendedor', localId: accesorios };
    const creado = (await (await llamar(crearUsuario, admin, '/api/usuarios', json(cuerpo))).json()) as { id: string };
    expect(await marca(creado.id)).toBe(1);
    expect(await marca(vendedor.id)).toBe(0);
    expect(await marca(admin.id)).toBe(0);
  });

  it('mientras sea temporal el servidor rechaza todo salvo cambiarla; luego funciona con normalidad', async () => {
    await env.DB.prepare('UPDATE perfiles SET debe_cambiar_clave = 1 WHERE id = ?').bind(vendedor.id).run();

    const bloqueada = await llamar(locales, vendedor, '/api/locales');
    expect(bloqueada.status).toBe(403);
    expect(await codigo(bloqueada)).toBe('debe_cambiar_clave');

    // el estado de la cuenta (no usa conSesion) lo avisa para que la pantalla muestre el cambio obligatorio
    const e = (await (await llamar(estado, vendedor, '/api/cuenta/estado')).json()) as { usuario: { debe_cambiar_clave: boolean; sesion_iniciada_en: string; creado_en: string } };
    expect(e.usuario.debe_cambiar_clave).toBe(true);
    expect(Number.isNaN(Date.parse(e.usuario.sesion_iniciada_en))).toBe(false);
    expect(e.usuario.creado_en).toBeTruthy();

    expect((await cambiar(vendedor, vendedor.clave, 'Clave-propia-789')).status).toBe(200);
    expect(await marca(vendedor.id)).toBe(0);
    expect((await llamar(locales, vendedor, '/api/locales')).status).toBe(200);
  });

  it('cuando alguien le restablece la clave a otra persona esa clave vuelve a ser temporal; la que uno se pone a sí mismo, no', async () => {
    const r = await llamar(claveDeOtro, admin, `/api/usuarios/${vendedor.id}/clave`, json({ clave: 'Clave-restablecida-1' }), { id: vendedor.id });
    expect(r.status).toBe(200);
    expect(await marca(vendedor.id)).toBe(1);

    await env.DB.prepare('UPDATE perfiles SET debe_cambiar_clave = 1 WHERE id = ?').bind(admin.id).run();
    // un administrador con clave temporal solo puede cambiar la suya
    expect((await llamar(claveDeOtro, admin, `/api/usuarios/${admin.id}/clave`, json({ clave: 'Clave-del-admin-1' }), { id: admin.id })).status).toBe(403);
    expect((await cambiar(admin, admin.clave, 'Clave-del-admin-1')).status).toBe(200);
    expect(await marca(admin.id)).toBe(0);
  });
});
