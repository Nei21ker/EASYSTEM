import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Rol, type Sesion } from '../../src/server/authz';
import { crearAuth } from '../../src/server/auth';
import { ErrorApi } from '../../src/server/errores';
import { estadoCuenta } from '../../src/server/servicios/cuenta';
import {
  actualizarUsuario, cambiarClaveUsuario, cambiarSuscripcionLocal, cerrarSesionForzada, cerrarSesionesLocal, crearUsuario,
  eliminarUsuario, listarUsuarios, listarUsuariosSistema,
} from '../../src/server/servicios/usuarios';

const env = crearEntornoDePrueba();
const { accesorios, vidrios, servicio } = IDS_LOCALES;

let admin: UsuarioDePrueba, gerente: UsuarioDePrueba, encargado: UsuarioDePrueba, vendedor: UsuarioDePrueba, contador: UsuarioDePrueba;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
  gerente = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null });
  encargado = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: vidrios });
  vendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
  contador = await crearUsuarioDePrueba(env, { rol: 'contador', localId: null });
});

async function rechazo(promesa: Promise<unknown>, status: number, texto?: string | RegExp): Promise<ErrorApi> {
  try {
    await promesa;
  } catch (err) {
    expect(err).toBeInstanceOf(ErrorApi);
    expect((err as ErrorApi).status).toBe(status);
    if (texto) expect((err as ErrorApi).message).toMatch(texto);
    return err as ErrorApi;
  }
  throw new Error('Debía rechazarse y no se rechazó');
}

const nuevo = (rol: Rol, localId: string | null, extra: Record<string, unknown> = {}) => ({
  email: `nuevo-${rol}-${Math.random().toString(36).slice(2, 8)}@prueba.com`,
  nombre: `Nuevo ${rol}`,
  clave: 'Clave-nueva-123',
  rol,
  localId,
  ...extra,
});

describe('crearUsuario', () => {
  it('el administrador crea cualquiera de los seis roles', async () => {
    const a = await sesionDe(admin);
    for (const [rol, local] of [['administrador', null], ['gerente', null], ['contador', null], ['encargado', accesorios], ['vendedor', vidrios], ['tecnico', servicio]] as const) {
      const id = await crearUsuario(env, a, nuevo(rol, local));
      const perfil = await env.DB.prepare('SELECT rol, local_id FROM perfiles WHERE id = ?').bind(id).first();
      expect(perfil).toEqual({ rol, local_id: local });
    }
  });

  it('los roles sin local (administrador, gerente, contador) se guardan sin local aunque se envíe uno', async () => {
    const id = await crearUsuario(env, await sesionDe(admin), nuevo('gerente', accesorios));
    const perfil = await env.DB.prepare('SELECT local_id FROM perfiles WHERE id = ?').bind(id).first();
    expect(perfil).toEqual({ local_id: null });
  });

  it('el gerente crea encargados, vendedores y técnicos', async () => {
    const g = await sesionDe(gerente);
    for (const rol of ['encargado', 'vendedor', 'tecnico'] as const) {
      expect(await crearUsuario(env, g, nuevo(rol, accesorios))).toBeTruthy();
    }
  });

  it.each(['administrador', 'gerente', 'contador'] as const)('el gerente NO puede crear un %s (403)', async (rol) => {
    await rechazo(crearUsuario(env, await sesionDe(gerente), nuevo(rol, null)), 403);
  });

  it.each([['encargado'], ['vendedor'], ['contador']] as const)('el %s no crea usuarios (403)', async (quien) => {
    const actor = { encargado, vendedor, contador }[quien];
    await rechazo(crearUsuario(env, await sesionDe(actor), nuevo('vendedor', accesorios)), 403);
  });

  it('un rol de local sin local, o con un local que no existe, se rechaza con 400', async () => {
    const a = await sesionDe(admin);
    await rechazo(crearUsuario(env, a, nuevo('vendedor', null)), 400, 'Elige el local al que pertenece el empleado.');
    await rechazo(crearUsuario(env, a, nuevo('vendedor', 'no-existe')), 400, /local/i);
  });

  it('el correo repetido se rechaza con 409', async () => {
    await rechazo(crearUsuario(env, await sesionDe(admin), nuevo('vendedor', accesorios, { email: vendedor.email })), 409);
  });

  it('con todos los locales bloqueados, el gerente no puede crear usuarios', async () => {
    await env.DB.prepare("UPDATE locales SET subscription_status = 'SUSPENDED'").run();
    await rechazo(crearUsuario(env, await sesionDe(gerente), nuevo('vendedor', accesorios)), 403);
  });
});

