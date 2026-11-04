import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ErrorDeApi } from '../../src/lib/api';
import { esErrorDeRed } from '../../src/utils/red';

const respuestaJson = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('una respuesta de error del servidor lanza un Error con su mensaje en español', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuestaJson({ error: 'No tienes permiso.', codigo: 'sin_permiso' }, 403)));
    const error = await api.get('/api/x').catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ErrorDeApi);
    expect(error.message).toBe('No tienes permiso.');
    expect(error.status).toBe(403);
    expect(error.codigo).toBe('sin_permiso');
  });

  it('un fallo de red produce un error que esErrorDeRed reconoce', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const error = await api.post('/api/x', {}).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(esErrorDeRed(error)).toBe(true);
  });

  it('un error de negocio NO se confunde con un fallo de red', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuestaJson({ error: 'Stock insuficiente de "Forro".' }, 409)));
    const error = await api.post('/api/x', {}).catch((e) => e);
    expect(esErrorDeRed(error)).toBe(false);
  });

  it('get serializa el query y omite los valores vacíos', async () => {
    const fetchSimulado = vi.fn(async (_url: string, _init?: RequestInit) => respuestaJson({ ok: true }));
    vi.stubGlobal('fetch', fetchSimulado);
    await api.get('/api/ventas', { desde: '2026-11-01', hasta: undefined, limite: 50, soloMias: true, localId: null });
    expect(fetchSimulado.mock.calls[0][0]).toBe('/api/ventas?desde=2026-11-01&limite=50&soloMias=true');
  });

  it('todas las llamadas llevan la cookie de sesión y post envía JSON', async () => {
    const fetchSimulado = vi.fn(async (_url: string, _init?: RequestInit) => respuestaJson({ id: 'a' }));
    vi.stubGlobal('fetch', fetchSimulado);
    expect(await api.post<{ id: string }>('/api/ordenes', { a: 1 })).toEqual({ id: 'a' });
    const init = fetchSimulado.mock.calls[0][1]!;
    expect(init.credentials).toBe('include');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('subir envía los bytes con su tipo y devuelve la url (o la ruta si es un archivo privado)', async () => {
    const fetchSimulado = vi.fn(async (url: string, _init?: RequestInit) =>
      respuestaJson(url.includes('/privado/') ? { ruta: 'cuadres-caja/x.jpg' } : { url: '/api/archivos/publico/productos/p/1.jpg' })
    );
    vi.stubGlobal('fetch', fetchSimulado);
    const foto = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    expect(await api.subir('/api/archivos/producto/p', foto, 'image/jpeg')).toBe('/api/archivos/publico/productos/p/1.jpg');
    expect(await api.subir('/api/archivos/privado/cuadres-caja/x.jpg', foto, 'image/jpeg')).toBe('cuadres-caja/x.jpg');
    const init = fetchSimulado.mock.calls[0][1]!;
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(foto);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('image/jpeg');
  });

  it('una respuesta sin JSON (por ejemplo 502) da un mensaje comprensible', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad gateway', { status: 502 })));
    const error = await api.get('/api/x').catch((e) => e);
    expect(error.message).toMatch(/502/);
  });
});
