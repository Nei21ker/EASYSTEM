import { beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos (script operativo)
import { generarClave, sentenciasAltaAdministrador, validarCorreo, LONGITUD_CLAVE } from '../../scripts/lib/admin.mjs';
import { crearAuth } from '../../src/server/auth';
import { cargarSesion } from '../../src/server/authz';
import { crearEntornoDePrueba, reiniciarBase, sembrarLocales } from './ayudas';

const env = crearEntornoDePrueba();

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
});

describe('generarClave', () => {
  it('tiene 16 caracteres, solo del alfabeto legible, y no se repite', () => {
    const claves = Array.from({ length: 200 }, () => generarClave() as string);
    expect(LONGITUD_CLAVE).toBe(16);
    for (const c of claves) expect(c).toMatch(/^[abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789]{16}$/);
    expect(new Set(claves).size).toBe(200);
  });

  it('usa crypto.getRandomValues (no Math.random)', () => {
    const original = Math.random;
    Math.random = () => {
      throw new Error('No debe usar Math.random');
    };
    try {
      expect(generarClave()).toHaveLength(16);
    } finally {
      Math.random = original;
    }
  });

  it('reparte los caracteres de forma pareja (sin sesgo evidente)', () => {
    const conteo = new Map<string, number>();
    for (let i = 0; i < 2000; i++) for (const c of generarClave() as string) conteo.set(c, (conteo.get(c) ?? 0) + 1);
    const valores = [...conteo.values()];
    expect(conteo.size).toBe(55);
    expect(Math.max(...valores) / Math.min(...valores)).toBeLessThan(1.5);
  });
});

describe('validarCorreo', () => {
  it('acepta correos normales y rechaza los inválidos o con comillas', () => {
    expect(validarCorreo('dueno@negocio.com')).toBe(true);
    for (const malo of ['', 'sin-arroba', 'a@b', 'a b@c.com', "x'; DROP TABLE user;--@a.com", 'a@@b.com']) expect(validarCorreo(malo)).toBe(false);
  });
});

describe('sentenciasAltaAdministrador', () => {
  const datos = { correo: ' Dueno@Negocio.com ', nombre: '  Edward   Pérez ', clave: 'Clave-Secreta-123' };

  it('inserta user, account y perfiles (administrador, sin local) y NO contiene la clave en claro', async () => {
    const sentencias = (await sentenciasAltaAdministrador(datos)) as string[];
    expect(sentencias).toHaveLength(3);
    expect(sentencias[0]).toMatch(/^INSERT INTO user /);
    expect(sentencias[1]).toMatch(/^INSERT INTO account /);
    expect(sentencias[2]).toMatch(/^INSERT INTO perfiles .*'administrador', NULL, 'active'/);
    expect(sentencias.join('\n')).not.toContain(datos.clave);
    expect(sentencias[1]).toMatch(/'pbkdf2\$100000\$/);
  });

  it('rechaza correos y nombres inválidos', async () => {
    await expect(sentenciasAltaAdministrador({ ...datos, correo: 'no-es-correo' })).rejects.toThrow('correo válido');
    await expect(sentenciasAltaAdministrador({ ...datos, nombre: ' ' })).rejects.toThrow('nombre');
  });

  it('un nombre con comilla no rompe el SQL (se escapa)', async () => {
    const sentencias = (await sentenciasAltaAdministrador({ ...datos, nombre: "Nicolás D'Alessandro" })) as string[];
    for (const s of sentencias) await env.DB.prepare(s).run();
    const fila = await env.DB.prepare('SELECT nombre FROM perfiles').first<{ nombre: string }>();
    expect(fila?.nombre).toBe("Nicolás D'Alessandro");
  });

  it('el usuario creado puede iniciar sesión con la clave, entra como administrador sin local y el correo queda en minúsculas', async () => {
    for (const s of (await sentenciasAltaAdministrador(datos)) as string[]) await env.DB.prepare(s).run();
    const auth = crearAuth(env, 'https://sitio.test');
    const iniciar = (password: string) =>
      auth.handler(
        new Request('https://sitio.test/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'https://sitio.test' },
          body: JSON.stringify({ email: 'dueno@negocio.com', password }),
        })
      );
    const respuesta = await iniciar(datos.clave);
    expect(respuesta.status).toBe(200);
    const cookie = respuesta.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const sesion = await cargarSesion(env, new Request('https://sitio.test/api/x', { headers: { cookie } }));
    expect(sesion).toMatchObject({ email: 'dueno@negocio.com', nombre: 'Edward Pérez', rol: 'administrador', localId: null, status: 'active' });

    expect((await iniciar('otra-clave')).status).toBe(401);
  });

  it('el mismo correo no se puede dar de alta dos veces (no deja nada a medias)', async () => {
    for (const s of (await sentenciasAltaAdministrador(datos)) as string[]) await env.DB.prepare(s).run();
    const repetido = (await sentenciasAltaAdministrador(datos)) as string[];
    await expect(env.DB.batch(repetido.map((s) => env.DB.prepare(s)))).rejects.toThrow();
    expect((await env.DB.prepare('SELECT count(*) AS n FROM perfiles').first<{ n: number }>())?.n).toBe(1);
  });
});
