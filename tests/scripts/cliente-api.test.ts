import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos (script operativo)
import { crearClienteApi } from '../../scripts/lib/cliente-api.mjs';

function respuesta(cuerpo: unknown, status = 200, cabeceras: Record<string, string | string[]> = {}) {
  const h = new Headers({ 'content-type': 'application/json' });
  for (const [k, v] of Object.entries(cabeceras)) for (const valor of Array.isArray(v) ? v : [v]) h.append(k, valor);
  return new Response(JSON.stringify(cuerpo), { status, headers: h });
}

describe('cliente de API de los scripts', () => {
  it('inicia sesión con el origen correcto y reenvía la cookie en las llamadas siguientes', async () => {
    const fetchSimulado = vi.fn(async (url: string, init?: RequestInit) =>
      url.endsWith('/api/auth/sign-in/email')
        ? respuesta({ ok: true }, 200, { 'set-cookie': ['better-auth.session_token=abc.def; Path=/; HttpOnly; SameSite=Lax', 'otra=1; Path=/'] })
        : respuesta([{ id: 1 }])
    );
    const api = crearClienteApi('https://easystem.example.workers.dev/', fetchSimulado);
    await api.iniciarSesion('dueno@negocio.com', 'clave');
    expect(await api.get('/api/productos')).toEqual([{ id: 1 }]);

    const [urlLogin, initLogin] = fetchSimulado.mock.calls[0];
    expect(urlLogin).toBe('https://easystem.example.workers.dev/api/auth/sign-in/email');
    expect((initLogin!.headers as Record<string, string>).origin).toBe('https://easystem.example.workers.dev');
    expect(JSON.parse(String(initLogin!.body))).toEqual({ email: 'dueno@negocio.com', password: 'clave' });
    const initGet = fetchSimulado.mock.calls[1][1]!;
    expect((initGet.headers as Record<string, string>).cookie).toBe('better-auth.session_token=abc.def; otra=1');
  });

  it('una clave incorrecta da un mensaje claro y no deja la clave en el error', async () => {
    const api = crearClienteApi('http://localhost:8787', async () => respuesta({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }, 401));
    const error = await api.iniciarSesion('a@b.com', 'secreta-123').catch((e: Error) => e);
    expect(error.message).toMatch(/correo o la contraseña/i);
    expect(error.message).not.toContain('secreta-123');
  });

  it('los errores del servidor llegan con su mensaje en español', async () => {
    const api = crearClienteApi('http://localhost:8787', async () => respuesta({ error: 'No tienes permiso.', codigo: 'sin_permiso' }, 403));
    await expect(api.post('/api/productos/lote', { filas: [] })).rejects.toThrow('No tienes permiso.');
  });

  it('subir envía los bytes con su tipo y devuelve la url', async () => {
    const fetchSimulado = vi.fn(async (_url: string, _init?: RequestInit) => respuesta({ url: '/api/archivos/publico/productos/p/1.jpg' }));
    const api = crearClienteApi('http://localhost:8787', fetchSimulado);
    const bytes = Buffer.from([1, 2, 3]);
    expect(await api.subir('/api/archivos/producto/p', bytes, 'image/jpeg')).toBe('/api/archivos/publico/productos/p/1.jpg');
    const init = fetchSimulado.mock.calls[0][1]!;
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['content-type']).toBe('image/jpeg');
  });

  it('un fallo de red explica que no se pudo conectar y a qué dirección', async () => {
    const api = crearClienteApi('http://localhost:8787', async () => {
      throw new TypeError('fetch failed');
    });
    await expect(api.get('/api/productos')).rejects.toThrow(/no pude conectar.*localhost:8787/i);
  });
});
