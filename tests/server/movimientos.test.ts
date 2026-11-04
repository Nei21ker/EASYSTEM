import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { crearProducto } from '../../src/server/servicios/catalogo';
import {
  listarMovimientos, listarUnidades, marcarUnidadesImpresas, obtenerUnidadPorCodigo, registrarMovimiento, registrarMovimientos,
} from '../../src/server/servicios/movimientos';
import { esCodigoUnidad } from '../../src/utils/codigos';

const env = crearEntornoDePrueba();
const { accesorios, vidrios, servicio } = IDS_LOCALES;

let admin: UsuarioDePrueba, gerente: UsuarioDePrueba, encargado: UsuarioDePrueba, vendedor: UsuarioDePrueba, tecnico: UsuarioDePrueba, contador: UsuarioDePrueba;
let sA: Sesion, sG: Sesion, sE: Sesion, sV: Sesion, sT: Sesion, sC: Sesion;
let P: string, Q: string;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
  gerente = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null });
  encargado = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: vidrios });
  vendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
  tecnico = await crearUsuarioDePrueba(env, { rol: 'tecnico', localId: servicio });
  contador = await crearUsuarioDePrueba(env, { rol: 'contador', localId: null });
  [sA, sG, sE, sV, sT, sC] = await Promise.all([admin, gerente, encargado, vendedor, tecnico, contador].map(sesionDe));
  P = (await crearProducto(env, sA, { codigo_barras: '2000000000015', nombre: 'Forro iPhone 11', categoria: 'Forros', precio_venta: 6 })).id;
  Q = (await crearProducto(env, sA, { codigo_barras: '2000000000022', nombre: 'Cable USB', categoria: 'Cables', precio_venta: 5 })).id;
});

async function rechazo(promesa: Promise<unknown>, status: number, texto?: string | RegExp): Promise<void> {
  try {
    await promesa;
  } catch (err) {
    expect(err).toBeInstanceOf(ErrorApi);
    expect((err as ErrorApi).status).toBe(status);
    if (texto) expect((err as ErrorApi).message).toMatch(texto);
    return;
  }
  throw new Error('Debía rechazarse y no se rechazó');
}

const entrada = (productoId: string, localId: string, cantidad: number, unidadCodigos?: string[]) =>
  registrarMovimiento(env, sA, { productoId, tipo: 'ENTRADA', cantidad, localId, motivo: 'Prueba', unidadCodigos });
const salida = (sesion: Sesion, productoId: string, localId: string, cantidad: number, unidadCodigos?: string[]) =>
  registrarMovimiento(env, sesion, { productoId, tipo: 'SALIDA', cantidad, localId, motivo: 'Venta POS', unidadCodigos });
const una = <T>(sql: string, ...v: unknown[]) => env.DB.prepare(sql).bind(...v).first<T>();
const stock = async (productoId: string, localId: string) => (await una<{ s: number }>('SELECT stock_actual AS s FROM inventario_local WHERE producto_id = ? AND local_id = ?', productoId, localId))?.s ?? 0;
const disponibles = async (productoId: string, localId: string) =>
  (await una<{ n: number }>("SELECT count(*) AS n FROM unidades_producto WHERE producto_id = ? AND local_id = ? AND estado = 'DISPONIBLE'", productoId, localId))!.n;
async function estadoGeneral() {
  return {
    movimientos: (await una<{ n: number }>('SELECT count(*) AS n FROM movimientos_inventario'))!.n,
    unidades: (await env.DB.prepare('SELECT codigo, estado, local_id FROM unidades_producto ORDER BY rowid').all()).results,
    stock: (await env.DB.prepare('SELECT local_id, producto_id, stock_actual FROM inventario_local ORDER BY local_id, producto_id').all()).results,
  };
}

