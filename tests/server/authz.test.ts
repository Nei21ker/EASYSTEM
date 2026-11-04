import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales } from './ayudas';
import {
  alcanceDe, alcanceNomina, cargarSesion, condicionAlcance, esAdministrador, esGerencia, esGlobal, exigirRol, localAccesible, type Rol,
} from '../../src/server/authz';
import { conSesion } from '../../src/server/http';
import { ErrorApi } from '../../src/server/errores';

const env = crearEntornoDePrueba();
const { accesorios, vidrios, servicio, controles } = IDS_LOCALES;

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
});

async function fallo(promesa: Promise<unknown>): Promise<ErrorApi> {
  try {
    await promesa;
  } catch (err) {
    expect(err).toBeInstanceOf(ErrorApi);
    return err as ErrorApi;
  }
  throw new Error('Debía rechazarse y no se rechazó');
}

describe('helpers de rol', () => {
  const roles: Rol[] = ['administrador', 'gerente', 'encargado', 'vendedor', 'tecnico', 'contador'];
  it.each([
    ['administrador', true, true, true],
    ['gerente', false, true, true],
    ['encargado', false, false, true],
    ['vendedor', false, false, false],
    ['tecnico', false, false, false],
    ['contador', false, false, false],
  ] as const)('%s: administrador=%s global=%s gerencia=%s', (rol, admin, global, gerencia) => {
    expect(esAdministrador(rol)).toBe(admin);
    expect(esGlobal(rol)).toBe(global);
    expect(esGerencia(rol)).toBe(gerencia);
    expect(roles).toContain(rol);
  });

  it('exigirRol deja pasar los roles indicados y rechaza el resto con 403', () => {
    const sesion = { rol: 'vendedor' } as never;
    expect(() => exigirRol(sesion, ['vendedor', 'encargado'])).not.toThrow();
    expect(() => exigirRol(sesion, ['administrador'])).toThrow(ErrorApi);
    try {
      exigirRol(sesion, ['administrador']);
    } catch (err) {
      expect((err as ErrorApi).status).toBe(403);
    }
  });
});

describe('cargarSesion', () => {
  it('sin cookie responde 401 sin_sesion', async () => {
    const e = await fallo(cargarSesion(env, peticionComo(null)));
    expect([e.status, e.codigo]).toEqual([401, 'sin_sesion']);
  });

  it('con la cookie devuelve el usuario, su rol y su local', async () => {
    const u = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: vidrios, nombre: 'Enrique Vidrios' });
    const sesion = await cargarSesion(env, peticionComo(u));
    expect(sesion).toMatchObject({ userId: u.id, email: u.email, nombre: 'Enrique Vidrios', rol: 'encargado', localId: vidrios, status: 'active' });
    expect(sesion.emitidaEn).toBeGreaterThan(1_700_000_000);
  });

  it('un usuario desactivado con cookie válida recibe 401 usuario_inactivo', async () => {
    const u = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
    await env.DB.prepare("UPDATE perfiles SET status = 'inactive' WHERE id = ?").bind(u.id).run();
    const e = await fallo(cargarSesion(env, peticionComo(u)));
    expect([e.status, e.codigo]).toEqual([401, 'usuario_inactivo']);
  });

  it('una sesión emitida antes del cierre forzado recibe 401 sesion_cerrada', async () => {
    const u = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
    const futuro = new Date(Date.now() + 60_000).toISOString();
    await env.DB.prepare('UPDATE perfiles SET last_force_logout_at = ? WHERE id = ?').bind(futuro, u.id).run();
    const e = await fallo(cargarSesion(env, peticionComo(u)));
    expect([e.status, e.codigo]).toEqual([401, 'sesion_cerrada']);
  });

  it('una sesión posterior al cierre forzado sí sirve', async () => {
    const u = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
    const pasado = new Date(Date.now() - 60_000).toISOString();
    await env.DB.prepare('UPDATE perfiles SET last_force_logout_at = ? WHERE id = ?').bind(pasado, u.id).run();
    expect((await cargarSesion(env, peticionComo(u))).userId).toBe(u.id);
  });
});

