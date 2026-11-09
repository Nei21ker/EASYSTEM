// Productos "por cantidad": vidrios sencillos de menos de $3 sin etiqueta por pieza. Su stock es solo un número por local (no hay filas en
// unidades_producto), se venden por cantidad, y las piezas defectuosas al vender (o botadas en Descargo) salen como BAJA con su merma.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { autorizarDanados } from '../../src/server/servicios/autorizaciones';
import { actualizarProducto, crearProducto, crearProductosRapidos } from '../../src/server/servicios/catalogo';
import { darDeBajaPorCantidad, listarMermas, registrarSalidaConMerma } from '../../src/server/servicios/mermas';
import { registrarMovimiento, registrarMovimientos } from '../../src/server/servicios/movimientos';
import { eliminarVentas, guardarVenta, resetearVentas } from '../../src/server/servicios/ventas';
import type { NuevaVenta } from '../../src/types/database.types';

const env = crearEntornoDePrueba();
const { vidrios, accesorios } = IDS_LOCALES;

let admin: Sesion, gerente: Sesion, encargado: Sesion, vendedor: Sesion;
let usuarioGerente: UsuarioDePrueba, usuarioEncargado: UsuarioDePrueba;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  const ua = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
  usuarioGerente = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null, clave: 'Clave-gerente-vidrios-123' });
  usuarioEncargado = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: vidrios, nombre: 'Eli Encargada', clave: 'Clave-encargada-vidrios-123' });
  const uv = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: vidrios });
  [admin, gerente, encargado, vendedor] = await Promise.all([ua, usuarioGerente, usuarioEncargado, uv].map(sesionDe));
});

async function rechazo(promesa: Promise<unknown>, status: number, codigo?: string, texto?: string | RegExp): Promise<ErrorApi> {
  try {
    await promesa;
  } catch (err) {
    expect(err).toBeInstanceOf(ErrorApi);
    expect((err as ErrorApi).status).toBe(status);
    if (codigo) expect((err as ErrorApi).codigo).toBe(codigo);
    if (texto) expect((err as ErrorApi).message).toMatch(texto);
    return err as ErrorApi;
  }
  throw new Error('Debía rechazarse y no se rechazó');
}

const vidrio = { codigo_barras: '2000000000015', nombre: 'Vidrio sencillo Samsung A15', categoria: 'Vidrios Templados', precio_venta: 1, control_por_cantidad: 1 };
const n = async (sql: string, ...v: unknown[]) => (await env.DB.prepare(sql).bind(...v).first<{ n: number }>())!.n;
const stock = async (id: string, local = vidrios) => (await env.DB.prepare('SELECT stock_actual AS n FROM inventario_local WHERE producto_id = ? AND local_id = ?').bind(id, local).first<{ n: number }>())?.n ?? 0;
const unidades = (id: string) => n('SELECT count(*) AS n FROM unidades_producto WHERE producto_id = ?', id);

/** Un vidrio por cantidad con `inicial` piezas en el local de vidrios */
async function vidrioConStock(inicial = 20) {
  const p = await crearProducto(env, admin, vidrio);
  if (inicial > 0) await registrarMovimiento(env, encargado, { productoId: p.id, tipo: 'ENTRADA', cantidad: inicial, localId: vidrios, motivo: 'Compra' });
  return p;
}

describe('crear un producto por cantidad', () => {
  it('se crea con la marca y solo si cuesta menos de $3', async () => {
    const p = await crearProducto(env, admin, vidrio);
    expect(p.control_por_cantidad).toBe(1);
    await rechazo(crearProducto(env, admin, { ...vidrio, codigo_barras: '2000000000022', nombre: 'Vidrio caro', precio_venta: 3 }), 400, 'precio_no_permitido', /menos de \$3/);
    await rechazo(crearProducto(env, admin, { ...vidrio, codigo_barras: '2000000000039', nombre: 'Vidrio raro', precio_venta: 7 }), 400, 'precio_no_permitido');
    // Un producto normal sigue igual
    expect((await crearProducto(env, admin, { codigo_barras: '2000000000046', nombre: 'Forro', categoria: 'Forros', precio_venta: 7 })).control_por_cantidad).toBe(0);
  });

  it('el alta rápida también lo permite (todo o nada: un precio de $3 o más rechaza toda la lista)', async () => {
    const creados = await crearProductosRapidos(env, encargado, [
      { nombre: 'Vidrio sencillo A05', categoria: 'Vidrios Templados', precio_venta: 1, control_por_cantidad: 1 },
      { nombre: 'Vidrio sencillo A06', categoria: 'Vidrios Templados', precio_venta: 2, control_por_cantidad: 1 },
    ]);
    expect(creados).toHaveLength(2);
    expect(await n('SELECT count(*) AS n FROM productos WHERE control_por_cantidad = 1')).toBe(2);
    await rechazo(
      crearProductosRapidos(env, encargado, [
        { nombre: 'Vidrio sencillo A07', categoria: 'Vidrios Templados', precio_venta: 1, control_por_cantidad: 1 },
        { nombre: 'Vidrio caro A08', categoria: 'Vidrios Templados', precio_venta: 5, control_por_cantidad: 1 },
      ]),
      400,
      'precio_no_permitido'
    );
    expect(await n('SELECT count(*) AS n FROM productos')).toBe(2);
  });
});

