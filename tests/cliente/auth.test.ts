import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// auth.ts decide el modo al cargarse: cada prueba lo importa de nuevo con el entorno que necesita.
async function cargarAuth(modoServidor: boolean) {
  vi.resetModules();
  vi.stubEnv('PUBLIC_USAR_API', modoServidor ? 'true' : 'false');
  return import('../../src/lib/auth');
}

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
const usuario = { id: 'u1', email: 'v@x.com', nombre: 'Vera', rol: 'vendedor', local_id: 'L1', status: 'active' };

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

beforeEach(() => {
  vi.stubGlobal('localStorage', almacenSimulado());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('auth en modo servidor', () => {
  it('iniciar sesión con datos incorrectos da el mensaje en español (por el código de Better-Auth)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }, 401)));
    const { iniciarSesion } = await cargarAuth(true);
    await expect(iniciarSesion('v@x.com', 'mala')).rejects.toThrow('Correo o contraseña incorrectos.');
  });

  it('iniciar sesión envía el correo y la contraseña y devuelve la sesión del servidor', async () => {
    const llamadas: [string, RequestInit | undefined][] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      llamadas.push([url, init]);
      return url.startsWith('/api/auth/') ? json({ ok: true }) : json({ acceso: true, motivo: 'ok', usuario });
    }));
    const { iniciarSesion } = await cargarAuth(true);
    const sesion = await iniciarSesion(' v@x.com ', 'clave-segura');
    expect(sesion).toMatchObject({ id: 'u1', rol: 'vendedor', local_id: 'L1' });
    expect(llamadas[0][0]).toBe('/api/auth/sign-in/email');
    expect(JSON.parse(String(llamadas[0][1]?.body))).toEqual({ email: 'v@x.com', password: 'clave-segura' });
  });

  it('sin sesión (401) no hay sesión actual y se olvida la guardada', async () => {
    localStorage.setItem('easystem:sesion-servidor', JSON.stringify(usuario));
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'Tu sesión expiró.', codigo: 'sin_sesion' }, 401)));
    const { obtenerSesionActual, obtenerEstadoCuenta } = await cargarAuth(true);
    expect(await obtenerSesionActual()).toBeNull();
    expect(localStorage.getItem('easystem:sesion-servidor')).toBeNull();
    expect(await obtenerEstadoCuenta()).toEqual({ acceso: false, motivo: 'sin_perfil' });
  });

  it('sin conexión se sigue con la última sesión conocida y NO se bloquea la cuenta', async () => {
    localStorage.setItem('easystem:sesion-servidor', JSON.stringify({ id: 'u1', email: 'v@x.com', nombre: 'Vera', rol: 'vendedor', local_id: 'L1' }));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const { obtenerSesionActual, obtenerEstadoCuenta } = await cargarAuth(true);
    expect(await obtenerSesionActual()).toMatchObject({ id: 'u1', rol: 'vendedor' });
    expect(await obtenerEstadoCuenta()).toEqual({ acceso: true, motivo: 'ok' });
  });

  it('un usuario suspendido recibe el motivo que responde el servidor, sin los datos del usuario', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      json(url === '/api/cuenta/estado' ? { acceso: false, motivo: 'local_suspendido', usuario } : {})
    ));
    const { obtenerEstadoCuenta } = await cargarAuth(true);
    expect(await obtenerEstadoCuenta()).toEqual({ acceso: false, motivo: 'local_suspendido' });
  });

  it('cambiar la contraseña exige 8 caracteres en modo servidor y la envía a la ruta del usuario', async () => {
    const fetchSimulado = vi.fn(async (_url: string, _init?: RequestInit) => json({ ok: true }));
    vi.stubGlobal('fetch', fetchSimulado);
    const { cambiarClaveUsuario } = await cargarAuth(true);
    await expect(cambiarClaveUsuario('u2', '1234567')).rejects.toThrow('al menos 8 caracteres');
    await cambiarClaveUsuario('u2', '12345678');
    expect(fetchSimulado.mock.calls[0][0]).toBe('/api/usuarios/u2/clave');
  });

  it('crear un usuario manda localId solo para los roles con local', async () => {
    const fetchSimulado = vi.fn(async (url: string, _init?: RequestInit) =>
      json(url === '/api/cuenta/estado' ? { acceso: true, motivo: 'ok', usuario: { ...usuario, rol: 'administrador', local_id: null } } : { id: 'nuevo' })
    );
    vi.stubGlobal('fetch', fetchSimulado);
    const { registrarUsuario } = await cargarAuth(true);
    await registrarUsuario({ email: ' Nuevo@X.com ', password: 'clave-segura', nombre: ' Nico ', rol: 'gerente', local_id: 'L1' });
    const envio = fetchSimulado.mock.calls.find(([url]) => url === '/api/usuarios')!;
    expect(JSON.parse(String(envio[1]?.body))).toEqual({ email: 'nuevo@x.com', nombre: 'Nico', clave: 'clave-segura', rol: 'gerente', localId: null });
  });
});