describe('alcanceDe', () => {
  it('el administrador ve todos los locales (aunque estén suspendidos)', async () => {
    await env.DB.prepare("UPDATE locales SET subscription_status = 'SUSPENDED'").run();
    const u = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
    expect(await alcanceDe(env, await cargarSesion(env, peticionComo(u)))).toEqual({ tipo: 'todos' });
  });

  it('el administrador puede pedir un local concreto', async () => {
    const u = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
    const sesion = await cargarSesion(env, peticionComo(u));
    expect(await alcanceDe(env, sesion, vidrios)).toEqual({ tipo: 'locales', ids: [vidrios] });
  });

  it('el gerente recibe solo los locales vigentes', async () => {
    await env.DB.prepare("UPDATE locales SET subscription_status = 'SUSPENDED' WHERE id = ?").bind(servicio).run();
    const u = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null });
    const alcance = await alcanceDe(env, await cargarSesion(env, peticionComo(u)));
    expect(alcance.tipo).toBe('locales');
    expect(alcance.tipo === 'locales' && [...alcance.ids].sort()).toEqual([accesorios, vidrios, controles].sort());
  });

  it('el gerente no puede pedir un local suspendido (403)', async () => {
    await env.DB.prepare("UPDATE locales SET subscription_status = 'SUSPENDED' WHERE id = ?").bind(servicio).run();
    const u = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null });
    const e = await fallo(alcanceDe(env, await cargarSesion(env, peticionComo(u)), servicio));
    expect([e.status, e.codigo]).toEqual([403, 'local_suspendido']);
  });

  it.each(['encargado', 'vendedor', 'tecnico'] as const)('%s solo recibe su propio local', async (rol) => {
    const u = await crearUsuarioDePrueba(env, { rol, localId: vidrios });
    expect(await alcanceDe(env, await cargarSesion(env, peticionComo(u)))).toEqual({ tipo: 'locales', ids: [vidrios] });
  });

  it('un encargado que pide otro local recibe 403', async () => {
    const u = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: vidrios });
    const e = await fallo(alcanceDe(env, await cargarSesion(env, peticionComo(u)), accesorios));
    expect(e.status).toBe(403);
  });

  it('un usuario sin local asignado recibe 403 sin_local', async () => {
    const u = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: null });
    const e = await fallo(alcanceDe(env, await cargarSesion(env, peticionComo(u))));
    expect([e.status, e.codigo]).toEqual([403, 'sin_local']);
  });

  it('el contador no tiene alcance sobre datos del negocio (403)', async () => {
    const u = await crearUsuarioDePrueba(env, { rol: 'contador', localId: null });
    const e = await fallo(alcanceDe(env, await cargarSesion(env, peticionComo(u))));
    expect(e.status).toBe(403);
  });

  it('un local suspendido bloquea a su vendedor (403 local_suspendido)', async () => {
    await env.DB.prepare("UPDATE locales SET subscription_status = 'SUSPENDED' WHERE id = ?").bind(accesorios).run();
    const u = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
    const e = await fallo(alcanceDe(env, await cargarSesion(env, peticionComo(u))));
    expect([e.status, e.codigo]).toEqual([403, 'local_suspendido']);
  });

  it('un local vencido (subscription_expires_at pasado) también bloquea', async () => {
    await env.DB.prepare('UPDATE locales SET subscription_expires_at = ? WHERE id = ?').bind(new Date(Date.now() - 86_400_000).toISOString(), accesorios).run();
    const u = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: accesorios });
    const e = await fallo(alcanceDe(env, await cargarSesion(env, peticionComo(u))));
    expect(e.codigo).toBe('local_suspendido');
  });

  it('un local desactivado (activo = 0) también bloquea', async () => {
    await env.DB.prepare('UPDATE locales SET activo = 0 WHERE id = ?').bind(accesorios).run();
    const u = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
    expect((await fallo(alcanceDe(env, await cargarSesion(env, peticionComo(u))))).codigo).toBe('local_suspendido');
  });

  it('si TODOS los locales están bloqueados, el gerente también (403) pero el administrador no', async () => {
    await env.DB.prepare("UPDATE locales SET subscription_status = 'SUSPENDED'").run();
    const gerente = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null });
    const admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
    expect((await fallo(alcanceDe(env, await cargarSesion(env, peticionComo(gerente))))).codigo).toBe('local_suspendido');
    expect(await alcanceDe(env, await cargarSesion(env, peticionComo(admin)))).toEqual({ tipo: 'todos' });
  });
});

