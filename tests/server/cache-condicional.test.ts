// Las lecturas (GET) de la API llevan ETag y se pueden revalidar: si nada cambió el servidor responde 304 SIN cuerpo
// (en una red lenta, una lista de cientos de productos que no cambió deja de descargarse entera cada vez).
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { GET as listarProductos, POST as crearProducto } from '../../src/pages/api/productos/index';
import { GET as cambios } from '../../src/pages/api/cambios';

const env = crearEntornoDePrueba();
let admin: UsuarioDePrueba;

type Ruta = (contexto: never) => Promise<Response> | Response;
const llamar = (ruta: unknown, usuario: UsuarioDePrueba | null, url: string, init: RequestInit = {}) =>
  (ruta as Ruta)({ request: peticionComo(usuario, url, init), params: {} } as never) as Promise<Response>;

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
});

const nuevoProducto = (n: number): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ codigo_barras: `200000000${n}`, nombre: `Cargador ${n}`, categoria: 'Cargadores', precio_venta: 5 }),
});

describe('lecturas con ETag', () => {
  it('un GET responde con ETag, caché privada que se revalida siempre, y Vary por cookie', async () => {
    const r = await llamar(listarProductos, admin, '/api/productos');
    expect(r.status).toBe(200);
    expect(r.headers.get('etag')).toMatch(/^"[A-Za-z0-9_-]{8,}"$/);
    expect(r.headers.get('cache-control')).toBe('private, no-cache');
    expect(r.headers.get('vary')?.toLowerCase()).toContain('cookie');
  });

  it('con If-None-Match igual responde 304 sin cuerpo', async () => {
    const primera = await llamar(listarProductos, admin, '/api/productos');
    const etag = primera.headers.get('etag')!;
    const segunda = await llamar(listarProductos, admin, '/api/productos', { headers: { 'if-none-match': etag } });
    expect(segunda.status).toBe(304);
    expect(await segunda.text()).toBe('');
    expect(segunda.headers.get('etag')).toBe(etag);
  });

  it('si los datos cambiaron responde 200 con otro ETag y el cuerpo nuevo', async () => {
    const antes = await llamar(listarProductos, admin, '/api/productos');
    const etagViejo = antes.headers.get('etag')!;
    expect((await llamar(crearProducto, admin, '/api/productos', nuevoProducto(1))).status).toBe(200);
    const despues = await llamar(listarProductos, admin, '/api/productos', { headers: { 'if-none-match': etagViejo } });
    expect(despues.status).toBe(200);
    expect(despues.headers.get('etag')).not.toBe(etagViejo);
    expect(((await despues.json()) as unknown[]).length).toBe(1);
  });

  it('un ETag que no es el actual (o "*" mal usado) no da 304', async () => {
    const r = await llamar(listarProductos, admin, '/api/productos', { headers: { 'if-none-match': '"otro"' } });
    expect(r.status).toBe(200);
  });

  it('las escrituras (POST) no llevan ETag ni se pueden responder con 304', async () => {
    const r = await llamar(crearProducto, admin, '/api/productos', { ...nuevoProducto(2), headers: { 'content-type': 'application/json', 'if-none-match': '*' } });
    expect(r.status).toBe(200);
    expect(r.headers.get('etag')).toBeNull();
  });

  it('un error (sin sesión) no lleva ETag', async () => {
    const r = await llamar(listarProductos, null, '/api/productos');
    expect(r.status).toBe(401);
    expect(r.headers.get('etag')).toBeNull();
  });

  it('la consulta de cambios en vivo también revalida (responde 304 si no hubo cambios)', async () => {
    const a = await llamar(cambios, admin, '/api/cambios');
    const b = await llamar(cambios, admin, '/api/cambios', { headers: { 'if-none-match': a.headers.get('etag')! } });
    expect(b.status).toBe(304);
  });
});
