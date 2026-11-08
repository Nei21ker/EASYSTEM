import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// auth.ts decide el modo al cargarse: cada prueba lo importa de nuevo con el entorno que necesita.
async function cargarAuth(modoServidor: boolean) {
  vi.resetModules();
  vi.stubEnv('PUBLIC_USAR_API', modoServidor ? 'true' : 'false');
  return import('../../src/lib/auth');
}

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });

function almacenSimulado() {
  const datos = new Map<string, string>();
  return {
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => void datos.set(k, v),
    removeItem: (k: string) => void datos.delete(k),
    clear: () => datos.clear(),
    get length() {
      return datos.size;
    },
    key: (i: number) => [...datos.keys()][i] ?? null,
  };
}

const leerUsuarios = () => JSON.parse(localStorage.getItem('easystem:usuarios')!) as { email: string; password: string; debe_cambiar_clave?: boolean }[];

beforeEach(() => {
  vi.stubGlobal('localStorage', almacenSimulado());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('cambiar mi clave en modo servidor', () => {
  it('la envía con la actual a /api/cuenta/clave y exige 8 caracteres y que sea distinta, sin tocar la red si no cumple', async () => {
    const fetchSimulado = vi.fn(async (_url: string, _init?: RequestInit) => json({ ok: true }));
    vi.stubGlobal('fetch', fetchSimulado);
    const { cambiarMiClave } = await cargarAuth(true);
    await expect(cambiarMiClave('actual-123', '1234567')).rejects.toThrow('al menos 8 caracteres');
    await expect(cambiarMiClave('actual-123', 'actual-123')).rejects.toThrow('distinta de la actual');
    expect(fetchSimulado).not.toHaveBeenCalled();

    await cambiarMiClave('actual-123', 'nueva-clave-1');
    expect(fetchSimulado.mock.calls[0][0]).toBe('/api/cuenta/clave');
    expect(JSON.parse(String(fetchSimulado.mock.calls[0][1]?.body))).toEqual({ actual: 'actual-123', nueva: 'nueva-clave-1' });
  });

  it('el mensaje de error del servidor (clave actual incorrecta) llega tal cual a la pantalla', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'La contraseña actual no es correcta.', codigo: 'clave_actual_incorrecta' }, 400)));
    const { cambiarMiClave } = await cargarAuth(true);
    await expect(cambiarMiClave('mala', 'nueva-clave-1')).rejects.toThrow('La contraseña actual no es correcta.');
  });

  it('la marca de clave temporal llega a la sesión, pero la copia para trabajar sin conexión NO la lleva (no se queda a nadie sin vender)', async () => {
    const usuario = { id: 'u1', email: 'v@x.com', nombre: 'Vera', rol: 'vendedor', local_id: 'L1', status: 'active', debe_cambiar_clave: true, sesion_iniciada_en: '2026-11-07T10:00:00.000Z', creado_en: '2026-10-01T00:00:00.000Z' };
    vi.stubGlobal('fetch', vi.fn(async () => json({ acceso: true, motivo: 'ok', usuario })));
    const { obtenerSesionActual } = await cargarAuth(true);
    expect(await obtenerSesionActual()).toMatchObject({ debe_cambiar_clave: true, sesion_iniciada_en: '2026-11-07T10:00:00.000Z', creado_en: '2026-10-01T00:00:00.000Z' });
    expect(JSON.parse(localStorage.getItem('easystem:sesion-servidor')!).debe_cambiar_clave).toBe(false);
  });

  it('con la clave temporal la página no carga: el guard se detiene (la ventana del perfil se abre sola)', async () => {
    const usuario = { id: 'u1', email: 'v@x.com', nombre: 'Vera', rol: 'vendedor', local_id: 'L1', status: 'active', debe_cambiar_clave: true };
    vi.stubGlobal('fetch', vi.fn(async () => json({ acceso: true, motivo: 'ok', usuario })));
    const { protegerPagina } = await cargarAuth(true);
    await expect(protegerPagina()).rejects.toThrow('EASYSTEM_REDIRECT');
  });
});

describe('cambiar mi clave en modo demo (LocalStorage)', () => {
  async function entrarComo(correo: string, clave: string) {
    const auth = await cargarAuth(false);
    await auth.iniciarSesion(correo, clave);
    return auth;
  }

  it('cualquier rol (aquí un vendedor) cambia la suya con la actual; la anterior deja de servir', async () => {
    const { cambiarMiClave, iniciarSesion } = await entrarComo('vendedor@edwardaccesorios.com', 'vendedor123');
    await expect(cambiarMiClave('equivocada', 'otra-clave-1')).rejects.toThrow('La contraseña actual no es correcta.');
    await cambiarMiClave('vendedor123', 'otra-clave-1');
    expect(leerUsuarios().find((u) => u.email.startsWith('vendedor@'))!.password).toBe('otra-clave-1');
    await expect(iniciarSesion('vendedor@edwardaccesorios.com', 'vendedor123')).rejects.toThrow('Correo o contraseña incorrectos.');
    await expect(iniciarSesion('vendedor@edwardaccesorios.com', 'otra-clave-1')).resolves.toMatchObject({ rol: 'vendedor' });
  });

  it('la cuenta que crea el administrador nace con la clave temporal, y al cambiarla la marca desaparece', async () => {
    const admin = await entrarComo('admin@edwardaccesorios.com', 'admin123');
    await admin.registrarUsuario({ email: 'nuevo@edwardaccesorios.com', password: 'temporal-1', nombre: 'Nuevo Cajero', rol: 'vendedor', local_id: '00000000-0000-4000-8000-000000000001' });
    expect(leerUsuarios().find((u) => u.email.startsWith('nuevo@'))!.debe_cambiar_clave).toBe(true);

    const nuevo = await entrarComo('nuevo@edwardaccesorios.com', 'temporal-1');
    expect((await nuevo.obtenerSesionActual())?.debe_cambiar_clave).toBe(true);
    await nuevo.cambiarMiClave('temporal-1', 'mi-propia-1');
    expect(leerUsuarios().find((u) => u.email.startsWith('nuevo@'))!.debe_cambiar_clave).toBe(false);
    expect((await nuevo.obtenerSesionActual())?.debe_cambiar_clave).toBe(false);
  });

  it('cuando el administrador le restablece la clave a otra persona vuelve a ser temporal', async () => {
    const admin = await entrarComo('admin@edwardaccesorios.com', 'admin123');
    const id = (JSON.parse(localStorage.getItem('easystem:usuarios')!) as { id: string; email: string }[]).find((u) => u.email.startsWith('vendedor@'))!.id;
    await admin.cambiarClaveUsuario(id, 'restablecida-1');
    expect(leerUsuarios().find((u) => u.email.startsWith('vendedor@'))!.debe_cambiar_clave).toBe(true);
  });
});