describe('listarUsuarios', () => {
  it('el administrador ve a todos; el gerente no ve a los administradores', async () => {
    const todos = await listarUsuarios(env, await sesionDe(admin));
    expect(todos.map((u) => u.rol)).toContain('administrador');
    const deGerente = await listarUsuarios(env, await sesionDe(gerente));
    expect(deGerente.some((u) => u.rol === 'administrador')).toBe(false);
    expect(deGerente.some((u) => u.id === vendedor.id)).toBe(true);
  });

  it.each([['encargado'], ['vendedor'], ['contador']] as const)('el %s recibe 403', async (quien) => {
    await rechazo(listarUsuarios(env, await sesionDe({ encargado, vendedor, contador }[quien])), 403);
  });
});

describe('actualizarUsuario', () => {
  it('nadie cambia su propio rol ni su propio estado', async () => {
    const a = await sesionDe(admin);
    await rechazo(actualizarUsuario(env, a, admin.id, { rol: 'gerente' }), 403, 'No puedes cambiar tu propio rol ni tu propio estado.');
    await rechazo(actualizarUsuario(env, a, admin.id, { status: 'inactive' }), 403, 'No puedes cambiar tu propio rol ni tu propio estado.');
  });

  it('el gerente cambia el local y el estado de un encargado, y solo puede dejarlo en roles de local', async () => {
    const g = await sesionDe(gerente);
    await actualizarUsuario(env, g, encargado.id, { localId: accesorios, status: 'inactive' });
    expect(await env.DB.prepare('SELECT local_id, status FROM perfiles WHERE id = ?').bind(encargado.id).first()).toEqual({ local_id: accesorios, status: 'inactive' });
    await actualizarUsuario(env, g, encargado.id, { rol: 'vendedor' });
    await rechazo(actualizarUsuario(env, g, encargado.id, { rol: 'gerente' }), 403);
  });

  it('el gerente no toca a un administrador, a otro gerente ni al contador', async () => {
    const g = await sesionDe(gerente);
    await rechazo(actualizarUsuario(env, g, admin.id, { status: 'inactive' }), 403);
    await rechazo(actualizarUsuario(env, g, contador.id, { status: 'inactive' }), 403);
  });

  it('el administrador asigna cualquier rol; un rol sin local deja el local en blanco', async () => {
    const a = await sesionDe(admin);
    await actualizarUsuario(env, a, vendedor.id, { rol: 'contador' });
    expect(await env.DB.prepare('SELECT rol, local_id FROM perfiles WHERE id = ?').bind(vendedor.id).first()).toEqual({ rol: 'contador', local_id: null });
  });

  it('un local inexistente se rechaza y un usuario inexistente da 404', async () => {
    const a = await sesionDe(admin);
    await rechazo(actualizarUsuario(env, a, vendedor.id, { localId: 'no-existe' }), 400);
    await rechazo(actualizarUsuario(env, a, 'no-existe', { status: 'inactive' }), 404);
  });

  it('el vendedor recibe 403', async () => {
    await rechazo(actualizarUsuario(env, await sesionDe(vendedor), encargado.id, { status: 'inactive' }), 403);
  });
});