describe('movimientos sin códigos por pieza', () => {
  it('una entrada suma al stock sin crear unidades ni gastar números de código; una salida lo resta', async () => {
    const p = await vidrioConStock(10);
    expect(await stock(p.id)).toBe(10);
    expect(await unidades(p.id)).toBe(0);
    expect(await n("SELECT count(*) AS n FROM contadores WHERE nombre LIKE 'unidad:%'")).toBe(0);

    const salida = await registrarMovimiento(env, vendedor, { productoId: p.id, tipo: 'SALIDA', cantidad: 4, localId: vidrios, motivo: 'Venta POS' });
    expect(salida.unidadCodigos).toEqual([]);
    expect(await stock(p.id)).toBe(6);
    await rechazo(registrarMovimiento(env, vendedor, { productoId: p.id, tipo: 'SALIDA', cantidad: 7, localId: vidrios }), 409, 'stock_insuficiente');
    expect(await stock(p.id)).toBe(6);
  });

  it('no acepta códigos de pieza ni bajas "normales" (por código) para estos productos, y una baja por cantidad exige su merma', async () => {
    const p = await vidrioConStock(5);
    await rechazo(registrarMovimiento(env, encargado, { productoId: p.id, tipo: 'SALIDA', cantidad: 1, localId: vidrios, unidadCodigos: ['INF000001'] }), 400, 'datos_invalidos', /por cantidad/);
    await rechazo(registrarMovimientos(env, encargado, [{ productoId: p.id, tipo: 'BAJA', cantidad: 1, localId: vidrios }]), 400, 'datos_invalidos');
    expect(await stock(p.id)).toBe(5);
  });

  it('un producto con código por pieza NO admite la baja por cantidad (se da de baja escaneando su etiqueta)', async () => {
    const normal = await crearProducto(env, admin, { codigo_barras: '2000000000046', nombre: 'Forro', categoria: 'Forros', precio_venta: 7 });
    await registrarMovimiento(env, encargado, { productoId: normal.id, tipo: 'ENTRADA', cantidad: 3, localId: vidrios });
    await rechazo(darDeBajaPorCantidad(env, encargado, { productoId: normal.id, localId: vidrios, cantidad: 1 }), 400, 'datos_invalidos', /etiqueta/);
    expect(await unidades(normal.id)).toBe(3);
    expect(await stock(normal.id)).toBe(3);
  });
});

