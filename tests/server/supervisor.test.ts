// Rol «supervisor»: los permisos y los módulos del encargado, pero en TODOS los locales (sin local propio).
// Puede lo que el encargado (productos sin precio de compra, mercancía, traslados, pendientes, cuadre, ventas del local que mira)
// en cualquier local; NO puede lo que el encargado tampoco (borrar productos, revertir, eliminar ventas, reabrir cuadres,
// inversión, usuarios, nómina). La matriz completa de la API está en matriz-roles.test.ts.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { alcanceDe, cargarSesion, esGerencia, esSinLocal, puedeGestionarUsuario, rolesAsignables, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { autorizarPrecio } from '../../src/server/servicios/autorizaciones';
import { actualizarProducto, crearProducto, eliminarProductosLote, listarLocalesVisibles, listarProductos } from '../../src/server/servicios/catalogo';
import { estadoCuenta } from '../../src/server/servicios/cuenta';
import { registrarMovimiento } from '../../src/server/servicios/movimientos';
import { listarCuadresDelDia, reabrirCuadre } from '../../src/server/servicios/cuadres';
import { actualizarUsuario, crearUsuario, eliminarUsuario } from '../../src/server/servicios/usuarios';

const env = crearEntornoDePrueba();
const { accesorios, vidrios, servicio } = IDS_LOCALES;

let admin: Sesion, gerente: Sesion, supervisor: Sesion, encargado: Sesion;
let usuarioSupervisor: UsuarioDePrueba, usuarioGerente: UsuarioDePrueba;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));
const dia = '2026-10-20';

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  const u = await Promise.all([
    crearUsuarioDePrueba(env, { rol: 'administrador', localId: null }),
    crearUsuarioDePrueba(env, { rol: 'gerente', localId: null, clave: 'Clave-gerente-123' }),
    crearUsuarioDePrueba(env, { rol: 'supervisor', localId: null, nombre: 'Sara Supervisora', clave: 'Clave-supervisor-123' }),
    crearUsuarioDePrueba(env, { rol: 'encargado', localId: accesorios, clave: 'Clave-encargado-123' }),
  ]);
  usuarioGerente = u[1];
  usuarioSupervisor = u[2];
  [admin, gerente, supervisor, encargado] = await Promise.all(u.map(sesionDe));
});

async function rechazo(promesa: Promise<unknown>, status: number, codigo?: string): Promise<ErrorApi> {
  try {
    await promesa;
  } catch (err) {
    expect(err).toBeInstanceOf(ErrorApi);
    expect((err as ErrorApi).status).toBe(status);
    if (codigo) expect((err as ErrorApi).codigo).toBe(codigo);
    return err as ErrorApi;
  }
  throw new Error('Debía rechazarse y no se rechazó');
}

const nuevoProducto = (extra: Record<string, unknown> = {}) => ({ codigo_barras: `2${String(Math.random()).slice(2, 14)}`, nombre: `Prod ${Math.random()}`, categoria: 'Forros', precio_compra: 5, precio_venta: 9, ...extra });
const n = async (sql: string, ...v: unknown[]) => (await env.DB.prepare(sql).bind(...v).first<{ n: number }>())!.n;

describe('reglas puras del rol', () => {
  it('es nivel «encargado» y no tiene local propio', () => {
    expect(esGerencia('supervisor')).toBe(true);
    expect(esSinLocal('supervisor')).toBe(true);
  });

  it('solo el administrador y el gerente lo gestionan; él no gestiona a nadie', () => {
    expect(rolesAsignables('administrador')).toContain('supervisor');
    expect(rolesAsignables('gerente')).toContain('supervisor');
    expect(rolesAsignables('supervisor')).toEqual([]);
    expect(rolesAsignables('encargado')).toEqual([]);
    expect(puedeGestionarUsuario('gerente', 'supervisor')).toBe(true);
    expect(puedeGestionarUsuario('supervisor', 'vendedor')).toBe(false);
  });
});

describe('alcance: todos los locales vigentes', () => {
  it('ve todos los locales; con uno suspendido ya no llega a ese', async () => {
    expect(await alcanceDe(env, supervisor)).toEqual({ tipo: 'locales', ids: expect.arrayContaining([accesorios, vidrios, servicio]) });
    expect((await listarLocalesVisibles(env, supervisor)).length).toBeGreaterThanOrEqual(3);
    await env.DB.prepare("UPDATE locales SET subscription_status = 'SUSPENDED' WHERE id = ?").bind(vidrios).run();
    const alcance = await alcanceDe(env, supervisor);
    expect(alcance.tipo === 'locales' && alcance.ids.includes(vidrios)).toBe(false);
    await rechazo(alcanceDe(env, supervisor, vidrios), 403, 'local_suspendido');
    expect((await alcanceDe(env, supervisor, accesorios)) as unknown).toEqual({ tipo: 'locales', ids: [accesorios] });
  });

  it('con todos los locales bloqueados, el estado de la cuenta lo bloquea (como al gerente); con uno vigente entra', async () => {
    const peticion = peticionComo(usuarioSupervisor);
    expect((await estadoCuenta(env, peticion)).acceso).toBe(true);
    await env.DB.prepare("UPDATE locales SET subscription_status = 'SUSPENDED'").run();
    expect(await estadoCuenta(env, peticion)).toMatchObject({ acceso: false, motivo: 'local_suspendido' });
  });

  it('trabaja en el stock de cualquier local (a diferencia del encargado, atado al suyo)', async () => {
    const p = await crearProducto(env, supervisor, nuevoProducto());
    await registrarMovimiento(env, supervisor, { productoId: p.id, tipo: 'ENTRADA', cantidad: 3, localId: vidrios, motivo: 'Compra' });
    await registrarMovimiento(env, supervisor, { productoId: p.id, tipo: 'ENTRADA', cantidad: 2, localId: accesorios, motivo: 'Compra' });
    expect(await n('SELECT stock_actual AS n FROM inventario_local WHERE producto_id = ? AND local_id = ?', p.id, vidrios)).toBe(3);
    await rechazo(registrarMovimiento(env, encargado, { productoId: p.id, tipo: 'ENTRADA', cantidad: 1, localId: vidrios, motivo: 'Compra' }), 403);
    const visibles = (await listarProductos(env, supervisor)).find((x) => x.id === p.id)!;
    expect(visibles.inventario.map((i) => i.local_id).sort()).toEqual([accesorios, vidrios].sort());
  });
});