describe('eliminarUsuario', () => {
  it('quien no puede eliminar recibe 403 aunque el usuario no exista (no se puede tantear qué ids existen)', async () => {
    for (const u of [vendedor, encargado, contador]) {
      await rechazo(eliminarUsuario(env, await sesionDe(u), 'no-existe'), 403);
      await rechazo(eliminarUsuario(env, await sesionDe(u), admin.id), 403);
    }
  });

  it('el administrador elimina a otro y se borran su cuenta, sesiones y perfil', async () => {
    await eliminarUsuario(env, await sesionDe(admin), vendedor.id);
    for (const [tabla, columna] of [['user', 'id'], ['account', 'userId'], ['session', 'userId'], ['perfiles', 'id']] as const) {
      const fila = await env.DB.prepare(`SELECT count(*) AS n FROM ${tabla} WHERE ${columna} = ?`).bind(vendedor.id).first<{ n: number }>();
      expect(fila?.n, tabla).toBe(0);
    }
  });

  it('no puede eliminarse a sí mismo', async () => {
    await rechazo(eliminarUsuario(env, await sesionDe(admin), admin.id), 403, 'No puedes eliminar tu propio usuario.');
  });

  it('el gerente elimina a un vendedor, pero no a un administrador ni a otro gerente', async () => {
    const g = await sesionDe(gerente);
    await eliminarUsuario(env, g, vendedor.id);
    await rechazo(eliminarUsuario(env, g, admin.id), 403);
    const otroGerente = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null });
    await rechazo(eliminarUsuario(env, g, otroGerente.id), 403);
  });

  it('las ventas conservan el nombre del vendedor eliminado', async () => {
    await env.DB
      .prepare("INSERT INTO ventas (id, folio, local_id, cliente_cedula, cliente_nombre, cliente_telefono, metodo_pago, total, items, vendedor_id, vendedor_nombre) VALUES ('v1', 1, ?, 'V-12345678', 'Ana Pérez', '0414-1234567', 'USD_EFECTIVO', 5, '[]', ?, 'Vendedor X')")
      .bind(accesorios, vendedor.id)
      .run();
    await eliminarUsuario(env, await sesionDe(admin), vendedor.id);
    expect(await env.DB.prepare("SELECT vendedor_id, vendedor_nombre FROM ventas WHERE id = 'v1'").first()).toEqual({ vendedor_id: null, vendedor_nombre: 'Vendedor X' });
  });

  it('un usuario inexistente da 404 y el encargado recibe 403', async () => {
    await rechazo(eliminarUsuario(env, await sesionDe(admin), 'no-existe'), 404);
    await rechazo(eliminarUsuario(env, await sesionDe(encargado), vendedor.id), 403);
  });
});

describe('cambiarClaveUsuario', () => {
  it('quien no puede cambiar contraseñas recibe 403 aunque el usuario no exista', async () => {
    for (const u of [vendedor, encargado, contador]) await rechazo(cambiarClaveUsuario(env, await sesionDe(u), 'no-existe', 'Clave-valida-123'), 403);
  });

  it('el administrador cambia la clave de otro: entra con la nueva y sus sesiones abiertas se cierran', async () => {
    await cambiarClaveUsuario(env, await sesionDe(admin), vendedor.id, 'Otra-clave-456');
    await rechazo(sesionDe(vendedor), 401);
    const login = await crearAuth(env, 'http://localhost:8787').handler(
      new Request('http://localhost:8787/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:8787' },
        body: JSON.stringify({ email: vendedor.email, password: 'Otra-clave-456' }),
      })
    );
    expect(login.status).toBe(200);
  });

  it('cambiar la propia clave no cierra la sesión propia', async () => {
    await cambiarClaveUsuario(env, await sesionDe(gerente), gerente.id, 'Mi-clave-nueva-1');
    expect((await sesionDe(gerente)).userId).toBe(gerente.id);
  });

  it('el gerente cambia la clave de un encargado, pero no la de un administrador', async () => {
    const g = await sesionDe(gerente);
    await cambiarClaveUsuario(env, g, encargado.id, 'Clave-encargado-1');
    await rechazo(cambiarClaveUsuario(env, g, admin.id, 'Clave-admin-1234'), 403);
  });

  it('rechaza claves de menos de 8 caracteres y usuarios inexistentes', async () => {
    const a = await sesionDe(admin);
    await rechazo(cambiarClaveUsuario(env, a, vendedor.id, 'corta'), 400, 'La contraseña debe tener al menos 8 caracteres.');
    await rechazo(cambiarClaveUsuario(env, a, 'no-existe', 'Clave-valida-123'), 404);
  });

  it('el vendedor recibe 403 incluso sobre su propio id', async () => {
    await rechazo(cambiarClaveUsuario(env, await sesionDe(vendedor), vendedor.id, 'Clave-valida-123'), 403);
  });
});

