import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Rol, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { limpiarPresencia, listarUsuariosActivos, registrarLatido } from '../../src/server/servicios/presencia';
import { POST as latido } from '../../src/pages/api/presence/heartbeat';
import { GET as activos } from '../../src/pages/api/admin/active-users';

const env = crearEntornoDePrueba();
const { accesorios, vidrios } = IDS_LOCALES;
const T0 = Date.UTC(2026, 10, 4, 15, 0, 0); // un instante fijo: las pruebas controlan el reloj
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

let admin: UsuarioDePrueba;
let sAdmin: Sesion;

async function usuario(rol: Rol, localId: string | null, nombre?: string) {
  const u = await crearUsuarioDePrueba(env, { rol, localId, nombre });
  return { u, s: await cargarSesion(env, peticionComo(u)) };
}
const origen = (ip = '190.1.2.3', ua = CHROME) => ({ ip, userAgent: ua });
const fila = (id: string) => env.DB.prepare('SELECT * FROM presencia WHERE user_id = ?').bind(id).first<Record<string, unknown>>();

async function rechazo(promesa: Promise<unknown>, status: number): Promise<void> {
  try {
    await promesa;
  } catch (err) {
    expect(err).toBeInstanceOf(ErrorApi);
    expect((err as ErrorApi).status).toBe(status);
    return;
  }
  throw new Error('Debía rechazarse y no se rechazó');
}

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  ({ u: admin, s: sAdmin } = await usuario('administrador', null, 'Neiker Flores'));
});

describe('registrarLatido', () => {
  it('guarda la última vez visto, la IP, el dispositivo y la pantalla de quien lo manda', async () => {
    const { s } = await usuario('vendedor', accesorios, 'Ana Pérez');
    await registrarLatido(env, s, { ruta: '/ventas' }, origen(), T0);
    const f = await fila(s.userId);
    expect(f).toMatchObject({ last_seen_at: T0, salio_en: null, ip: '190.1.2.3', dispositivo: 'Chrome · Windows', ruta: '/ventas', local_id: accesorios });
  });

  it('un latido seguido (menos de 10 s) NO vuelve a escribir en la base de datos', async () => {
    const { s } = await usuario('vendedor', accesorios);
    await registrarLatido(env, s, { ruta: '/ventas' }, origen(), T0);
    await registrarLatido(env, s, { ruta: '/productos' }, origen(), T0 + 5_000);
    expect((await fila(s.userId))!.last_seen_at).toBe(T0);
    expect((await fila(s.userId))!.ruta).toBe('/ventas');
    await registrarLatido(env, s, { ruta: '/productos' }, origen(), T0 + 30_000);
    expect(await fila(s.userId)).toMatchObject({ last_seen_at: T0 + 30_000, ruta: '/productos' });
  });

  it('un vendedor no puede declarar otro local: se usa el de su perfil', async () => {
    const { s } = await usuario('vendedor', accesorios);
    await registrarLatido(env, s, { local_id: vidrios }, origen(), T0);
    expect((await fila(s.userId))!.local_id).toBe(accesorios);
  });

  it('administrador y gerente informan el local que están mirando (o ninguno = Todos)', async () => {
    await registrarLatido(env, sAdmin, { local_id: vidrios }, origen(), T0);
    expect((await fila(sAdmin.userId))!.local_id).toBe(vidrios);
    await registrarLatido(env, sAdmin, { local_id: null }, origen(), T0 + 40_000);
    expect((await fila(sAdmin.userId))!.local_id).toBeNull();
  });

  it('ignora datos raros: ruta que no empieza con "/" o demasiado larga, local_id gigante', async () => {
    await registrarLatido(env, sAdmin, { ruta: 'javascript:alert(1)', local_id: 'x'.repeat(500) } as never, origen(), T0);
    expect(await fila(sAdmin.userId)).toMatchObject({ ruta: null, local_id: null });
    await registrarLatido(env, sAdmin, { ruta: '/' + 'a'.repeat(500) }, origen(), T0 + 40_000);
    expect(String((await fila(sAdmin.userId))!.ruta).length).toBeLessThanOrEqual(80);
  });

  it('salir marca la salida; el siguiente latido (otra pantalla, otra pestaña) la borra aunque sea muy seguido', async () => {
    await registrarLatido(env, sAdmin, {}, origen(), T0);
    await registrarLatido(env, sAdmin, { salir: true }, origen(), T0 + 1_000);
    expect((await fila(sAdmin.userId))!.salio_en).toBe(T0 + 1_000);
    await registrarLatido(env, sAdmin, {}, origen(), T0 + 2_000);
    expect((await fila(sAdmin.userId))!.salio_en).toBeNull();
  });

  it('salir sin haber mandado nunca un latido no inventa una fila', async () => {
    await registrarLatido(env, sAdmin, { salir: true }, origen(), T0);
    expect(await fila(sAdmin.userId)).toBeNull();
  });
});