describe('pieza defectuosa al vender', () => {
  it('se cobra 1 y se botan 2: el stock baja 3, queda una venta y una baja con su merma (quién y por qué)', async () => {
    const p = await vidrioConStock(10);
    const r = await registrarSalidaConMerma(env, encargado, { productoId: p.id, localId: vidrios, cantidad: 1, danados: 2, motivo: 'DEFECTO_FABRICA', nota: 'burbujas' });
    expect(r.salida.movimiento.tipo).toBe('SALIDA');
    expect(r.baja.movimiento.tipo).toBe('BAJA');
    expect(await stock(p.id)).toBe(7);
    const merma = await env.DB.prepare('SELECT * FROM mermas WHERE movimiento_id = ?').bind(r.baja.movimiento.id).first<Record<string, unknown>>();
    expect(merma).toMatchObject({ cantidad: 2, origen: 'VENTA', motivo: 'DEFECTO_FABRICA', nota: 'burbujas', por_nombre: 'Eli Encargada', autorizado_por: null });
  });

  it('el motivo es opcional', async () => {
    const p = await vidrioConStock(5);
    await registrarSalidaConMerma(env, encargado, { productoId: p.id, localId: vidrios, cantidad: 1, danados: 1 });
    expect((await env.DB.prepare('SELECT motivo FROM mermas').first<{ motivo: string | null }>())!.motivo).toBeNull();
  });

  it('es atómico: si no alcanza el stock para la venta MÁS la baja, no sale nada', async () => {
    const p = await vidrioConStock(2);
    await rechazo(registrarSalidaConMerma(env, encargado, { productoId: p.id, localId: vidrios, cantidad: 1, danados: 2 }), 409, 'stock_insuficiente');
    expect(await stock(p.id)).toBe(2);
    expect(await n('SELECT count(*) AS n FROM mermas')).toBe(0);
    expect(await n("SELECT count(*) AS n FROM movimientos_inventario WHERE tipo IN ('SALIDA', 'BAJA')")).toBe(0);
  });

  it('solo el encargado, el gerente y el administrador (un vendedor recibe 403)', async () => {
    const p = await vidrioConStock(5);
    await rechazo(registrarSalidaConMerma(env, vendedor, { productoId: p.id, localId: vidrios, cantidad: 1, danados: 1 }), 403, 'sin_permiso');
    await registrarSalidaConMerma(env, gerente, { productoId: p.id, localId: vidrios, cantidad: 1, danados: 1 });
    await registrarSalidaConMerma(env, admin, { productoId: p.id, localId: vidrios, cantidad: 1, danados: 1 });
    expect(await stock(p.id)).toBe(1);
  });

  it('el encargado de otro local no puede botar piezas de este', async () => {
    const p = await vidrioConStock(5);
    const otro = await sesionDe(await crearUsuarioDePrueba(env, { rol: 'encargado', localId: accesorios }));
    await rechazo(registrarSalidaConMerma(env, otro, { productoId: p.id, localId: vidrios, cantidad: 1, danados: 1 }), 403, 'sin_permiso');
  });

  it('con 3 o más defectuosas en la venta pide la clave de un gerente o administrador', async () => {
    const p = await vidrioConStock(20);
    // 2 no piden nada
    await registrarSalidaConMerma(env, encargado, { productoId: p.id, localId: vidrios, cantidad: 1, danados: 2 });
    // 3 sin autorización: se rechaza y no sale nada
    await rechazo(registrarSalidaConMerma(env, encargado, { productoId: p.id, localId: vidrios, cantidad: 1, danados: 3 }), 400, 'danados_no_autorizados');
    expect(await stock(p.id)).toBe(17);

    // La clave del propio encargado NO sirve (solo gerente o administrador)
    await rechazo(autorizarDanados(env, encargado, { clave: usuarioEncargado.clave, local_id: vidrios, cantidad: 3 }), 403, 'autorizador_invalido');
    const aut = await autorizarDanados(env, encargado, { clave: usuarioGerente.clave, local_id: vidrios, cantidad: 3 });
    expect(aut.autorizado_por).toBe('Usuario gerente');

    await registrarSalidaConMerma(env, encargado, { productoId: p.id, localId: vidrios, cantidad: 1, danados: 3, autorizacion: aut.token });
    expect(await stock(p.id)).toBe(13);
    const merma = await env.DB.prepare('SELECT autorizado_nombre FROM mermas WHERE cantidad = 3').first<{ autorizado_nombre: string }>();
    expect(merma!.autorizado_nombre).toBe('Usuario gerente');
  });

  it('el total de defectuosas es el de TODA la venta: dos líneas de 2 también piden clave, y la autorización debe cubrirlas', async () => {
    const p = await vidrioConStock(20);
    await rechazo(registrarSalidaConMerma(env, encargado, { productoId: p.id, localId: vidrios, cantidad: 1, danados: 2, danadosVenta: 4 }), 400, 'danados_no_autorizados');
    const corta = await autorizarDanados(env, encargado, { clave: usuarioGerente.clave, local_id: vidrios, cantidad: 3 });
    await rechazo(registrarSalidaConMerma(env, encargado, { productoId: p.id, localId: vidrios, cantidad: 1, danados: 2, danadosVenta: 4, autorizacion: corta.token }), 400, 'danados_no_autorizados', /Cubre 3/);
    const ok = await autorizarDanados(env, encargado, { clave: usuarioGerente.clave, local_id: vidrios, cantidad: 4 });
    await registrarSalidaConMerma(env, encargado, { productoId: p.id, localId: vidrios, cantidad: 1, danados: 2, danadosVenta: 4, autorizacion: ok.token });
    expect(await stock(p.id)).toBe(17);
  });

  it('la autorización es de quien vende: otro usuario no puede usarla', async () => {
    const p = await vidrioConStock(20);
    const aut = await autorizarDanados(env, encargado, { clave: usuarioGerente.clave, local_id: vidrios, cantidad: 3 });
    await rechazo(registrarSalidaConMerma(env, gerente, { productoId: p.id, localId: vidrios, cantidad: 1, danados: 3, autorizacion: aut.token }), 400, 'danados_no_autorizados', /otra venta o vendedor/);
  });

  it('una clave mala cuenta como intento fallido y tras 5 se bloquea', async () => {
    for (let i = 0; i < 5; i++) await rechazo(autorizarDanados(env, encargado, { clave: 'mala-' + i, local_id: vidrios, cantidad: 3 }), 403, 'autorizador_invalido');
    await rechazo(autorizarDanados(env, encargado, { clave: usuarioGerente.clave, local_id: vidrios, cantidad: 3 }), 429, 'demasiados_intentos');
  });
});