describe('ENTRADA: una unidad con código por cada una', () => {
  it('crea N unidades con códigos únicos de 13 dígitos, y el movimiento los lista', async () => {
    const { movimiento, unidadCodigos } = await entrada(P, accesorios, 5);
    expect(unidadCodigos).toHaveLength(5);
    expect(new Set(unidadCodigos).size).toBe(5);
    expect(unidadCodigos.every(esCodigoUnidad)).toBe(true);
    expect(movimiento).toMatchObject({ producto_id: P, tipo: 'ENTRADA', cantidad: 5, local_id: accesorios, motivo: 'Prueba', unidad_codigos: unidadCodigos });
    expect(await stock(P, accesorios)).toBe(5);
    expect(await disponibles(P, accesorios)).toBe(5);
    expect((await una<{ s: number }>('SELECT stock_actual AS s FROM productos WHERE id = ?', P))?.s).toBe(5);
  });

  it('los códigos siguen la secuencia global (un contador), sin repetirse entre productos ni locales', async () => {
    const a = await entrada(P, accesorios, 3);
    const b = await entrada(Q, vidrios, 2);
    expect(new Set([...a.unidadCodigos, ...b.unidadCodigos]).size).toBe(5);
    expect((await una<{ valor: number }>("SELECT valor FROM contadores WHERE nombre = 'unidades'"))?.valor).toBe(5);
  });

  it('cantidad inválida o producto inexistente se rechazan sin dejar nada', async () => {
    await rechazo(entrada(P, accesorios, 0), 400);
    await rechazo(entrada(P, accesorios, 1.5), 400);
    await rechazo(entrada('no-existe', accesorios, 1), 404, 'Producto no encontrado.');
    expect((await estadoGeneral()).movimientos).toBe(0);
  });
});

describe('SALIDA: la unidad escaneada y, si faltan, las más antiguas', () => {
  it('la unidad escaneada va primero y se completa con la más antigua', async () => {
    const { unidadCodigos } = await entrada(P, accesorios, 5);
    const escaneada = unidadCodigos[3];
    const { unidadCodigos: vendidas, movimiento } = await salida(sV, P, accesorios, 2, [escaneada]);
    expect(vendidas).toEqual([escaneada, unidadCodigos[0]]);
    expect(movimiento.unidad_codigos).toEqual(vendidas);
    for (const c of vendidas) expect(await una<{ estado: string }>('SELECT estado FROM unidades_producto WHERE codigo = ?', c)).toMatchObject({ estado: 'VENDIDA' });
    expect(await stock(P, accesorios)).toBe(3);
    expect(await disponibles(P, accesorios)).toBe(3);
  });

  it('sin códigos indicados sale por orden de llegada (FIFO)', async () => {
    const { unidadCodigos } = await entrada(P, accesorios, 4);
    expect((await salida(sV, P, accesorios, 3)).unidadCodigos).toEqual(unidadCodigos.slice(0, 3));
  });

  it('una unidad ya vendida se rechaza y nada cambia', async () => {
    const { unidadCodigos } = await entrada(P, accesorios, 3);
    await salida(sV, P, accesorios, 1, [unidadCodigos[1]]);
    const antes = await estadoGeneral();
    await rechazo(salida(sV, P, accesorios, 1, [unidadCodigos[1]]), 409, /ya no está disponible/);
    expect(await estadoGeneral()).toEqual(antes);
  });

  it('una unidad de otro local o de otro producto se rechaza', async () => {
    const enVidrios = await entrada(P, vidrios, 2);
    const deQ = await entrada(Q, accesorios, 2);
    await entrada(P, accesorios, 2);
    await rechazo(salida(sV, P, accesorios, 1, [enVidrios.unidadCodigos[0]]), 409, /ya no está disponible/);
    await rechazo(salida(sV, P, accesorios, 1, [deQ.unidadCodigos[0]]), 409, /ya no está disponible/);
    await rechazo(salida(sV, P, accesorios, 1, ['2199999999999']), 409, /ya no está disponible/);
  });

  it('pedir más de lo que hay responde el mensaje de stock con nombre, disponible y solicitado', async () => {
    await entrada(P, accesorios, 2);
    await rechazo(salida(sV, P, accesorios, 3), 409, 'Stock insuficiente para "Forro iPhone 11" en este local: disponible 2, solicitado 3.');
    expect(await stock(P, accesorios)).toBe(2);
  });

  it('códigos repetidos o más códigos que cantidad se rechazan', async () => {
    const { unidadCodigos } = await entrada(P, accesorios, 3);
    await rechazo(salida(sV, P, accesorios, 2, [unidadCodigos[0], unidadCodigos[0]]), 400, 'Hay códigos de unidad repetidos en el movimiento.');
    await rechazo(salida(sV, P, accesorios, 1, [unidadCodigos[0], unidadCodigos[1]]), 400, 'Se indicaron 2 códigos de unidad para un movimiento de 1 unidades.');
  });
});

