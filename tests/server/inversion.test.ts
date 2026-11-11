// Módulo de Inversión (migración 0021): compras y pérdidas anotadas a mano por el gerente o el administrador, con la tasa BCV de la fecha
// y una lista de proveedores. Nadie más (encargado, vendedor, técnico, contador) lo ve ni lo toca.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { versionesVisibles } from '../../src/server/servicios/cambios';
import {
  actualizarInversion, actualizarProveedor, crearInversion, crearProveedor, eliminarInversion, eliminarProveedor, hoyDelNegocio, listarInversiones, listarProveedores,
} from '../../src/server/servicios/inversion';
import type { DatosInversion } from '../../src/types/database.types';

const env = crearEntornoDePrueba();
const { accesorios, vidrios, servicio } = IDS_LOCALES;

let admin: Sesion, gerente: Sesion, encargado: Sesion, vendedor: Sesion, tecnico: Sesion, contador: Sesion;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

const hoy = () => hoyDelNegocio(env);
const compra = (extra: Partial<DatosInversion> = {}): DatosInversion => ({ localId: vidrios, tipo: 'COMPRA', fecha: hoy(), descripcion: 'Vidrios blindados Samsung', proveedor: 'Distribuidora Álvarez', monto_usd: 150, ...extra });

async function rechazo(promesa: Promise<unknown>, status: number, codigo?: string) {
  try {
    await promesa;
  } catch (err) {
    expect(err).toBeInstanceOf(ErrorApi);
    expect((err as ErrorApi).status).toBe(status);
    if (codigo) expect((err as ErrorApi).codigo).toBe(codigo);
    return;
  }
  throw new Error('Debía rechazarse y no se rechazó');
}

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  const crear = (rol: 'administrador' | 'gerente' | 'encargado' | 'vendedor' | 'tecnico' | 'contador', local: string | null) =>
    crearUsuarioDePrueba(env, { rol, localId: local, clave: `Clave-${rol}-${local ?? 'null'}-123` });
  const uAdmin = await crear('administrador', null);
  const uGerente = await crear('gerente', null);
  const uEncargado = await crear('encargado', vidrios);
  const uVendedor = await crear('vendedor', vidrios);
  const uTecnico = await crear('tecnico', vidrios);
  const uContador = await crear('contador', null);
  [admin, gerente, encargado, vendedor, tecnico, contador] = await Promise.all([uAdmin, uGerente, uEncargado, uVendedor, uTecnico, uContador].map(sesionDe));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO tasas_cambio (id, fecha, tasa, created_at) VALUES ('t1', '2026-01-10', 40, '2026-01-10T12:00:00.000Z')"),
    env.DB.prepare("INSERT INTO tasas_cambio (id, fecha, tasa, created_at) VALUES ('t2', '2026-02-10', 50, '2026-02-10T12:00:00.000Z')"),
  ]);
});

describe('quién puede ver y anotar inversiones', () => {
  it('administrador y gerente anotan y consultan; el resto recibe 403 en todo', async () => {
    for (const s of [admin, gerente]) {
      const i = await crearInversion(env, s, compra());
      expect(i).toMatchObject({ local_id: vidrios, tipo: 'COMPRA', monto_usd: 150, proveedor_nombre: 'Distribuidora Álvarez' });
      expect((await listarInversiones(env, s)).some((x) => x.id === i.id)).toBe(true);
    }
    const i = (await listarInversiones(env, gerente))[0];
    for (const s of [encargado, vendedor, tecnico, contador]) {
      await rechazo(listarInversiones(env, s), 403);
      await rechazo(crearInversion(env, s, compra()), 403);
      await rechazo(actualizarInversion(env, s, i.id, compra()), 403);
      await rechazo(eliminarInversion(env, s, i.id), 403);
      await rechazo(listarProveedores(env, s), 403);
      await rechazo(crearProveedor(env, s, { nombre: 'Otro' }), 403);
    }
  });

  it('el gerente no puede anotar en un local con la suscripción suspendida (el administrador sí)', async () => {
    await env.DB.prepare("UPDATE locales SET subscription_status = 'SUSPENDED' WHERE id = ?").bind(servicio).run();
    await rechazo(crearInversion(env, gerente, compra({ localId: servicio })), 403);
    expect((await crearInversion(env, admin, compra({ localId: servicio }))).local_id).toBe(servicio);
    // y el registro de un local suspendido no se ve para el gerente
    expect((await listarInversiones(env, gerente)).some((x) => x.local_id === servicio)).toBe(false);
  });
});

