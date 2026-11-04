import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, reiniciarBase } from './ayudas';
import { crearAuth, crearUsuarioInterno } from '../../src/server/auth';
import { verificarClave } from '../../src/server/password';

const env = crearEntornoDePrueba();
const ORIGEN = 'http://localhost:8787';
const L1 = '00000000-0000-4000-8000-000000000001';

function peticion(ruta: string, cuerpo?: unknown, cookie?: string) {
  const auth = crearAuth(env, ORIGEN);
  return auth.handler(
    new Request(`${ORIGEN}/api/auth${ruta}`, {
      method: cuerpo === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGEN, ...(cookie ? { cookie } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    })
  );
}

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await env.DB.prepare("INSERT INTO locales (id, nombre, tipo) VALUES (?, 'Local Accesorios', 'accesorios')").bind(L1).run();
});

describe('autenticación', () => {
  it('el registro público está cerrado', async () => {
    const respuesta = await peticion('/sign-up/email', { email: 'intruso@ejemplo.com', password: 'Clave-123-abc', name: 'Intruso' });
    expect(respuesta.status).toBeGreaterThanOrEqual(400);
    const fila = await env.DB.prepare("SELECT count(*) AS n FROM user WHERE email = 'intruso@ejemplo.com'").first<{ n: number }>();
    expect(fila?.n).toBe(0);
  });

  it('inicia sesión con la clave correcta y entrega la cookie de sesión', async () => {
    await crearUsuarioInterno(env, { email: 'Dueno@Ejemplo.com', nombre: 'Dueño', clave: 'Clave-123-abc', rol: 'administrador', localId: null });
    const respuesta = await peticion('/sign-in/email', { email: 'dueno@ejemplo.com', password: 'Clave-123-abc' });
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get('set-cookie') ?? '').toContain('session_token');
  });

  it('rechaza una clave incorrecta con 401 y el código INVALID_EMAIL_OR_PASSWORD', async () => {
    await crearUsuarioInterno(env, { email: 'dueno@ejemplo.com', nombre: 'Dueño', clave: 'Clave-123-abc', rol: 'administrador', localId: null });
    const respuesta = await peticion('/sign-in/email', { email: 'dueno@ejemplo.com', password: 'otra-clave' });
    expect(respuesta.status).toBe(401);
    expect(((await respuesta.json()) as { code: string }).code).toBe('INVALID_EMAIL_OR_PASSWORD');
  });

  it('con la cookie, la sesión devuelve al usuario', async () => {
    const id = await crearUsuarioInterno(env, { email: 'dueno@ejemplo.com', nombre: 'Dueño', clave: 'Clave-123-abc', rol: 'administrador', localId: null });
    const login = await peticion('/sign-in/email', { email: 'dueno@ejemplo.com', password: 'Clave-123-abc' });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const sesion = await peticion('/get-session', undefined, cookie);
    const cuerpo = (await sesion.json()) as { user: { id: string; email: string } };
    expect(cuerpo.user.id).toBe(id);
    expect(cuerpo.user.email).toBe('dueno@ejemplo.com');
  });
});

describe('crearUsuarioInterno', () => {
  it('crea usuario, cuenta con hash PBKDF2 (nunca la clave) y perfil con rol y local', async () => {
    const id = await crearUsuarioInterno(env, { email: 'Ana@Ejemplo.com', nombre: 'Ana Pérez', clave: 'Clave-123-abc', rol: 'encargado', localId: L1 });
    const perfil = await env.DB.prepare('SELECT email, nombre, rol, local_id, status FROM perfiles WHERE id = ?').bind(id).first();
    expect(perfil).toEqual({ email: 'ana@ejemplo.com', nombre: 'Ana Pérez', rol: 'encargado', local_id: L1, status: 'active' });
    const cuenta = await env.DB.prepare("SELECT password, providerId FROM account WHERE userId = ?").bind(id).first<{ password: string; providerId: string }>();
    expect(cuenta?.providerId).toBe('credential');
    expect(cuenta?.password).not.toContain('Clave-123-abc');
    expect(await verificarClave('Clave-123-abc', cuenta!.password)).toBe(true);
  });

  it('rechaza un correo repetido sin dejar filas a medias', async () => {
    await crearUsuarioInterno(env, { email: 'ana@ejemplo.com', nombre: 'Ana', clave: 'Clave-123-abc', rol: 'vendedor', localId: L1 });
    await expect(
      crearUsuarioInterno(env, { email: 'ANA@ejemplo.com', nombre: 'Otra Ana', clave: 'Clave-456-def', rol: 'vendedor', localId: L1 })
    ).rejects.toThrow();
    const cuentas = await env.DB.prepare('SELECT count(*) AS n FROM account').first<{ n: number }>();
    const perfiles = await env.DB.prepare('SELECT count(*) AS n FROM perfiles').first<{ n: number }>();
    expect(cuentas?.n).toBe(1);
    expect(perfiles?.n).toBe(1);
  });

  it('rechaza una clave demasiado corta', async () => {
    await expect(
      crearUsuarioInterno(env, { email: 'ana@ejemplo.com', nombre: 'Ana', clave: 'corta', rol: 'vendedor', localId: L1 })
    ).rejects.toThrow('La contraseña debe tener al menos 8 caracteres.');
  });
});