describe('bajas por cantidad (Descargo) y lista de pérdidas', () => {
  it('se bota cierta cantidad con su motivo; queda en movimientos y en la lista', async () => {
    const p = await vidrioConStock(10);
    const baja = await darDeBajaPorCantidad(env, encargado, { productoId: p.id, localId: vidrios, cantidad: 4, motivo: 'DANADO_AL_COLOCAR', nota: 'se cayó la caja' });
    expect(baja.movimiento.tipo).toBe('BAJA');
    expect(await stock(p.id)).toBe(6);
    const lista = await listarMermas(env, encargado);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ cantidad: 4, origen: 'DESCARGO', motivo: 'DANADO_AL_COLOCAR', producto_nombre: vidrio.nombre, por_nombre: 'Eli Encargada' });
    await rechazo(darDeBajaPorCantidad(env, encargado, { productoId: p.id, localId: vidrios, cantidad: 7 }), 409, 'stock_insuficiente');
    await rechazo(darDeBajaPorCantidad(env, vendedor, { productoId: p.id, localId: vidrios, cantidad: 1 }), 403, 'sin_permiso');
    await rechazo(listarMermas(env, vendedor), 403, 'sin_permiso');
  });

  it('el encargado solo ve las pérdidas de su local; el gerente, todas', async () => {
    const p = await vidrioConStock(10);
    await darDeBajaPorCantidad(env, encargado, { productoId: p.id, localId: vidrios, cantidad: 1 });
    await registrarMovimiento(env, admin, { productoId: p.id, tipo: 'ENTRADA', cantidad: 5, localId: accesorios });
    await darDeBajaPorCantidad(env, admin, { productoId: p.id, localId: accesorios, cantidad: 2 });
    expect((await listarMermas(env, encargado)).map((m) => m.local_id)).toEqual([vidrios]);
    expect(await listarMermas(env, gerente)).toHaveLength(2);
  });
});

describe('cambiar entre "por cantidad" y "con etiqueta por pieza"', () => {
  it('con stock se rechaza (409); con el stock en 0 solo lo cambia un gerente o administrador', async () => {
    const p = await vidrioConStock(3);
    await rechazo(actualizarProducto(env, admin, p.id, { control_por_cantidad: 0 }), 409, 'control_con_stock');
    await darDeBajaPorCantidad(env, encargado, { productoId: p.id, localId: vidrios, cantidad: 3 });
    await rechazo(actualizarProducto(env, encargado, p.id, { control_por_cantidad: 0 }), 403, 'sin_permiso');
    expect((await actualizarProducto(env, gerente, p.id, { control_por_cantidad: 0 })).control_por_cantidad).toBe(0);
    // Y de vuelta: solo si cuesta menos de $3
    await rechazo(actualizarProducto(env, gerente, p.id, { control_por_cantidad: 1, precio_venta: 5 }), 400, 'precio_no_permitido');
    expect((await actualizarProducto(env, gerente, p.id, { control_por_cantidad: 1 })).control_por_cantidad).toBe(1);
  });

  it('editar otros datos (precio, nombre) no toca el control ni pide stock 0', async () => {
    const p = await vidrioConStock(3);
    const editado = await actualizarProducto(env, encargado, p.id, { precio_venta: 2, nombre: 'Vidrio sencillo Samsung A15 5G' });
    expect(editado.control_por_cantidad).toBe(1);
    expect(editado.precio_venta).toBe(2);
  });
});