describe('registrar una compra o una pérdida', () => {
  it('guarda el monto en dólares y la tasa BCV que regía ese día (para los bolívares de referencia)', async () => {
    const a = await crearInversion(env, gerente, compra({ fecha: '2026-01-20' }));
    const b = await crearInversion(env, gerente, compra({ fecha: '2026-02-12' }));
    expect(a.tasa_bcv).toBe(40);
    expect(b.tasa_bcv).toBe(50);
    // antes de la primera tasa registrada se usa la primera que existe
    expect((await crearInversion(env, gerente, compra({ fecha: '2026-01-02' }))).tasa_bcv).toBe(40);
  });

  it('sin ninguna tasa registrada la tasa queda vacía', async () => {
    await env.DB.prepare('DELETE FROM tasas_cambio').run();
    expect((await crearInversion(env, gerente, compra())).tasa_bcv).toBeNull();
  });

  it('una pérdida se guarda aparte (tipo PERDIDA) y se puede filtrar', async () => {
    await crearInversion(env, gerente, compra());
    await crearInversion(env, gerente, compra({ tipo: 'PERDIDA', descripcion: 'Vidrios rotos en el traslado', proveedor: null, monto_usd: 12 }));
    const perdidas = await listarInversiones(env, gerente, { tipo: 'PERDIDA' });
    expect(perdidas).toHaveLength(1);
    expect(perdidas[0]).toMatchObject({ tipo: 'PERDIDA', proveedor_id: null, proveedor_nombre: null, monto_usd: 12 });
  });

  it('rechaza datos inválidos: monto, fecha futura o mal escrita, descripción corta, tipo y local', async () => {
    await rechazo(crearInversion(env, gerente, compra({ monto_usd: 0 })), 400, 'datos_invalidos');
    await rechazo(crearInversion(env, gerente, compra({ monto_usd: -5 })), 400);
    await rechazo(crearInversion(env, gerente, compra({ monto_usd: Number.NaN })), 400);
    await rechazo(crearInversion(env, gerente, compra({ fecha: '2099-01-01' })), 400);
    await rechazo(crearInversion(env, gerente, compra({ fecha: '2026-02-30' })), 400);
    await rechazo(crearInversion(env, gerente, compra({ fecha: 'ayer' })), 400);
    await rechazo(crearInversion(env, gerente, compra({ descripcion: 'ab' })), 400);
    await rechazo(crearInversion(env, gerente, compra({ tipo: 'OTRO' as 'COMPRA' })), 400);
    await rechazo(crearInversion(env, gerente, compra({ localId: '00000000-0000-4000-8000-0000000000ff' })), 403);
  });

  it('redondea el monto a centavos', async () => {
    expect((await crearInversion(env, gerente, compra({ monto_usd: 10.456 }))).monto_usd).toBe(10.46);
  });
});

describe('proveedores', () => {
  it('escribir un proveedor nuevo al registrar lo agrega a la lista; el mismo nombre (otras mayúsculas o acentos) no se duplica', async () => {
    await crearInversion(env, gerente, compra({ proveedor: 'Distribuidora Álvarez' }));
    await crearInversion(env, admin, compra({ proveedor: '  distribuidora   alvarez ' }));
    const lista = await listarProveedores(env, gerente);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ nombre: 'Distribuidora Álvarez', n_compras: 2, total_usd: 300 });
    const registros = await listarInversiones(env, gerente);
    expect(new Set(registros.map((r) => r.proveedor_id)).size).toBe(1);
    expect(registros.every((r) => r.proveedor_nombre === 'Distribuidora Álvarez')).toBe(true);
  });

  it('las pérdidas no suman al total comprado a un proveedor', async () => {
    await crearInversion(env, gerente, compra({ monto_usd: 100 }));
    await crearInversion(env, gerente, compra({ tipo: 'PERDIDA', monto_usd: 30 }));
    expect((await listarProveedores(env, gerente))[0]).toMatchObject({ n_compras: 1, total_usd: 100 });
  });

  it('se puede agregar, corregir y borrar; un nombre repetido da 409', async () => {
    const p = await crearProveedor(env, gerente, { nombre: 'Tecno Import', telefono: '0414-1112233', nota: 'Paga a 15 días' });
    expect(p).toMatchObject({ nombre: 'Tecno Import', telefono: '0414-1112233', nota: 'Paga a 15 días' });
    await rechazo(crearProveedor(env, gerente, { nombre: 'tecno  import' }), 409, 'proveedor_repetido');
    const otro = await crearProveedor(env, gerente, { nombre: 'Mayorista Sur' });
    await rechazo(actualizarProveedor(env, gerente, otro.id, { nombre: 'TECNO IMPORT' }), 409, 'proveedor_repetido');
    await rechazo(crearProveedor(env, gerente, { nombre: ' ' }), 400);
    await rechazo(actualizarProveedor(env, gerente, 'no-existe', { nombre: 'Algo' }), 404);
    await rechazo(eliminarProveedor(env, gerente, 'no-existe'), 404);
  });

  it('renombrar un proveedor cambia el nombre en sus registros; borrarlo los deja con su nombre y sin enlace', async () => {
    const i = await crearInversion(env, gerente, compra({ proveedor: 'Viejo Nombre' }));
    await actualizarProveedor(env, gerente, i.proveedor_id!, { nombre: 'Nuevo Nombre' });
    expect((await listarInversiones(env, gerente))[0].proveedor_nombre).toBe('Nuevo Nombre');
    await eliminarProveedor(env, gerente, i.proveedor_id!);
    expect(await listarProveedores(env, gerente)).toHaveLength(0);
    expect((await listarInversiones(env, gerente))[0]).toMatchObject({ proveedor_id: null, proveedor_nombre: 'Nuevo Nombre' });
  });
});

