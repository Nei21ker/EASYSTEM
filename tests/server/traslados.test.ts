import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { crearProducto } from '../../src/server/servicios/catalogo';
import { listarMovimientos, listarUnidades, registrarMovimiento } from '../../src/server/servicios/movimientos';
import { cerrarTraslado, darDeBaja, despacharTraslado, listarDestinos, listarTraslados, recibirTraslado, revertirBaja } from '../../src/server/servicios/traslados';

const env = crearEntornoDePrueba();
const { accesorios, vidrios, servicio } = IDS_LOCALES;

let sA: Sesion, sG: Sesion, sEV: Sesion, sEA: Sesion, sV: Sesion, sC: Sesion;
let P: string, Q: string;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  const admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
  const gerente = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null });
  const encargadoVidrios = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: vidrios });
  const encargadoAccesorios = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: accesorios });
  const vendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
  const contador = await crearUsuarioDePrueba(env, { rol: 'contador', localId: null });
  [sA, sG, sEV, sEA, sV, sC] = await Promise.all([admin, gerente, encargadoVidrios, encargadoAccesorios, vendedor, contador].map(sesionDe));
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

const entrada = async (productoId: string, localId: string, cantidad: number) =>
  (await registrarMovimiento(env, sA, { productoId, tipo: 'ENTRADA', cantidad, localId, motivo: 'Prueba' })).unidadCodigos;
const una = <T>(sql: string, ...v: unknown[]) => env.DB.prepare(sql).bind(...v).first<T>();
const stock = async (productoId: string, localId: string) =>
  (await una<{ s: number }>('SELECT stock_actual AS s FROM inventario_local WHERE producto_id = ? AND local_id = ?', productoId, localId))?.s ?? 0;
const totalProducto = async (productoId: string) => (await una<{ s: number }>('SELECT stock_actual AS s FROM productos WHERE id = ?', productoId))!.s;
const estadoDe = async (codigo: string) => una<{ estado: string; local_id: string }>('SELECT estado, local_id FROM unidades_producto WHERE codigo = ?', codigo);
const disponibles = async (productoId: string, localId: string) =>
  (await una<{ n: number }>("SELECT count(*) AS n FROM unidades_producto WHERE producto_id = ? AND local_id = ? AND estado = 'DISPONIBLE'", productoId, localId))!.n;
async function fotografia() {
  return {
    unidades: (await env.DB.prepare('SELECT codigo, estado, local_id FROM unidades_producto ORDER BY rowid').all()).results,
    stock: (await env.DB.prepare('SELECT local_id, producto_id, stock_actual FROM inventario_local ORDER BY local_id, producto_id').all()).results,
    movimientos: (await una<{ n: number }>('SELECT count(*) AS n FROM movimientos_inventario'))!.n,
    traslados: (await una<{ n: number }>('SELECT count(*) AS n FROM traslados'))!.n,
  };
}