describe('devolución: ENTRADA con los códigos vendidos', () => {
  it('reactiva esas unidades y crea unidades nuevas por el resto', async () => {
    const { unidadCodigos } = await entrada(P, accesorios, 3);
    await salida(sV, P, accesorios, 2, [unidadCodigos[2], unidadCodigos[0]]);
    const devuelta = await entrada(P, accesorios, 2, [unidadCodigos[2]]);
    expect(devuelta.unidadCodigos[0]).toBe(unidadCodigos[2]);
    expect(devuelta.unidadCodigos).toHaveLength(2);
    expect(devuelta.unidadCodigos[1]).not.toBe(unidadCodigos[0]);
    expect(await una('SELECT estado FROM unidades_producto WHERE codigo = ?', unidadCodigos[2])).toEqual({ estado: 'DISPONIBLE' });
    expect(await una('SELECT estado FROM unidades_producto WHERE codigo = ?', unidadCodigos[0])).toEqual({ estado: 'VENDIDA' });
    expect(await stock(P, accesorios)).toBe(3);
    expect(await disponibles(P, accesorios)).toBe(3);
  });

  it('reactivar una unidad que no está vendida (o de otro producto) se rechaza', async () => {
    const { unidadCodigos } = await entrada(P, accesorios, 2);
    const deQ = await entrada(Q, accesorios, 1);
    await rechazo(entrada(P, accesorios, 1, [unidadCodigos[0]]), 400, 'Alguna de las unidades indicadas no está vendida o no pertenece a este producto.');
    await salida(sV, P, accesorios, 1, [unidadCodigos[0]]);
    await rechazo(entrada(Q, accesorios, 1, [unidadCodigos[0]]), 400, /no está vendida o no pertenece/);
    expect(deQ.unidadCodigos).toHaveLength(1);
  });

  it('la unidad vuelve al local donde se devolvió', async () => {
    const { unidadCodigos } = await entrada(P, accesorios, 1);
    await salida(sV, P, accesorios, 1, [unidadCodigos[0]]);
    await entrada(P, vidrios, 1, [unidadCodigos[0]]);
    expect(await una('SELECT local_id FROM unidades_producto WHERE codigo = ?', unidadCodigos[0])).toEqual({ local_id: vidrios });
  });
});

describe('invariante: unidades DISPONIBLES = stock de cada local', () => {
  it('se mantiene tras una secuencia de entradas, ventas y devoluciones', async () => {
    const a = await entrada(P, accesorios, 6);
    await entrada(P, vidrios, 3);
    await entrada(Q, accesorios, 4);
    await salida(sV, P, accesorios, 2, [a.unidadCodigos[4]]);
    await salida(sV, Q, accesorios, 3);
    await entrada(P, accesorios, 1, [a.unidadCodigos[4]]);
    await salida(sV, P, accesorios, 1);
    for (const [p, l] of [[P, accesorios], [P, vidrios], [Q, accesorios]] as const) {
      expect(await disponibles(p, l), `${p} en ${l}`).toBe(await stock(p, l));
    }
  });
});

describe('permisos', () => {
  it('el vendedor y el técnico venden en su local, pero no hacen entradas', async () => {
    await entrada(P, accesorios, 3);
    await entrada(P, servicio, 3);
    await salida(sV, P, accesorios, 1);
    await salida(sT, P, servicio, 1);
    await rechazo(registrarMovimiento(env, sV, { productoId: P, tipo: 'ENTRADA', cantidad: 1, localId: accesorios }), 403);
    await rechazo(registrarMovimiento(env, sT, { productoId: P, tipo: 'ENTRADA', cantidad: 1, localId: servicio }), 403);
  });

  it('nadie mueve el stock de un local que no es el suyo (salvo administrador y gerente)', async () => {
    await entrada(P, accesorios, 3);
    await entrada(P, vidrios, 3);
    await rechazo(salida(sV, P, vidrios, 1), 403);
    await rechazo(registrarMovimiento(env, sE, { productoId: P, tipo: 'ENTRADA', cantidad: 1, localId: accesorios }), 403);
    await registrarMovimiento(env, sE, { productoId: P, tipo: 'ENTRADA', cantidad: 1, localId: vidrios });
    await registrarMovimiento(env, sG, { productoId: P, tipo: 'ENTRADA', cantidad: 1, localId: accesorios });
    await salida(sG, P, vidrios, 1);
  });

  it('el contador no mueve inventario', async () => {
    await rechazo(salida(sC, P, accesorios, 1), 403);
  });

  it('un local suspendido no recibe movimientos de sus empleados', async () => {
    await entrada(P, accesorios, 3);
    await env.DB.prepare("UPDATE locales SET subscription_status = 'SUSPENDED' WHERE id = ?").bind(accesorios).run();
    await rechazo(salida(sV, P, accesorios, 1), 403);
  });
});

