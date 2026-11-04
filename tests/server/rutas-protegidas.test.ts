/// <reference types="vite/client" />
// Recorre TODAS las rutas de /api: ninguna puede quedar sin sesión por olvido, y todas deben poder cargarse
// (una ruta con un import mal escrito rompe el build recién en producción: aquí se detecta al instante).
import { describe, expect, it } from 'vitest';
import { crearAuth } from '../../src/server/auth';
import { crearEntornoDePrueba } from './ayudas';

const fuentes = import.meta.glob('../../src/pages/api/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const modulos = import.meta.glob('../../src/pages/api/**/*.ts') as Record<string, () => Promise<Record<string, unknown>>>;

const nombre = (ruta: string) => ruta.replace('../../src/pages/api/', '');

// Rutas que a propósito NO usan `conSesion`, con la razón
const PUBLICAS: Record<string, string> = {
  'salud.ts': 'estado del servicio para monitoreo; no devuelve datos',
  'auth/[...todo].ts': 'Better-Auth: inicio y cierre de sesión (el registro público está deshabilitado)',
  'archivos/publico/[...ruta].ts': 'fotos de producto: solo claves con la forma productos/<id>/<n>.jpg',
  'cuenta/estado.ts': 'responde el MOTIVO del bloqueo (200) en vez de lanzar 401; sin sesión devuelve 401 igualmente',
};

describe('rutas de la API', () => {
  const archivos = Object.keys(fuentes).sort();

  it('hay rutas que revisar (la búsqueda de archivos funciona)', () => {
    expect(archivos.length).toBeGreaterThan(40);
  });

  it('toda ruta usa conSesion, salvo la lista blanca (cada excepción está justificada)', () => {
    const sinSesion = archivos.filter((a) => !/conSesion\(/.test(fuentes[a])).map(nombre);
    expect(sinSesion.sort()).toEqual(Object.keys(PUBLICAS).sort());
  });

  it('la lista blanca no tiene entradas viejas (todas existen)', () => {
    const existentes = new Set(archivos.map(nombre));
    for (const excepcion of Object.keys(PUBLICAS)) expect(existentes.has(excepcion)).toBe(true);
  });

  it('las rutas públicas no escriben datos ni exponen nada fuera de lo previsto', async () => {
    // salud: solo GET; archivos/publico: solo GET; estado: solo GET y exige sesión por dentro
    expect(fuentes['../../src/pages/api/salud.ts']).not.toMatch(/export const (POST|PUT|PATCH|DELETE)/);
    expect(fuentes['../../src/pages/api/archivos/publico/[...ruta].ts']).not.toMatch(/export const (POST|PUT|PATCH|DELETE)/);
    expect(fuentes['../../src/pages/api/cuenta/estado.ts']).toMatch(/estadoCuenta\(/);
    // el registro público de Better-Auth sigue deshabilitado
    const respuesta = await crearAuth(crearEntornoDePrueba(), 'https://sitio.test').handler(
        new Request('https://sitio.test/api/auth/sign-up/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'https://sitio.test' },
          body: JSON.stringify({ email: 'intruso@x.com', password: 'clave-larga-123', name: 'Intruso' }),
        })
      );
    expect(respuesta.status).toBeGreaterThanOrEqual(400);
  }, 20_000);

  it('toda ruta declara prerender = false (si no, Astro la convertiría en un archivo estático)', () => {
    const sinDeclarar = archivos.filter((a) => !/export const prerender = false/.test(fuentes[a])).map(nombre);
    expect(sinDeclarar).toEqual([]);
  });

  it('toda ruta carga: sus imports existen y solo exporta métodos HTTP válidos', async () => {
    const METODOS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ALL', 'prerender']);
    for (const archivo of archivos) {
      const modulo = await modulos[archivo]();
      const exportados = Object.keys(modulo);
      expect(exportados.length, `${nombre(archivo)} no exporta nada`).toBeGreaterThan(0);
      for (const clave of exportados) expect(METODOS.has(clave), `${nombre(archivo)} exporta "${clave}"`).toBe(true);
      expect(exportados.some((c) => c !== 'prerender'), `${nombre(archivo)} no exporta ningún método`).toBe(true);
    }
  });
});