describe('despachar un traslado', () => {
  it('las piezas quedan EN_TRANSITO, el stock del origen baja y el del destino no cambia todavía', async () => {
    const codigos = await entrada(P, accesorios, 5);
    const t = await despacharTraslado(env, sG, { origenLocalId: accesorios, destinoLocalId: vidrios, codigos: codigos.slice(0, 3), notas: 'Para el mostrador' });

    expect(t).toMatchObject({ folio: 1, estado: 'EN_TRANSITO', origen_local_id: accesorios, destino_local_id: vidrios, notas: 'Para el mostrador' });
    expect(t.unidades.map((u) => u.codigo).sort()).toEqual(codigos.slice(0, 3).sort());
    expect(t.unidades[0]).toMatchObject({ producto_id: P, producto_nombre: 'Forro iPhone 11', recibida_en: null });
    for (const c of codigos.slice(0, 3)) expect((await estadoDe(c))!.estado).toBe('EN_TRANSITO');
    expect((await estadoDe(codigos[3]))!.estado).toBe('DISPONIBLE');
    expect(await stock(P, accesorios)).toBe(2);
    expect(await stock(P, vidrios)).toBe(0);
    expect(await totalProducto(P)).toBe(2); // lo que va en camino no cuenta en ningún local
    expect(await disponibles(P, accesorios)).toBe(2); // el stock sigue siendo igual a las unidades DISPONIBLES
  });

  it('registra UN movimiento TRASLADO_SALIDA por producto, con los códigos, y no cuenta como venta', async () => {
    const a = await entrada(P, accesorios, 3);
    const b = await entrada(Q, accesorios, 2);
    await despacharTraslado(env, sG, { origenLocalId: accesorios, destinoLocalId: vidrios, codigos: [...a, ...b.slice(0, 1)] });
    const movs = (await listarMovimientos(env, sG, 100)).filter((m) => m.tipo === 'TRASLADO_SALIDA');
    expect(movs).toHaveLength(2);
    const delP = movs.find((m) => m.producto_id === P)!;
    expect(delP).toMatchObject({ cantidad: 3, local_id: accesorios });
    expect(delP.motivo).toMatch(/Traslado #0001/);
    expect(delP.unidad_codigos!.sort()).toEqual([...a].sort());
    expect(movs.some((m) => (m.tipo as string) === 'SALIDA')).toBe(false);
  });

  it('los folios son consecutivos', async () => {
    const codigos = await entrada(P, accesorios, 2);
    const t1 = await despacharTraslado(env, sG, { origenLocalId: accesorios, destinoLocalId: vidrios, codigos: [codigos[0]] });
    const t2 = await despacharTraslado(env, sG, { origenLocalId: accesorios, destinoLocalId: servicio, codigos: [codigos[1]] });
    expect([t1.folio, t2.folio]).toEqual([1, 2]);
  });

  it('una pieza en tránsito ya no se puede vender ni dar de baja ni despachar otra vez', async () => {
    const codigos = await entrada(P, accesorios, 2);
    await despacharTraslado(env, sG, { origenLocalId: accesorios, destinoLocalId: vidrios, codigos: [codigos[0]] });
    await rechazo(registrarMovimiento(env, sA, { productoId: P, tipo: 'SALIDA', cantidad: 1, localId: accesorios, unidadCodigos: [codigos[0]] }), 409);
    await rechazo(darDeBaja(env, sA, { localId: accesorios, codigos: [codigos[0]], motivo: 'DANADA' }), 409);
    await rechazo(despacharTraslado(env, sA, { origenLocalId: accesorios, destinoLocalId: vidrios, codigos: [codigos[0]] }), 409);
  });

  it('rechaza piezas vendidas, de otro local, repetidas, un destino igual al origen o inexistente, y una lista vacía', async () => {
    const enAccesorios = await entrada(P, accesorios, 2);
    const enVidrios = await entrada(P, vidrios, 1);
    await registrarMovimiento(env, sA, { productoId: P, tipo: 'SALIDA', cantidad: 1, localId: accesorios, unidadCodigos: [enAccesorios[0]] });
    const base = { origenLocalId: accesorios, destinoLocalId: vidrios };
    await rechazo(despacharTraslado(env, sA, { ...base, codigos: [enAccesorios[0]] }), 409); // vendida
    await rechazo(despacharTraslado(env, sA, { ...base, codigos: [enVidrios[0]] }), 409); // es de otro local
    await rechazo(despacharTraslado(env, sA, { ...base, codigos: ['2199999999999'] }), 409); // no existe
    await rechazo(despacharTraslado(env, sA, { ...base, codigos: [enAccesorios[1], enAccesorios[1]] }), 400);
    await rechazo(despacharTraslado(env, sA, { ...base, destinoLocalId: accesorios, codigos: [enAccesorios[1]] }), 400);
    await rechazo(despacharTraslado(env, sA, { ...base, destinoLocalId: '00000000-0000-4000-8000-0000000000ff', codigos: [enAccesorios[1]] }), 404);
    await rechazo(despacharTraslado(env, sA, { ...base, codigos: [] }), 400);
  });

  it('es todo o nada: si una pieza no sirve, no cambia nada', async () => {
    const codigos = await entrada(P, accesorios, 3);
    await registrarMovimiento(env, sA, { productoId: P, tipo: 'SALIDA', cantidad: 1, localId: accesorios, unidadCodigos: [codigos[2]] });
    const antes = await fotografia();
    await rechazo(despacharTraslado(env, sA, { origenLocalId: accesorios, destinoLocalId: vidrios, codigos: [codigos[0], codigos[1], codigos[2]] }), 409);
    expect(await fotografia()).toEqual(antes);
  });

  it('permisos: el vendedor y el contador no; el encargado solo desde su propio local', async () => {
    const codigos = await entrada(P, accesorios, 3);
    const datos = { origenLocalId: accesorios, destinoLocalId: vidrios, codigos: [codigos[0]] };
    await rechazo(despacharTraslado(env, sV, datos), 403);
    await rechazo(despacharTraslado(env, sC, datos), 403);
    await rechazo(despacharTraslado(env, sEV, datos), 403); // el encargado de vidrios no despacha desde accesorios
    expect((await despacharTraslado(env, sEA, datos)).estado).toBe('EN_TRANSITO'); // el de accesorios sí
    // y puede mandar a cualquier otro local
    expect((await despacharTraslado(env, sEA, { ...datos, destinoLocalId: servicio, codigos: [codigos[1]] })).destino_local_id).toBe(servicio);
  });
});

describe('recibir un traslado', () => {
  async function despachado(cantidad = 3) {
    const codigos = await entrada(P, accesorios, cantidad);
    const t = await despacharTraslado(env, sG, { origenLocalId: accesorios, destinoLocalId: vidrios, codigos });
    return { codigos, t };
  }

  it('recibir todas las piezas las deja DISPONIBLES en el destino, sube su stock y cierra el traslado', async () => {
    const { codigos, t } = await despachado(3);
    const r = await recibirTraslado(env, sEV, t.id, codigos);
    expect(r.estado).toBe('RECIBIDO');
    expect(r.recibido_por).toBeTruthy();
    expect(r.unidades.every((u) => u.recibida_en)).toBe(true);
    for (const c of codigos) expect(await estadoDe(c)).toEqual({ estado: 'DISPONIBLE', local_id: vidrios });
    expect(await stock(P, vidrios)).toBe(3);
    expect(await stock(P, accesorios)).toBe(0);
    expect(await totalProducto(P)).toBe(3);
    expect(await disponibles(P, vidrios)).toBe(3);
    const entradas = (await listarMovimientos(env, sG, 100)).filter((m) => m.tipo === 'TRASLADO_ENTRADA');
    expect(entradas).toHaveLength(1);
    expect(entradas[0]).toMatchObject({ cantidad: 3, local_id: vidrios });
  });

  it('una recepción parcial deja el traslado abierto con lo que falta', async () => {
    const { codigos, t } = await despachado(3);
    const r = await recibirTraslado(env, sEV, t.id, [codigos[0]]);
    expect(r.estado).toBe('EN_TRANSITO');
    expect(r.unidades.filter((u) => u.recibida_en)).toHaveLength(1);
    expect(await stock(P, vidrios)).toBe(1);
    expect((await estadoDe(codigos[1]))!.estado).toBe('EN_TRANSITO');
    const r2 = await recibirTraslado(env, sEV, t.id, [codigos[1], codigos[2]]);
    expect(r2.estado).toBe('RECIBIDO');
    expect(await stock(P, vidrios)).toBe(3);
  });

  it('rechaza piezas que no son de ese traslado, ya recibidas o repetidas', async () => {
    const { codigos, t } = await despachado(2);
    const ajena = (await entrada(P, vidrios, 1))[0];
    await rechazo(recibirTraslado(env, sEV, t.id, [ajena]), 400, /no es de este traslado|no pertenece/i);
    await rechazo(recibirTraslado(env, sEV, t.id, [codigos[0], codigos[0]]), 400);
    await recibirTraslado(env, sEV, t.id, [codigos[0]]);
    await rechazo(recibirTraslado(env, sEV, t.id, [codigos[0]]), 409, /ya se recibi/i);
    await rechazo(recibirTraslado(env, sEV, t.id, []), 400);
    await rechazo(recibirTraslado(env, sEV, 'no-existe', [codigos[1]]), 404);
  });

  it('permisos: recibe el encargado del DESTINO (no el del origen ni el de otro local); administrador y gerente siempre', async () => {
    const { codigos, t } = await despachado(3);
    await rechazo(recibirTraslado(env, sEA, t.id, [codigos[0]]), 403); // encargado del origen
    await rechazo(recibirTraslado(env, sV, t.id, [codigos[0]]), 403);
    await rechazo(recibirTraslado(env, sC, t.id, [codigos[0]]), 403);
    expect((await recibirTraslado(env, sG, t.id, [codigos[0]])).unidades.filter((u) => u.recibida_en)).toHaveLength(1);
    expect((await recibirTraslado(env, sA, t.id, [codigos[1]])).unidades.filter((u) => u.recibida_en)).toHaveLength(2);
    expect((await recibirTraslado(env, sEV, t.id, [codigos[2]])).estado).toBe('RECIBIDO');
  });

  it('un encargado de un local que no interviene ni siquiera ve que existe el traslado', async () => {
    const { codigos, t } = await despachado(1);
    const otro = await sesionDe(await crearUsuarioDePrueba(env, { rol: 'encargado', localId: servicio }));
    await rechazo(recibirTraslado(env, otro, t.id, codigos), 403);
  });
});

describe('cerrar un traslado (lo que no llegó vuelve al origen)', () => {
  it('sin haber recibido nada: todo vuelve al origen y el traslado queda ANULADO', async () => {
    const codigos = await entrada(P, accesorios, 3);
    const t = await despacharTraslado(env, sG, { origenLocalId: accesorios, destinoLocalId: vidrios, codigos });
    const c = await cerrarTraslado(env, sEA, t.id);
    expect(c.estado).toBe('ANULADO');
    expect(c.cerrado_en).toBeTruthy();
    for (const codigo of codigos) expect(await estadoDe(codigo)).toEqual({ estado: 'DISPONIBLE', local_id: accesorios });
    expect(await stock(P, accesorios)).toBe(3);
    expect(await totalProducto(P)).toBe(3);
    expect(c.unidades.every((u) => u.devuelta_en)).toBe(true);
    const entradas = (await listarMovimientos(env, sG, 100)).filter((m) => m.tipo === 'TRASLADO_ENTRADA');
    expect(entradas[0]).toMatchObject({ local_id: accesorios, cantidad: 3 });
    expect(entradas[0].motivo).toMatch(/no lleg|devuel/i);
  });

  it('con una recepción parcial: lo recibido se queda en el destino, lo que falta vuelve, y queda RECIBIDO', async () => {
    const codigos = await entrada(P, accesorios, 4);
    const t = await despacharTraslado(env, sG, { origenLocalId: accesorios, destinoLocalId: vidrios, codigos });
    await recibirTraslado(env, sEV, t.id, codigos.slice(0, 3));
    const c = await cerrarTraslado(env, sEV, t.id); // también lo puede cerrar el encargado del destino
    expect(c.estado).toBe('RECIBIDO');
    expect(await estadoDe(codigos[3])).toEqual({ estado: 'DISPONIBLE', local_id: accesorios });
    expect(await stock(P, vidrios)).toBe(3);
    expect(await stock(P, accesorios)).toBe(1);
    expect(await totalProducto(P)).toBe(4);
  });

  it('un traslado cerrado ya no se puede recibir ni cerrar otra vez; otro local ajeno no lo cierra', async () => {
    const codigos = await entrada(P, accesorios, 2);
    const t = await despacharTraslado(env, sG, { origenLocalId: accesorios, destinoLocalId: vidrios, codigos });
    const ajeno = await sesionDe(await crearUsuarioDePrueba(env, { rol: 'encargado', localId: servicio }));
    await rechazo(cerrarTraslado(env, ajeno, t.id), 403);
    await rechazo(cerrarTraslado(env, sV, t.id), 403);
    await cerrarTraslado(env, sG, t.id);
    await rechazo(recibirTraslado(env, sEV, t.id, [codigos[0]]), 409, /ya est[aá] cerrado/i);
    await rechazo(cerrarTraslado(env, sG, t.id), 409, /ya est[aá] cerrado/i);
  });
});

describe('listar traslados', () => {
  it('cada quien ve los traslados donde su local es origen o destino; administrador y gerente, todos', async () => {
    const a = await entrada(P, accesorios, 2);
    const t1 = await despacharTraslado(env, sG, { origenLocalId: accesorios, destinoLocalId: vidrios, codigos: [a[0]] });
    const t2 = await despacharTraslado(env, sG, { origenLocalId: accesorios, destinoLocalId: servicio, codigos: [a[1]] });
    expect((await listarTraslados(env, sG)).map((t) => t.id).sort()).toEqual([t1.id, t2.id].sort());
    expect((await listarTraslados(env, sEV)).map((t) => t.id)).toEqual([t1.id]);
    expect((await listarTraslados(env, sEA)).map((t) => t.id).sort()).toEqual([t1.id, t2.id].sort());
    const t = (await listarTraslados(env, sG)).find((x) => x.id === t1.id)!;
    expect(t.origen_nombre).toBeTruthy();
    expect(t.destino_nombre).toBeTruthy();
    expect(t.unidades).toHaveLength(1);
    await rechazo(listarTraslados(env, sV), 403);
    await rechazo(listarTraslados(env, sC), 403);
  });

  it('se puede filtrar por estado', async () => {
    const a = await entrada(P, accesorios, 2);
    const t1 = await despacharTraslado(env, sG, { origenLocalId: accesorios, destinoLocalId: vidrios, codigos: [a[0]] });
    await despacharTraslado(env, sG, { origenLocalId: accesorios, destinoLocalId: vidrios, codigos: [a[1]] });
    await recibirTraslado(env, sG, t1.id, [a[0]]);
    expect(await listarTraslados(env, sG, { estado: 'EN_TRANSITO' })).toHaveLength(1);
    expect(await listarTraslados(env, sG, { estado: 'RECIBIDO' })).toHaveLength(1);
  });
});

describe('bajas de piezas', () => {
  it('una pieza dañada, usada o en garantía sale del stock del local y queda BAJA con su motivo', async () => {
    const codigos = await entrada(P, accesorios, 4);
    const r = await darDeBaja(env, sEA, { localId: accesorios, codigos: [codigos[0], codigos[1]], motivo: 'DANADA', nota: 'Se cayó del mostrador' });
    expect(r.codigos.sort()).toEqual([codigos[0], codigos[1]].sort());
    const u = await una<Record<string, unknown>>('SELECT estado, baja_motivo, baja_nota, baja_en, baja_por FROM unidades_producto WHERE codigo = ?', codigos[0]);
    expect(u).toMatchObject({ estado: 'BAJA', baja_motivo: 'DANADA', baja_nota: 'Se cayó del mostrador' });
    expect(u!.baja_en).toBeTruthy();
    expect(u!.baja_por).toBeTruthy();
    expect(await stock(P, accesorios)).toBe(2);
    expect(await totalProducto(P)).toBe(2);
    expect(await disponibles(P, accesorios)).toBe(2);
    await darDeBaja(env, sA, { localId: accesorios, codigos: [codigos[2]], motivo: 'GARANTIA' });
    await darDeBaja(env, sA, { localId: accesorios, codigos: [codigos[3]], motivo: 'USADA' });
    expect(await stock(P, accesorios)).toBe(0);
  });

  it('registra un movimiento BAJA por producto con el motivo, y no cuenta como venta', async () => {
    const a = await entrada(P, accesorios, 2);
    const b = await entrada(Q, accesorios, 1);
    await darDeBaja(env, sA, { localId: accesorios, codigos: [...a, ...b], motivo: 'GARANTIA', nota: 'Reclamo al proveedor' });
    const bajas = (await listarMovimientos(env, sA, 100)).filter((m) => m.tipo === 'BAJA');
    expect(bajas).toHaveLength(2);
    const delP = bajas.find((m) => m.producto_id === P)!;
    expect(delP.cantidad).toBe(2);
    expect(delP.motivo).toMatch(/Baja.*garant[ií]a.*Reclamo al proveedor/i);
    expect(delP.unidad_codigos!.sort()).toEqual([...a].sort());
  });

  it('una pieza dada de baja ya no se puede vender, trasladar ni dar de baja otra vez', async () => {
    const [c] = await entrada(P, accesorios, 1);
    await darDeBaja(env, sA, { localId: accesorios, codigos: [c], motivo: 'DANADA' });
    await rechazo(registrarMovimiento(env, sA, { productoId: P, tipo: 'SALIDA', cantidad: 1, localId: accesorios, unidadCodigos: [c] }), 409);
    await rechazo(despacharTraslado(env, sA, { origenLocalId: accesorios, destinoLocalId: vidrios, codigos: [c] }), 409);
    await rechazo(darDeBaja(env, sA, { localId: accesorios, codigos: [c], motivo: 'USADA' }), 409);
  });

  it('rechaza piezas vendidas o de otro local, un motivo inventado, repetidas o una lista vacía; y es todo o nada', async () => {
    const a = await entrada(P, accesorios, 3);
    const v = await entrada(P, vidrios, 1);
    await registrarMovimiento(env, sA, { productoId: P, tipo: 'SALIDA', cantidad: 1, localId: accesorios, unidadCodigos: [a[0]] });
    const antes = await fotografia();
    await rechazo(darDeBaja(env, sA, { localId: accesorios, codigos: [a[1], a[0]], motivo: 'DANADA' }), 409); // una vendida
    await rechazo(darDeBaja(env, sA, { localId: accesorios, codigos: [a[1], v[0]], motivo: 'DANADA' }), 409); // una de otro local
    expect(await fotografia()).toEqual(antes);
    await rechazo(darDeBaja(env, sA, { localId: accesorios, codigos: [a[1]], motivo: 'ROBADA' as never }), 400);
    await rechazo(darDeBaja(env, sA, { localId: accesorios, codigos: [a[1], a[1]], motivo: 'DANADA' }), 400);
    await rechazo(darDeBaja(env, sA, { localId: accesorios, codigos: [], motivo: 'DANADA' }), 400);
  });

  it('permisos: vendedor y contador no; el encargado solo en su local; administrador y gerente en cualquiera', async () => {
    const a = await entrada(P, accesorios, 3);
    const datos = { localId: accesorios, codigos: [a[0]], motivo: 'DANADA' as const };
    await rechazo(darDeBaja(env, sV, datos), 403);
    await rechazo(darDeBaja(env, sC, datos), 403);
    await rechazo(darDeBaja(env, sEV, datos), 403);
    await darDeBaja(env, sEA, datos);
    await darDeBaja(env, sG, { ...datos, codigos: [a[1]] });
    await darDeBaja(env, sA, { ...datos, codigos: [a[2]] });
  });

  it('listarUnidades filtra por BAJA y EN_TRANSITO', async () => {
    const a = await entrada(P, accesorios, 3);
    await darDeBaja(env, sA, { localId: accesorios, codigos: [a[0]], motivo: 'USADA' });
    await despacharTraslado(env, sA, { origenLocalId: accesorios, destinoLocalId: vidrios, codigos: [a[1]] });
    expect((await listarUnidades(env, sA, { estado: 'BAJA' })).map((u) => u.codigo)).toEqual([a[0]]);
    expect((await listarUnidades(env, sA, { estado: 'BAJA' }))[0]).toMatchObject({ baja_motivo: 'USADA' });
    expect((await listarUnidades(env, sA, { estado: 'EN_TRANSITO' })).map((u) => u.codigo)).toEqual([a[1]]);
  });
});

describe('revertir una baja', () => {
  it('administrador y gerente devuelven la pieza al stock (por si se escaneó por error); el encargado no', async () => {
    const [c1, c2] = await entrada(P, accesorios, 2);
    await darDeBaja(env, sEA, { localId: accesorios, codigos: [c1, c2], motivo: 'DANADA' });
    expect(await stock(P, accesorios)).toBe(0);
    await rechazo(revertirBaja(env, sEA, [c1]), 403);
    await rechazo(revertirBaja(env, sV, [c1]), 403);
    expect(await revertirBaja(env, sG, [c1])).toBe(1);
    expect(await estadoDe(c1)).toEqual({ estado: 'DISPONIBLE', local_id: accesorios });
    const u = await una<{ baja_motivo: string | null }>('SELECT baja_motivo FROM unidades_producto WHERE codigo = ?', c1);
    expect(u!.baja_motivo).toBeNull();
    expect(await stock(P, accesorios)).toBe(1);
    expect(await totalProducto(P)).toBe(1);
    const rev = (await listarMovimientos(env, sA, 100)).filter((m) => m.tipo === 'ENTRADA' && /revers/i.test(m.motivo ?? ''));
    expect(rev).toHaveLength(1);
    expect(await revertirBaja(env, sA, [c2])).toBe(1);
  });

  it('solo se revierte una pieza que está en BAJA', async () => {
    const [c] = await entrada(P, accesorios, 1);
    await rechazo(revertirBaja(env, sA, [c]), 409);
    await rechazo(revertirBaja(env, sA, ['2199999999999']), 409);
    await rechazo(revertirBaja(env, sA, []), 400);
  });
});

describe('las piezas que se movieron y vuelven a venderse', () => {
  it('una pieza trasladada se puede vender en el destino con el mismo código', async () => {
    const [c] = await entrada(P, accesorios, 1);
    const t = await despacharTraslado(env, sG, { origenLocalId: accesorios, destinoLocalId: vidrios, codigos: [c] });
    await recibirTraslado(env, sEV, t.id, [c]);
    const venta = await registrarMovimiento(env, sEV, { productoId: P, tipo: 'SALIDA', cantidad: 1, localId: vidrios, unidadCodigos: [c] });
    expect(venta.unidadCodigos).toEqual([c]);
    expect((await estadoDe(c))!.estado).toBe('VENDIDA');
  });
});

describe('destinos posibles', () => {
  it('un encargado ve todos los locales vigentes como destino (aunque en el resto de la app solo vea el suyo); vendedor y contador no', async () => {
    const r = await listarDestinos(env, sEA);
    expect(r.map((l) => l.id).sort()).toEqual(expect.arrayContaining([accesorios, vidrios, servicio]));
    expect(Object.keys(r[0]).sort()).toEqual(['id', 'nombre', 'tipo']);
    await rechazo(listarDestinos(env, sV), 403);
    await rechazo(listarDestinos(env, sC), 403);
  });

  it('un local suspendido no aparece como destino', async () => {
    await env.DB.prepare("UPDATE locales SET subscription_status = 'SUSPENDED' WHERE id = ?").bind(servicio).run();
    const r = await listarDestinos(env, sG);
    expect(r.map((l) => l.id)).not.toContain(servicio);
  });
});