describe('listarUsuariosActivos', () => {
  it('solo el administrador (gerente y demás reciben 403)', async () => {
    for (const rol of ['gerente', 'encargado', 'vendedor', 'tecnico', 'contador'] as Rol[]) {
      const { s } = await usuario(rol, rol === 'gerente' || rol === 'contador' ? null : accesorios);
      await rechazo(listarUsuariosActivos(env, s, T0), 403);
    }
  });

  it('devuelve nombre, correo, rol, local, IP, dispositivo, pantalla y último latido; cuenta solo los que están en línea', async () => {
    const ana = await usuario('vendedor', accesorios, 'Ana Pérez');
    const luis = await usuario('encargado', vidrios, 'Luis Gómez');
    const eva = await usuario('tecnico', accesorios, 'Eva Ruiz');
    await registrarLatido(env, ana.s, { ruta: '/ventas' }, origen('1.1.1.1'), T0); // hace 10 s
    await registrarLatido(env, luis.s, { ruta: '/ingreso' }, origen('2.2.2.2'), T0 - 70_000); // hace 80 s
    await registrarLatido(env, eva.s, {}, origen('3.3.3.3'), T0 - 600_000); // hace 10 min
    const r = await listarUsuariosActivos(env, sAdmin, T0 + 10_000);

    expect(r.usuarios_activos).toBe(1);
    expect(r.resumen).toEqual({ en_linea: 1, inactivo: 1, desconectado: 1 });
    expect(r.usuarios.map((u) => [u.nombre, u.estado])).toEqual([
      ['Ana Pérez', 'en_linea'],
      ['Luis Gómez', 'inactivo'],
      ['Eva Ruiz', 'desconectado'],
    ]);
    expect(r.usuarios[0]).toMatchObject({
      id: ana.s.userId, email: ana.u.email, rol: 'vendedor', local_id: accesorios, local_nombre: 'Local Accesorios',
      ip: '1.1.1.1', dispositivo: 'Chrome · Windows', ruta: '/ventas', segundos: 10,
    });
    expect(r.usuarios[0].ultimo_latido).toBe(new Date(T0).toISOString());
  });

  it('un usuario que salió hace más de la gracia aparece desconectado aunque su último latido sea reciente', async () => {
    const ana = await usuario('vendedor', accesorios, 'Ana Pérez');
    await registrarLatido(env, ana.s, {}, origen(), T0);
    await registrarLatido(env, ana.s, { salir: true }, origen(), T0 + 1_000);
    expect((await listarUsuariosActivos(env, sAdmin, T0 + 5_000)).usuarios[0].estado).toBe('en_linea'); // gracia (cambio de página)
    expect((await listarUsuariosActivos(env, sAdmin, T0 + 12_000)).usuarios[0].estado).toBe('desconectado');
  });

  it('el administrador/gerente muestran el local que estaban mirando; sin local = "Todos los locales"', async () => {
    const gerente = await usuario('gerente', null, 'Gina Gerente');
    await registrarLatido(env, gerente.s, { local_id: vidrios }, origen(), T0);
    await registrarLatido(env, sAdmin, { local_id: null }, origen(), T0);
    const r = await listarUsuariosActivos(env, sAdmin, T0);
    const porNombre = Object.fromEntries(r.usuarios.map((u) => [u.nombre, u.local_nombre]));
    expect(porNombre['Gina Gerente']).toBe('Local Vidrios');
    expect(porNombre['Neiker Flores']).toBe('Todos los locales');
  });

  it('no muestra a quien no se ve hace más de 24 horas', async () => {
    const ana = await usuario('vendedor', accesorios, 'Ana Pérez');
    await registrarLatido(env, ana.s, {}, origen(), T0 - 25 * 3_600_000);
    expect((await listarUsuariosActivos(env, sAdmin, T0)).usuarios).toEqual([]);
  });

  it('un usuario eliminado desaparece junto con su presencia', async () => {
    const ana = await usuario('vendedor', accesorios, 'Ana Pérez');
    await registrarLatido(env, ana.s, {}, origen(), T0);
    await env.DB.prepare('DELETE FROM user WHERE id = ?').bind(ana.s.userId).run();
    expect(await fila(ana.s.userId)).toBeNull();
  });
});