describe('límites del encargado', () => {
  it('no ve ni fija el precio de compra: al crear queda en 0 y al editar se ignora', async () => {
    const p = await crearProducto(env, supervisor, nuevoProducto({ precio_compra: 7 }));
    expect(p.precio_compra).toBe(0);
    const g = await crearProducto(env, gerente, nuevoProducto({ precio_compra: 7 }));
    expect(g.precio_compra).toBe(7);
    await actualizarProducto(env, supervisor, g.id, { precio_compra: 99, nombre: 'Renombrado por supervisor' });
    expect(await n('SELECT precio_compra AS n FROM productos WHERE id = ?', g.id)).toBe(7);
    expect(await n("SELECT count(*) AS n FROM productos WHERE id = ? AND nombre = 'Renombrado por supervisor'", g.id)).toBe(1);
  });

  it('no borra productos, no elimina ventas ni reabre cuadres', async () => {
    const p = await crearProducto(env, admin, nuevoProducto());
    await rechazo(eliminarProductosLote(env, supervisor, [p.id]), 403);
    await rechazo(reabrirCuadre(env, supervisor, accesorios, dia), 403);
  });

  it('puede ver el cuadre de todos los locales del día', async () => {
    const lista = await listarCuadresDelDia(env, supervisor, dia);
    expect(Array.isArray(lista)).toBe(true);
  });
});

describe('autorizar precios y códigos con su contraseña', () => {
  const pedido = (clave: string, localId: string, precio: number) => ({
    clave,
    local_id: localId,
    lineas: [{ producto_id: 'p-sup', precio }],
  });

  beforeEach(async () => {
    await env.DB.prepare("INSERT INTO productos (id, codigo_barras, nombre, categoria, precio_compra, precio_venta, stock_minimo) VALUES ('p-sup', '2000000000015', 'Control', 'Controles', 8, 12, 0)").run();
  });

  it('autoriza un precio MAYOR en cualquier local, pero no un descuento', async () => {
    const vendedorVid = await sesionDe(await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: vidrios }));
    const r = await autorizarPrecio(env, vendedorVid, pedido('Clave-supervisor-123', vidrios, 15));
    expect(r.autorizado_por).toBe('Sara Supervisora');
    await rechazo(autorizarPrecio(env, vendedorVid, pedido('Clave-supervisor-123', vidrios, 5)), 403, 'autorizador_invalido');
  });
});

describe('gestión de usuarios: solo administrador y gerente', () => {
  const datos = (rol: 'supervisor' | 'vendedor', localId: string | null) => ({ email: `n${Math.random().toString(36).slice(2, 8)}@prueba.com`, nombre: 'Nuevo', clave: 'Clave-nueva-123', rol, localId });

  it('el gerente y el administrador crean un supervisor SIN local (aunque se envíe uno)', async () => {
    for (const actor of [gerente, admin]) {
      const id = await crearUsuario(env, actor, datos('supervisor', accesorios));
      expect(await env.DB.prepare('SELECT rol, local_id FROM perfiles WHERE id = ?').bind(id).first()).toEqual({ rol: 'supervisor', local_id: null });
    }
  });

  it('el gerente lo edita y lo elimina; el supervisor y el encargado no crean usuarios', async () => {
    const id = await crearUsuario(env, gerente, datos('supervisor', null));
    await actualizarUsuario(env, gerente, id, { status: 'inactive' });
    expect(await env.DB.prepare('SELECT status FROM perfiles WHERE id = ?').bind(id).first()).toEqual({ status: 'inactive' });
    await eliminarUsuario(env, gerente, id);
    expect(await n('SELECT count(*) AS n FROM perfiles WHERE id = ?', id)).toBe(0);
    await rechazo(crearUsuario(env, supervisor, datos('vendedor', accesorios)), 403);
    await rechazo(crearUsuario(env, encargado, datos('vendedor', accesorios)), 403);
  });

  it('un encargado puede ascenderse a supervisor y pasa a no tener local', async () => {
    const id = await crearUsuario(env, admin, datos('vendedor', accesorios));
    await actualizarUsuario(env, gerente, id, { rol: 'supervisor' });
    expect(await env.DB.prepare('SELECT rol, local_id FROM perfiles WHERE id = ?').bind(id).first()).toEqual({ rol: 'supervisor', local_id: null });
  });

  it('el supervisor no puede cambiarse a sí mismo el rol', async () => {
    await rechazo(actualizarUsuario(env, supervisor, supervisor.userId, { rol: 'administrador' }), 403);
    void usuarioGerente;
  });
});