describe('concurrencia', () => {
  it('dos ventas simultáneas de la MISMA unidad: exactamente una se confirma', async () => {
    const { unidadCodigos } = await entrada(P, accesorios, 3);
    const resultados = await Promise.allSettled([salida(sV, P, accesorios, 1, [unidadCodigos[1]]), salida(sV, P, accesorios, 1, [unidadCodigos[1]])]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(resultados.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await stock(P, accesorios)).toBe(2);
    expect(await disponibles(P, accesorios)).toBe(2);
    expect((await una<{ n: number }>("SELECT count(*) AS n FROM movimientos_inventario WHERE tipo = 'SALIDA'"))?.n).toBe(1);
  });

  it('dos ventas simultáneas por orden de llegada con stock 2: ambas se confirman con unidades distintas', async () => {
    await entrada(P, accesorios, 2);
    const [a, b] = await Promise.all([salida(sV, P, accesorios, 1), salida(sV, P, accesorios, 1)]);
    expect(new Set([...a.unidadCodigos, ...b.unidadCodigos]).size).toBe(2);
    expect(await stock(P, accesorios)).toBe(0);
  });

  it('dos ventas simultáneas con stock 1: una se confirma y la otra recibe "Stock insuficiente"', async () => {
    await entrada(P, accesorios, 1);
    const resultados = await Promise.allSettled([salida(sV, P, accesorios, 1), salida(sV, P, accesorios, 1)]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const fallo = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((fallo.reason as ErrorApi).message).toMatch(/Stock insuficiente/);
    expect(await stock(P, accesorios)).toBe(0);
  });
});

describe('registrarMovimientos (lote atómico)', () => {
  it('aplica varios movimientos en orden, incluida una salida del producto que entró en el mismo lote', async () => {
    const r = await registrarMovimientos(env, sA, [
      { productoId: P, tipo: 'ENTRADA', cantidad: 3, localId: accesorios, motivo: 'Carga inicial (importación)' },
      { productoId: Q, tipo: 'ENTRADA', cantidad: 2, localId: accesorios },
      { productoId: P, tipo: 'SALIDA', cantidad: 2, localId: accesorios, motivo: 'Ajuste por importación' },
    ]);
    expect(r.map((x) => x.unidadCodigos.length)).toEqual([3, 2, 2]);
    expect(r[2].unidadCodigos).toEqual(r[0].unidadCodigos.slice(0, 2));
    expect(await stock(P, accesorios)).toBe(1);
    expect(await disponibles(P, accesorios)).toBe(1);
    expect(await stock(Q, accesorios)).toBe(2);
  });

  it('si un movimiento falla no se aplica NINGUNO', async () => {
    await entrada(P, accesorios, 1);
    const antes = await estadoGeneral();
    await rechazo(
      registrarMovimientos(env, sA, [
        { productoId: Q, tipo: 'ENTRADA', cantidad: 2, localId: accesorios },
        { productoId: P, tipo: 'SALIDA', cantidad: 5, localId: accesorios },
      ]),
      409,
      /Stock insuficiente/
    );
    expect(await estadoGeneral()).toEqual(antes);
  });

  it('rechaza lotes demasiado grandes y lotes vacíos', async () => {
    await rechazo(registrarMovimientos(env, sA, []), 400);
    await rechazo(registrarMovimientos(env, sA, Array.from({ length: 51 }, () => ({ productoId: P, tipo: 'ENTRADA' as const, cantidad: 1, localId: accesorios }))), 400);
    await rechazo(registrarMovimientos(env, sA, [{ productoId: P, tipo: 'ENTRADA', cantidad: 501, localId: accesorios }]), 400, /demasiadas unidades/i);
  });

  it('un lote grande (400 unidades) se aplica completo', async () => {
    const r = await registrarMovimientos(env, sA, [{ productoId: P, tipo: 'ENTRADA', cantidad: 400, localId: accesorios }]);
    expect(r[0].unidadCodigos).toHaveLength(400);
    expect(await disponibles(P, accesorios)).toBe(400);
  });
});

describe('lectura: movimientos y unidades', () => {
  it('listarMovimientos respeta el alcance, trae producto y local y ordena del más nuevo al más viejo', async () => {
    await entrada(P, accesorios, 1);
    await new Promise((r) => setTimeout(r, 5));
    await entrada(Q, vidrios, 1);
    const todos = await listarMovimientos(env, sG, 100);
    expect(todos.map((m) => m.producto_id)).toEqual([Q, P]);
    expect(todos[0]).toMatchObject({ producto: { nombre: 'Cable USB', codigo_barras: '2000000000022' }, local: { nombre: 'Local Vidrios' } });
    expect((await listarMovimientos(env, sV, 100)).map((m) => m.producto_id)).toEqual([P]);
    expect(await listarMovimientos(env, sA, 1)).toHaveLength(1);
    await rechazo(listarMovimientos(env, sC, 10), 403);
  });

  it('listarMovimientos con localId trae solo ese local y rechaza uno al que no se accede', async () => {
    await entrada(P, accesorios, 1);
    await entrada(Q, vidrios, 1);
    expect((await listarMovimientos(env, sA, 100, vidrios)).map((m) => m.producto_id)).toEqual([Q]);
    expect((await listarMovimientos(env, sG, 100, accesorios)).map((m) => m.producto_id)).toEqual([P]);
    await rechazo(listarMovimientos(env, sV, 100, vidrios), 403);
  });

  it('listarUnidades filtra por producto, estado, etiqueta y códigos, dentro del alcance', async () => {
    const a = await entrada(P, accesorios, 3);
    await entrada(P, vidrios, 2);
    await salida(sV, P, accesorios, 1, [a.unidadCodigos[0]]);
    expect(await listarUnidades(env, sV, { productoId: P })).toHaveLength(3); // solo su local
    expect(await listarUnidades(env, sG, { productoId: P })).toHaveLength(5);
    expect((await listarUnidades(env, sV, { estado: 'DISPONIBLE' })).map((u) => u.codigo)).toEqual(a.unidadCodigos.slice(1));
    expect((await listarUnidades(env, sV, { codigos: [a.unidadCodigos[2]] })).map((u) => u.codigo)).toEqual([a.unidadCodigos[2]]);
    expect(await listarUnidades(env, sV, { sinImprimir: true })).toHaveLength(3);
    await rechazo(listarUnidades(env, sC, {}), 403);
  });

  it('obtenerUnidadPorCodigo solo devuelve unidades de locales a los que se accede', async () => {
    const a = await entrada(P, accesorios, 1);
    const b = await entrada(P, vidrios, 1);
    expect((await obtenerUnidadPorCodigo(env, sV, a.unidadCodigos[0]))?.local_id).toBe(accesorios);
    expect(await obtenerUnidadPorCodigo(env, sV, b.unidadCodigos[0])).toBeNull();
    expect((await obtenerUnidadPorCodigo(env, sG, b.unidadCodigos[0]))?.local_id).toBe(vidrios);
    expect(await obtenerUnidadPorCodigo(env, sG, '2199999999999')).toBeNull();
  });

  it('marcarUnidadesImpresas: solo gerencia y solo unidades de sus locales', async () => {
    const a = await entrada(P, accesorios, 2);
    const b = await entrada(P, vidrios, 1);
    await rechazo(marcarUnidadesImpresas(env, sV, a.unidadCodigos), 403);
    expect(await marcarUnidadesImpresas(env, sE, [...a.unidadCodigos, ...b.unidadCodigos])).toBe(1); // el encargado es de vidrios
    expect(await marcarUnidadesImpresas(env, sA, a.unidadCodigos)).toBe(2);
    expect(await listarUnidades(env, sG, { sinImprimir: true })).toHaveLength(0);
  });
});

describe('actualización en vivo', () => {
  it('cada movimiento sube la versión de las tablas tocadas en ese local', async () => {
    await env.DB.prepare('DELETE FROM cambios').run();
    await entrada(P, accesorios, 2);
    const filas = await env.DB.prepare('SELECT tabla, local_id, version FROM cambios ORDER BY tabla').all();
    expect(filas.results).toEqual([
      { tabla: 'inventario_local', local_id: accesorios, version: 1 },
      { tabla: 'movimientos_inventario', local_id: accesorios, version: 1 },
      { tabla: 'productos', local_id: '', version: 1 },
      { tabla: 'unidades_producto', local_id: accesorios, version: 1 },
    ]);
  });
});