describe('limpiarPresencia: expira las sesiones muertas', () => {
  it('borra lo no visto hace más de 7 días y conserva lo reciente', async () => {
    const a = await usuario('vendedor', accesorios);
    const b = await usuario('vendedor', accesorios);
    await registrarLatido(env, a.s, {}, origen(), T0 - 8 * 86_400_000);
    await registrarLatido(env, b.s, {}, origen(), T0 - 6 * 86_400_000);
    expect(await limpiarPresencia(env, T0)).toBe(1);
    expect(await fila(a.s.userId)).toBeNull();
    expect(await fila(b.s.userId)).not.toBeNull();
  });
});

describe('rutas HTTP', () => {
  const llamar = (ruta: typeof latido | typeof activos, usuario: UsuarioDePrueba | null, url: string, init: RequestInit = {}) =>
    (ruta as unknown as (c: unknown) => Promise<Response>)({ request: peticionComo(usuario, url, init), params: {} });

  it('POST /api/presence/heartbeat responde 204 sin cuerpo y guarda el latido', async () => {
    const { u, s } = await usuario('vendedor', accesorios);
    const r = await llamar(latido, u, '/api/presence/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ ruta: '/ventas' }),
      headers: { 'user-agent': CHROME, 'cf-connecting-ip': '9.9.9.9' },
    });
    expect(r.status).toBe(204);
    expect(await r.text()).toBe('');
    expect(await fila(s.userId)).toMatchObject({ ruta: '/ventas', ip: '9.9.9.9', dispositivo: 'Chrome · Windows' });
  });

  it('acepta un cuerpo vacío o inválido (un beacon no avisa de errores)', async () => {
    const { u } = await usuario('vendedor', accesorios);
    expect((await llamar(latido, u, '/api/presence/heartbeat', { method: 'POST' })).status).toBe(204);
    expect((await llamar(latido, u, '/api/presence/heartbeat', { method: 'POST', body: 'no es json' })).status).toBe(204);
  });

  it('sin sesión: 401', async () => {
    expect((await llamar(latido, null, '/api/presence/heartbeat', { method: 'POST' })).status).toBe(401);
    expect((await llamar(activos, null, '/api/admin/active-users')).status).toBe(401);
  });

  it('GET /api/admin/active-users: el administrador ve la lista; los demás 403', async () => {
    const { u, s } = await usuario('vendedor', accesorios, 'Ana Pérez');
    await registrarLatido(env, s, {}, origen(), Date.now());
    const ok = await llamar(activos, admin, '/api/admin/active-users');
    expect(ok.status).toBe(200);
    const cuerpo = (await ok.json()) as { usuarios: { nombre: string }[]; usuarios_activos: number };
    expect(cuerpo.usuarios.map((x) => x.nombre)).toEqual(['Ana Pérez']);
    expect(cuerpo.usuarios_activos).toBe(1);
    expect((await llamar(activos, u, '/api/admin/active-users')).status).toBe(403);
  });
});