describe('cierre de sesión forzado', () => {
  it('el administrador cierra la sesión de otro: su cookie deja de servir', async () => {
    await cerrarSesionForzada(env, await sesionDe(admin), vendedor.id);
    await rechazo(sesionDe(vendedor), 401);
    const fila = await env.DB.prepare('SELECT last_force_logout_at AS t FROM perfiles WHERE id = ?').bind(vendedor.id).first<{ t: string | null }>();
    expect(fila?.t).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('puede volver a entrar después (su nueva sesión es posterior al cierre)', async () => {
    await cerrarSesionForzada(env, await sesionDe(admin), vendedor.id);
    await new Promise((r) => setTimeout(r, 15));
    const login = await crearAuth(env, 'http://localhost:8787').handler(
      new Request('http://localhost:8787/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:8787' },
        body: JSON.stringify({ email: vendedor.email, password: vendedor.clave }),
      })
    );
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    expect((await cargarSesion(env, peticionComo({ ...vendedor, cookie }))).userId).toBe(vendedor.id);
  });

  it('solo el administrador, y no sobre sí mismo ni sobre un usuario inexistente', async () => {
    await rechazo(cerrarSesionForzada(env, await sesionDe(gerente), vendedor.id), 403);
    await rechazo(cerrarSesionForzada(env, await sesionDe(admin), admin.id), 403, 'No puedes cerrar tu propia sesión desde aquí');
    await rechazo(cerrarSesionForzada(env, await sesionDe(admin), 'no-existe'), 404);
  });

  it('cerrarSesionesLocal afecta a los usuarios de ese local y no a los demás ni a administradores', async () => {
    const otroVendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
    const cantidad = await cerrarSesionesLocal(env, await sesionDe(admin), accesorios);
    expect(cantidad).toBe(2);
    await rechazo(sesionDe(vendedor), 401);
    await rechazo(sesionDe(otroVendedor), 401);
    expect((await sesionDe(encargado)).userId).toBe(encargado.id); // otro local
    expect((await sesionDe(admin)).userId).toBe(admin.id);
  });

  it('cerrarSesionesLocal es solo del administrador', async () => {
    await rechazo(cerrarSesionesLocal(env, await sesionDe(gerente), accesorios), 403);
  });
});

describe('suscripciones y lista del sistema', () => {
  it('el administrador cambia el estado y queda registrado el evento con el estado anterior', async () => {
    await cambiarSuscripcionLocal(env, await sesionDe(admin), vidrios, 'SUSPENDED', null, false);
    expect(await env.DB.prepare('SELECT subscription_status AS s FROM locales WHERE id = ?').bind(vidrios).first()).toEqual({ s: 'SUSPENDED' });
    const evento = await env.DB.prepare('SELECT estado_anterior, estado_nuevo, cambiado_por FROM suscripcion_eventos WHERE local_id = ?').bind(vidrios).first();
    expect(evento).toEqual({ estado_anterior: 'ACTIVE', estado_nuevo: 'SUSPENDED', cambiado_por: admin.id });
  });

  it('el vencimiento solo cambia cuando se pide', async () => {
    const a = await sesionDe(admin);
    const vence = '2027-01-31T00:00:00.000Z';
    await cambiarSuscripcionLocal(env, a, vidrios, 'ACTIVE', vence, false);
    expect((await env.DB.prepare('SELECT subscription_expires_at AS v FROM locales WHERE id = ?').bind(vidrios).first<{ v: string | null }>())?.v).toBeNull();
    await cambiarSuscripcionLocal(env, a, vidrios, 'ACTIVE', vence, true);
    expect((await env.DB.prepare('SELECT subscription_expires_at AS v FROM locales WHERE id = ?').bind(vidrios).first<{ v: string | null }>())?.v).toBe(vence);
  });

  it('rechaza un estado inválido, un local inexistente y a quien no es administrador', async () => {
    const a = await sesionDe(admin);
    await rechazo(cambiarSuscripcionLocal(env, a, vidrios, 'ROTO' as never, null, false), 400, /Estado de suscripción inválido/);
    await rechazo(cambiarSuscripcionLocal(env, a, 'no-existe', 'ACTIVE', null, false), 404, 'El local no existe');
    await rechazo(cambiarSuscripcionLocal(env, await sesionDe(gerente), vidrios, 'SUSPENDED', null, false), 403);
  });

  it('listarUsuariosSistema (solo administrador) trae el local y la suscripción de cada usuario', async () => {
    const lista = await listarUsuariosSistema(env, await sesionDe(admin));
    const fila = lista.find((u) => u.id === vendedor.id);
    expect(fila).toMatchObject({ rol: 'vendedor', local_nombre: 'Local Accesorios', subscription_status: 'ACTIVE', status: 'active' });
    expect(lista[0].rol).toBe('administrador'); // los administradores primero
    await rechazo(listarUsuariosSistema(env, await sesionDe(gerente)), 403);
  });
});