describe('cerrar sesión', () => {
  it('borra las cachés de datos (ventas, productos…) pero conserva lo que aún no se sincronizó', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true })));
    for (const clave of ['easystem:cache:ventas', 'easystem:cache:productos', 'easystem:cache:tasa', 'easystem:sesion-servidor']) localStorage.setItem(clave, '[]');
    localStorage.setItem('easystem:cola-ventas', '[{"pendiente":1}]');
    const { cerrarSesion } = await cargarAuth(true);
    await cerrarSesion();
    for (const clave of ['easystem:cache:ventas', 'easystem:cache:productos', 'easystem:cache:tasa', 'easystem:sesion-servidor']) expect(localStorage.getItem(clave), clave).toBeNull();
    expect(localStorage.getItem('easystem:cola-ventas')).not.toBeNull();
  });
});

describe('auth en modo demo', () => {
  it('no toca la red: inicia sesión contra el simulador de LocalStorage', async () => {
    const fetchSimulado = vi.fn();
    vi.stubGlobal('fetch', fetchSimulado);
    const { iniciarSesion, obtenerSesionActual } = await cargarAuth(false);
    const sesion = await iniciarSesion('admin@edwardaccesorios.com', 'admin123');
    expect(sesion.rol).toBe('administrador');
    expect((await obtenerSesionActual())?.email).toBe('admin@edwardaccesorios.com');
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it('la contraseña incorrecta se rechaza igual que antes', async () => {
    const { iniciarSesion } = await cargarAuth(false);
    await expect(iniciarSesion('admin@edwardaccesorios.com', 'otra')).rejects.toThrow('Correo o contraseña incorrectos.');
  });
});

describe('jerarquía de roles al crear usuarios', () => {
  it('el gerente asigna encargado, vendedor, técnico y contador; nunca administrador ni gerente', async () => {
    const { rolesAsignables, puedeGestionarUsuario } = await cargarAuth(false);
    expect(rolesAsignables('gerente').sort()).toEqual(['contador', 'encargado', 'tecnico', 'vendedor']);
    expect(puedeGestionarUsuario('gerente', 'contador')).toBe(true);
    expect(puedeGestionarUsuario('gerente', 'gerente')).toBe(false);
    expect(puedeGestionarUsuario('gerente', 'administrador')).toBe(false);
  });

  it('encargado, vendedor, técnico y contador no asignan ningún rol', async () => {
    const { rolesAsignables } = await cargarAuth(false);
    for (const rol of ['encargado', 'vendedor', 'tecnico', 'contador'] as const) expect(rolesAsignables(rol)).toEqual([]);
  });
});

describe('al entrar a una página se consulta el estado de la cuenta UNA sola vez', () => {
  it('la respuesta que trae la sesión sirve también para el estado: no hay una segunda petición seguida', async () => {
    const pedidas: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      pedidas.push(url);
      return json({ acceso: true, motivo: 'ok', local_nombre: 'Local Accesorios', usuario });
    }));
    const { obtenerSesionActual, estadoDeEntrada } = await cargarAuth(true);
    await obtenerSesionActual();
    expect(await estadoDeEntrada()).toMatchObject({ acceso: true, motivo: 'ok', local_nombre: 'Local Accesorios' });
    expect(pedidas).toEqual(['/api/cuenta/estado']);
  });

  it('la respuesta se usa una vez: la siguiente revisión (cada minuto) sí consulta al servidor', async () => {
    const pedidas: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      pedidas.push(url);
      return json({ acceso: true, motivo: 'ok', usuario });
    }));
    const { obtenerSesionActual, estadoDeEntrada, obtenerEstadoCuenta } = await cargarAuth(true);
    await obtenerSesionActual();
    await estadoDeEntrada();
    await obtenerEstadoCuenta();
    expect(pedidas.length).toBe(2);
  });

  it('un estado que bloquea (local suspendido) también se respeta sin pedirlo otra vez', async () => {
    const fetchSimulado = vi.fn(async () => json({ acceso: false, motivo: 'local_suspendido', usuario }));
    vi.stubGlobal('fetch', fetchSimulado);
    const { obtenerSesionActual, estadoDeEntrada } = await cargarAuth(true);
    await obtenerSesionActual();
    expect(await estadoDeEntrada()).toMatchObject({ acceso: false, motivo: 'local_suspendido' });
    expect(fetchSimulado).toHaveBeenCalledTimes(1);
  });

  it('sin respuesta guardada (modo demo, o sesión de otra carga) cae a la consulta normal', async () => {
    const { obtenerSesionActual, estadoDeEntrada } = await cargarAuth(false);
    localStorage.setItem('easystem:sesion', JSON.stringify({ id: 'u1', email: 'a@x.com', nombre: 'A', rol: 'administrador', local_id: null }));
    await obtenerSesionActual();
    await expect(estadoDeEntrada()).resolves.toBeDefined();
  });
});