describe('alcanceNomina (administrador, gerente y contador)', () => {
  it('el administrador ve todos; gerente y contador, los locales vigentes', async () => {
    await env.DB.prepare("UPDATE locales SET subscription_status = 'SUSPENDED' WHERE id = ?").bind(servicio).run();
    const admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
    const gerente = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null });
    const contador = await crearUsuarioDePrueba(env, { rol: 'contador', localId: null });
    expect(await alcanceNomina(env, await cargarSesion(env, peticionComo(admin)))).toEqual({ tipo: 'todos' });
    for (const u of [gerente, contador]) {
      const alcance = await alcanceNomina(env, await cargarSesion(env, peticionComo(u)));
      expect(alcance.tipo === 'locales' && [...alcance.ids].sort()).toEqual([accesorios, vidrios, controles].sort());
    }
  });

  it('encargado, vendedor y técnico reciben 403', async () => {
    for (const rol of ['encargado', 'vendedor', 'tecnico'] as const) {
      const u = await crearUsuarioDePrueba(env, { rol, localId: accesorios });
      expect((await fallo(alcanceNomina(env, await cargarSesion(env, peticionComo(u)), accesorios))).status).toBe(403);
    }
  });

  it('si todos los locales están bloqueados el contador recibe 403', async () => {
    await env.DB.prepare("UPDATE locales SET subscription_status = 'PAST_DUE'").run();
    const u = await crearUsuarioDePrueba(env, { rol: 'contador', localId: null });
    expect((await fallo(alcanceNomina(env, await cargarSesion(env, peticionComo(u))))).codigo).toBe('local_suspendido');
  });
});

describe('localAccesible y condicionAlcance', () => {
  it('localAccesible sigue las mismas reglas que alcanceDe', async () => {
    const enc = await cargarSesion(env, peticionComo(await crearUsuarioDePrueba(env, { rol: 'encargado', localId: vidrios })));
    expect(await localAccesible(env, enc, vidrios)).toBe(true);
    expect(await localAccesible(env, enc, accesorios)).toBe(false);
    const cont = await cargarSesion(env, peticionComo(await crearUsuarioDePrueba(env, { rol: 'contador', localId: null })));
    expect(await localAccesible(env, cont, accesorios)).toBe(false);
  });

  it('condicionAlcance arma el filtro SQL del local', () => {
    expect(condicionAlcance({ tipo: 'todos' })).toEqual({ sql: '1 = 1', valores: [] });
    expect(condicionAlcance({ tipo: 'locales', ids: ['a', 'b'] }, 'v.local_id')).toEqual({ sql: 'v.local_id IN (?, ?)', valores: ['a', 'b'] });
    expect(condicionAlcance({ tipo: 'locales', ids: [] })).toEqual({ sql: '0 = 1', valores: [] });
  });
});

describe('conSesion', () => {
  const ctx = (request: Request) => ({ request, params: {} }) as never;

  it('responde 401 en JSON cuando no hay sesión', async () => {
    const ruta = conSesion(async () => ({ hola: 'mundo' }));
    const respuesta = await ruta(ctx(peticionComo(null)));
    expect(respuesta.status).toBe(401);
    expect(await respuesta.json()).toMatchObject({ codigo: 'sin_sesion', error: expect.any(String) });
  });

  it('entrega la sesión al manejador y serializa su resultado', async () => {
    const u = await crearUsuarioDePrueba(env, { rol: 'tecnico', localId: servicio });
    const ruta = conSesion(async ({ sesion }) => ({ rol: sesion.rol, local: sesion.localId }));
    const respuesta = await ruta(ctx(peticionComo(u)));
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ rol: 'tecnico', local: servicio });
  });

  it('convierte un ErrorApi en su código y mensaje', async () => {
    const u = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
    const ruta = conSesion(async ({ sesion }) => {
      exigirRol(sesion, ['administrador']);
    });
    const respuesta = await ruta(ctx(peticionComo(u)));
    expect(respuesta.status).toBe(403);
  });

  it('un error inesperado responde 500 sin filtrar detalles internos', async () => {
    const u = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
    const ruta = conSesion(async () => {
      throw new Error('SQLITE_ERROR: tabla secreta');
    });
    const respuesta = await ruta(ctx(peticionComo(u)));
    expect(respuesta.status).toBe(500);
    const cuerpo = await respuesta.text();
    expect(cuerpo).not.toContain('SQLITE');
    expect(cuerpo).toContain('Ocurrió un error inesperado');
  });
});