describe('eliminar y resetear ventas con productos por cantidad', () => {
  /** Una venta de `cantidad` piezas (y `danados` botadas) hecha como lo hace el POS: primero el movimiento y luego el registro de la venta */
  async function vender(productoId: string, cantidad: number, danados = 0) {
    let movimiento_id: string;
    let movimiento_baja_id: string | undefined;
    if (danados > 0) {
      const r = await registrarSalidaConMerma(env, encargado, { productoId, localId: vidrios, cantidad, danados });
      movimiento_id = r.salida.movimiento.id;
      movimiento_baja_id = r.baja.movimiento.id;
    } else {
      movimiento_id = (await registrarMovimiento(env, encargado, { productoId, tipo: 'SALIDA', cantidad, localId: vidrios, motivo: 'Venta POS' })).movimiento.id;
    }
    const venta: NuevaVenta = {
      fecha: new Date().toISOString(),
      local_id: vidrios,
      cliente_cedula: 'V-12345678',
      cliente_nombre: 'Ana Prueba',
      cliente_telefono: '0414-1234567',
      metodo_pago: 'USD_EFECTIVO',
      pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: cantidad, monto_bs: null }],
      vuelto: null,
      total: cantidad,
      tasa_cambio: 36.5,
      total_bs: null,
      items: [{ producto_id: productoId, nombre: vidrio.nombre, codigo_barras: vidrio.codigo_barras, cantidad, precio_unitario: 1, ...(danados ? { danados } : {}), movimiento_id, ...(movimiento_baja_id ? { movimiento_baja_id } : {}) }],
    };
    return guardarVenta(env, encargado, venta);
  }

  it('la venta guarda cuántas piezas se botaron y NO guarda la autorización ni la nota', async () => {
    const p = await vidrioConStock(10);
    const v = await vender(p.id, 2, 1);
    expect(v.items[0]).toMatchObject({ cantidad: 2, danados: 1 });
    expect(JSON.stringify(v.items)).not.toContain('autorizacion');
  });

  it('un vendedor no puede mandar piezas defectuosas en el registro de la venta (403)', async () => {
    const p = await vidrioConStock(10);
    const r = await registrarMovimiento(env, vendedor, { productoId: p.id, tipo: 'SALIDA', cantidad: 1, localId: vidrios });
    await rechazo(
      guardarVenta(env, vendedor, {
        fecha: new Date().toISOString(), local_id: vidrios, cliente_cedula: 'V-12345678', cliente_nombre: 'Ana Prueba', cliente_telefono: '0414-1234567',
        metodo_pago: 'USD_EFECTIVO', pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 1, monto_bs: null }], vuelto: null, total: 1, tasa_cambio: 36.5, total_bs: null,
        items: [{ producto_id: p.id, nombre: vidrio.nombre, codigo_barras: vidrio.codigo_barras, cantidad: 1, precio_unitario: 1, danados: 1, movimiento_id: r.movimiento.id }],
      }),
      403,
      'sin_permiso'
    );
  });

  it('eliminar la venta repone lo cobrado Y lo botado, y borra su salida, su baja y su merma', async () => {
    const p = await vidrioConStock(10);
    const v = await vender(p.id, 2, 1);
    expect(await stock(p.id)).toBe(7);
    const simulado = await eliminarVentas(env, admin, [v.id], { simular: true });
    expect(simulado).toMatchObject({ ventas: 1, piezas: 3, ventasSinPiezas: 0, simulado: true });
    expect(await stock(p.id)).toBe(7);

    const r = await eliminarVentas(env, admin, [v.id]);
    expect(r).toMatchObject({ ventas: 1, piezas: 3, ventasSinPiezas: 0 });
    expect(await stock(p.id)).toBe(10);
    expect(await n('SELECT count(*) AS n FROM ventas')).toBe(0);
    expect(await n('SELECT count(*) AS n FROM mermas')).toBe(0);
    expect(await n("SELECT count(*) AS n FROM movimientos_inventario WHERE tipo IN ('SALIDA', 'BAJA')")).toBe(0);
    // Queda la ENTRADA que restaura el stock como rastro
    expect(await n("SELECT count(*) AS n FROM movimientos_inventario WHERE tipo = 'ENTRADA' AND motivo LIKE 'Eliminación%'")).toBe(1);
  });

  it('resetear las ventas repone por cantidad los productos por cantidad', async () => {
    const p = await vidrioConStock(10);
    await vender(p.id, 3);
    await vender(p.id, 2, 2);
    expect(await stock(p.id)).toBe(3);
    expect(await resetearVentas(env, admin, { simular: true })).toMatchObject({ ventas: 2, piezas: 7 });
    await resetearVentas(env, admin);
    expect(await stock(p.id)).toBe(10);
    expect(await n('SELECT count(*) AS n FROM ventas')).toBe(0);
  });
});