describe('editar nombre y correo de un usuario', () => {
  it('en modo servidor viajan en el PATCH junto con lo demás (correo en minúsculas, nombre sin espacios de más)', async () => {
    const llamadas: { url: string; cuerpo: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      llamadas.push({ url: String(url), cuerpo: JSON.parse(String(init?.body ?? '{}')) });
      return json({ ok: true });
    }));
    const { actualizarAccesoUsuario } = await cargarAuth(true);
    await actualizarAccesoUsuario('u1', { nombre: '  Vera   Nueva ', email: ' VERA@X.COM ', rol: 'tecnico', local_id: 'L2' });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).toMatch(/\/api\/usuarios\/u1$/);
    expect(llamadas[0].cuerpo).toMatchObject({ nombre: 'Vera Nueva', email: 'vera@x.com', rol: 'tecnico', localId: 'L2' });
  });

  it('rechaza un correo o un nombre inválido antes de llamar al servidor', async () => {
    const fetchSimulado = vi.fn(async () => json({ ok: true }));
    vi.stubGlobal('fetch', fetchSimulado);
    const { actualizarAccesoUsuario } = await cargarAuth(true);
    await expect(actualizarAccesoUsuario('u1', { email: 'sin-arroba' })).rejects.toThrow(/correo válido/i);
    await expect(actualizarAccesoUsuario('u1', { nombre: ' a ' })).rejects.toThrow(/nombre/i);
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it('en la demo cambia el nombre y el correo, y rechaza un correo que ya usa otra cuenta', async () => {
    const { iniciarSesion, actualizarAccesoUsuario, listarUsuarios } = await cargarAuth(false);
    await iniciarSesion('admin@edwardaccesorios.com', 'admin123');
    const vendedor = (await listarUsuarios()).find((u) => u.rol === 'vendedor')!;
    const encargado = (await listarUsuarios()).find((u) => u.rol === 'encargado')!;
    await actualizarAccesoUsuario(vendedor.id, { nombre: 'Vera Nueva', email: 'Vera.Nueva@edwardaccesorios.com' });
    const despues = (await listarUsuarios()).find((u) => u.id === vendedor.id)!;
    expect(despues).toMatchObject({ nombre: 'Vera Nueva', email: 'vera.nueva@edwardaccesorios.com' });
    await expect(actualizarAccesoUsuario(vendedor.id, { email: encargado.email.toUpperCase() })).rejects.toThrow(/ya existe un usuario con ese correo/i);
    // Entra con el correo nuevo y la misma contraseña
    await expect(iniciarSesion('vera.nueva@edwardaccesorios.com', 'vendedor123')).resolves.toMatchObject({ id: vendedor.id });
  });
});