describe('consultar por período y local', () => {
  it('filtra por fechas (inclusive), por local y por tipo, y ordena del más reciente al más antiguo', async () => {
    await crearInversion(env, gerente, compra({ fecha: '2026-02-01', localId: vidrios }));
    await crearInversion(env, gerente, compra({ fecha: '2026-02-05', localId: accesorios }));
    await crearInversion(env, gerente, compra({ fecha: '2026-02-09', localId: vidrios, tipo: 'PERDIDA' }));
    const todas = await listarInversiones(env, gerente);
    expect(todas.map((x) => x.fecha)).toEqual(['2026-02-09', '2026-02-05', '2026-02-01']);
    expect(await listarInversiones(env, gerente, { desde: '2026-02-05', hasta: '2026-02-09' })).toHaveLength(2);
    expect(await listarInversiones(env, gerente, { localId: accesorios })).toHaveLength(1);
    expect(await listarInversiones(env, gerente, { tipo: 'COMPRA', desde: '2026-02-02' })).toHaveLength(1);
  });
});

describe('corregir y borrar', () => {
  it('corregir conserva la tasa si la fecha no cambia y la vuelve a tomar si cambia', async () => {
    const i = await crearInversion(env, gerente, compra({ fecha: '2026-01-20' }));
    await env.DB.prepare("INSERT INTO tasas_cambio (id, fecha, tasa, created_at) VALUES ('t3', '2026-01-20', 45, '2026-01-20T18:00:00.000Z')").run();
    const igual = await actualizarInversion(env, gerente, i.id, compra({ fecha: '2026-01-20', monto_usd: 200 }));
    expect(igual).toMatchObject({ monto_usd: 200, tasa_bcv: 40 });
    const otraFecha = await actualizarInversion(env, admin, i.id, compra({ fecha: '2026-02-12' }));
    expect(otraFecha.tasa_bcv).toBe(50);
  });

  it('se puede pasar un registro a otro local; uno que no existe da 404', async () => {
    const i = await crearInversion(env, gerente, compra({ localId: vidrios }));
    expect((await actualizarInversion(env, gerente, i.id, compra({ localId: accesorios }))).local_id).toBe(accesorios);
    await rechazo(actualizarInversion(env, gerente, 'no-existe', compra()), 404);
    await rechazo(eliminarInversion(env, gerente, 'no-existe'), 404);
  });

  it('borrar quita el registro', async () => {
    const i = await crearInversion(env, gerente, compra());
    await eliminarInversion(env, gerente, i.id);
    expect(await listarInversiones(env, gerente)).toHaveLength(0);
  });
});

describe('actualización en vivo', () => {
  it('solo el administrador y el gerente se enteran de los cambios de inversiones y proveedores', async () => {
    await crearInversion(env, gerente, compra());
    const tablas = (s: Sesion) => versionesVisibles(env, s).then((v) => v.map((x) => x.tabla));
    expect(await tablas(gerente)).toEqual(expect.arrayContaining(['inversiones', 'proveedores']));
    expect(await tablas(admin)).toEqual(expect.arrayContaining(['inversiones', 'proveedores']));
    for (const s of [encargado, vendedor, tecnico, contador]) {
      const t = await tablas(s);
      expect(t).not.toContain('inversiones');
      expect(t).not.toContain('proveedores');
    }
  });
});