describe('estadoCuenta', () => {
  it('un vendedor con su local vigente: acceso ok', async () => {
    expect(await estadoCuenta(env, peticionComo(vendedor))).toMatchObject({ acceso: true, motivo: 'ok', rol: 'vendedor', local_nombre: 'Local Accesorios', subscription_status: 'ACTIVE' });
  });

  it('incluye los datos del usuario para que la interfaz arme la sesión sin otra consulta', async () => {
    expect((await estadoCuenta(env, peticionComo(vendedor))).usuario).toEqual({ id: vendedor.id, email: vendedor.email, nombre: expect.any(String), rol: 'vendedor', local_id: accesorios, status: 'active' });
  });

  it('local suspendido: sin acceso (local_suspendido)', async () => {
    await env.DB.prepare("UPDATE locales SET subscription_status = 'SUSPENDED' WHERE id = ?").bind(accesorios).run();
    expect(await estadoCuenta(env, peticionComo(vendedor))).toMatchObject({ acceso: false, motivo: 'local_suspendido' });
  });

  it('usuario desactivado: usuario_inactivo (responde, no lanza)', async () => {
    await env.DB.prepare("UPDATE perfiles SET status = 'inactive' WHERE id = ?").bind(vendedor.id).run();
    expect(await estadoCuenta(env, peticionComo(vendedor))).toMatchObject({ acceso: false, motivo: 'usuario_inactivo' });
  });

  it('sesión cerrada a la fuerza: sesion_cerrada', async () => {
    await env.DB.prepare('UPDATE perfiles SET last_force_logout_at = ? WHERE id = ?').bind(new Date(Date.now() + 60_000).toISOString(), vendedor.id).run();
    expect(await estadoCuenta(env, peticionComo(vendedor))).toMatchObject({ acceso: false, motivo: 'sesion_cerrada' });
  });

  it('el administrador nunca queda bloqueado; el gerente y el contador solo si TODOS los locales lo están', async () => {
    await env.DB.prepare("UPDATE locales SET subscription_status = 'SUSPENDED' WHERE id <> ?").bind(servicio).run();
    expect((await estadoCuenta(env, peticionComo(gerente))).acceso).toBe(true);
    expect((await estadoCuenta(env, peticionComo(contador))).acceso).toBe(true);
    await env.DB.prepare("UPDATE locales SET subscription_status = 'PAST_DUE'").run();
    expect((await estadoCuenta(env, peticionComo(gerente))).motivo).toBe('local_suspendido');
    expect((await estadoCuenta(env, peticionComo(contador))).motivo).toBe('local_suspendido');
    expect((await estadoCuenta(env, peticionComo(admin))).acceso).toBe(true);
  });

  it('un usuario de local sin local asignado queda bloqueado y sin sesión responde 401', async () => {
    const sinLocal = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: null });
    expect((await estadoCuenta(env, peticionComo(sinLocal))).motivo).toBe('local_suspendido');
    await rechazo(estadoCuenta(env, peticionComo(null)), 401);
  });
});
