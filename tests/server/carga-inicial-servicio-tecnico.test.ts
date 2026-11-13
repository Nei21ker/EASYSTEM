// Carga inicial del Local Servicio Técnico: mientras un producto no tiene foto o no tiene precio su cantidad se corrige a mano SIN
// movimientos (no se ve en Movimientos, Reportes ni Inversión). Con foto y precio ya no: el stock cambia solo con movimientos.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { actualizarProducto, crearProducto, establecerCantidadEnCarga } from '../../src/server/servicios/catalogo';
import { registrarMovimiento } from '../../src/server/servicios/movimientos';
import { guardarVenta } from '../../src/server/servicios/ventas';

const env = crearEntornoDePrueba();
const { servicio, accesorios } = IDS_LOCALES;

let admin: Sesion, gerente: Sesion, encargado: Sesion, encargadoAccesorios: Sesion, vendedor: Sesion;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  const usuarios = await Promise.all([
    crearUsuarioDePrueba(env, { rol: 'administrador', localId: null }),
    crearUsuarioDePrueba(env, { rol: 'gerente', localId: null, clave: 'Clave-gerente-servicio-123' }),
    crearUsuarioDePrueba(env, { rol: 'encargado', localId: servicio, clave: 'Clave-encargado-servicio-123' }),
    crearUsuarioDePrueba(env, { rol: 'encargado', localId: accesorios, clave: 'Clave-encargado-accesorios-123' }),
    crearUsuarioDePrueba(env, { rol: 'vendedor', localId: servicio }),
  ]);
  [admin, gerente, encargado, encargadoAccesorios, vendedor] = await Promise.all(usuarios.map(sesionDe));
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

const n = async (sql: string, ...v: unknown[]) => (await env.DB.prepare(sql).bind(...v).first<{ n: number }>())!.n;
const stockLocal = (id: string, local = servicio) => n('SELECT COALESCE((SELECT stock_actual FROM inventario_local WHERE producto_id = ? AND local_id = ?), -1) AS n', id, local);
const stockTotal = (id: string) => n('SELECT stock_actual AS n FROM productos WHERE id = ?', id);
const piezas = (id: string, estado = 'DISPONIBLE', local = servicio) => n('SELECT count(*) AS n FROM unidades_producto WHERE producto_id = ? AND estado = ? AND local_id = ?', id, estado, local);
const movimientos = () => n('SELECT count(*) AS n FROM movimientos_inventario');

/** Un producto recién cargado: sin foto y con precio 0 */
const enCarga = (nombre = 'Cable USB micro') => crearProducto(env, admin, { codigo_barras: `2${String(Math.random()).slice(2, 14)}`, nombre, categoria: 'Cables y adaptadores', precio_venta: 0, stock_minimo: 0 });

describe('establecerCantidadEnCarga', () => {
  it('sube la cantidad creando piezas con código SIN dejar ningún movimiento', async () => {
    const p = await enCarga();
    const r = await establecerCantidadEnCarga(env, encargado, p.id, servicio, 5);
    expect(r.cantidad).toBe(5);
    expect(await stockLocal(p.id)).toBe(5);
    expect(await stockTotal(p.id)).toBe(5);
    expect(await piezas(p.id)).toBe(5);
    expect(await movimientos()).toBe(0);
    // Las piezas quedan sin etiqueta impresa y con códigos consecutivos
    expect(await n('SELECT count(*) AS n FROM unidades_producto WHERE producto_id = ? AND impresa_en IS NULL', p.id)).toBe(5);
  });

  it('baja la cantidad quitando piezas (primero las sin etiqueta) y deja stock y piezas iguales', async () => {
    const p = await enCarga();
    await establecerCantidadEnCarga(env, admin, p.id, servicio, 6);
    // Dos piezas ya tienen etiqueta impresa: son las últimas que se quitan
    await env.DB.prepare("UPDATE unidades_producto SET impresa_en = '2026-11-01T10:00:00Z' WHERE codigo IN (SELECT codigo FROM unidades_producto WHERE producto_id = ? ORDER BY created_at, rowid LIMIT 2)").bind(p.id).run();
    await establecerCantidadEnCarga(env, admin, p.id, servicio, 3);
    expect(await stockLocal(p.id)).toBe(3);
    expect(await stockTotal(p.id)).toBe(3);
    expect(await piezas(p.id)).toBe(3);
    expect(await n('SELECT count(*) AS n FROM unidades_producto WHERE producto_id = ? AND impresa_en IS NOT NULL', p.id)).toBe(2);
    expect(await movimientos()).toBe(0);
    await establecerCantidadEnCarga(env, admin, p.id, servicio, 0);
    expect(await stockLocal(p.id)).toBe(0);
    expect(await piezas(p.id)).toBe(0);
  });

  it('el stock total suma lo de otros locales y no toca las piezas vendidas', async () => {
    const p = await enCarga();
    await registrarMovimiento(env, admin, { productoId: p.id, tipo: 'ENTRADA', cantidad: 4, localId: accesorios, motivo: 'Compra' });
    await establecerCantidadEnCarga(env, admin, p.id, servicio, 3);
    expect(await stockTotal(p.id)).toBe(7);
    await env.DB.prepare("UPDATE unidades_producto SET estado = 'VENDIDA' WHERE codigo = (SELECT codigo FROM unidades_producto WHERE producto_id = ? AND local_id = ? LIMIT 1)").bind(p.id, servicio).run();
    await env.DB.prepare('UPDATE inventario_local SET stock_actual = 2 WHERE producto_id = ? AND local_id = ?').bind(p.id, servicio).run();
    await establecerCantidadEnCarga(env, admin, p.id, servicio, 4); // 2 disponibles → 4: crea 2 más
    expect(await piezas(p.id, 'VENDIDA')).toBe(1);
    expect(await piezas(p.id)).toBe(4);
    expect(await stockLocal(p.id)).toBe(4);
  });

  it('un producto por cantidad solo cambia el número (sin piezas)', async () => {
    const p = await crearProducto(env, admin, { codigo_barras: '2000000000777', nombre: 'Mica sencilla', categoria: 'Otros', precio_venta: 0, control_por_cantidad: 1 });
    await establecerCantidadEnCarga(env, admin, p.id, servicio, 40);
    expect(await stockLocal(p.id)).toBe(40);
    expect(await piezas(p.id)).toBe(0);
    await establecerCantidadEnCarga(env, admin, p.id, servicio, 12);
    expect(await stockLocal(p.id)).toBe(12);
    expect(await movimientos()).toBe(0);
  });

  it('con foto Y precio el producto ya está activo: 409 y todo cambio es un movimiento', async () => {
    const p = await enCarga();
    await establecerCantidadEnCarga(env, admin, p.id, servicio, 2);
    await actualizarProducto(env, admin, p.id, { precio_venta: 3 }); // precio sin foto: sigue en carga
    await establecerCantidadEnCarga(env, admin, p.id, servicio, 3);
    await actualizarProducto(env, admin, p.id, { imagen_url: '/api/archivos/publico/foto.jpg' }); // ya tiene foto y precio
    await rechazo(establecerCantidadEnCarga(env, admin, p.id, servicio, 9), 409, 'producto_activo');
    expect(await stockLocal(p.id)).toBe(3);
  });

  it('con foto pero sin precio sigue en carga', async () => {
    const p = await enCarga();
    await actualizarProducto(env, admin, p.id, { imagen_url: '/api/archivos/publico/foto.jpg' });
    await establecerCantidadEnCarga(env, admin, p.id, servicio, 4);
    expect(await stockLocal(p.id)).toBe(4);
  });

  it('solo administrador, gerente y encargado de ESE local; solo en Servicio Técnico', async () => {
    const p = await enCarga();
    await rechazo(establecerCantidadEnCarga(env, vendedor, p.id, servicio, 1), 403, 'sin_permiso');
    await rechazo(establecerCantidadEnCarga(env, encargadoAccesorios, p.id, servicio, 1), 403, 'sin_permiso');
    await rechazo(establecerCantidadEnCarga(env, admin, p.id, accesorios, 1), 400, 'solo_servicio_tecnico');
    await rechazo(establecerCantidadEnCarga(env, encargadoAccesorios, p.id, accesorios, 1), 400, 'solo_servicio_tecnico');
    await establecerCantidadEnCarga(env, gerente, p.id, servicio, 1);
    await establecerCantidadEnCarga(env, encargado, p.id, servicio, 2);
    expect(await stockLocal(p.id)).toBe(2);
  });

  it('valida la cantidad y que el producto exista', async () => {
    const p = await enCarga();
    await rechazo(establecerCantidadEnCarga(env, admin, p.id, servicio, -1), 400, 'datos_invalidos');
    await rechazo(establecerCantidadEnCarga(env, admin, p.id, servicio, 2.5), 400, 'datos_invalidos');
    await rechazo(establecerCantidadEnCarga(env, admin, p.id, servicio, 501), 400, 'datos_invalidos');
    await rechazo(establecerCantidadEnCarga(env, admin, 'no-existe', servicio, 1), 404, 'no_existe');
    expect(await stockLocal(p.id)).toBe(-1); // ni siquiera se dio de alta en el local
  });

  it('avisa a las pantallas abiertas (versión de inventario y productos)', async () => {
    const p = await enCarga();
    const antes = await n("SELECT COALESCE(SUM(version), 0) AS n FROM cambios WHERE tabla IN ('inventario_local', 'productos')");
    await establecerCantidadEnCarga(env, admin, p.id, servicio, 2);
    expect(await n("SELECT COALESCE(SUM(version), 0) AS n FROM cambios WHERE tabla IN ('inventario_local', 'productos')")).toBeGreaterThan(antes);
  });
});

describe('nada se vende sin precio', () => {
  const venta = (productoId: string, nombre: string, precio: number) => ({
    fecha: new Date().toISOString(),
    local_id: servicio,
    cliente_cedula: 'V-12345678',
    cliente_nombre: 'Ana Prueba',
    cliente_telefono: '0414-1234567',
    metodo_pago: 'USD_EFECTIVO' as const,
    pagos: [{ metodo: 'USD_EFECTIVO' as const, monto_usd: precio, monto_bs: null }],
    vuelto: null,
    total: precio,
    tasa_cambio: 36.5,
    total_bs: null,
    items: [{ producto_id: productoId, nombre, codigo_barras: '2000000000015', cantidad: 1, precio_unitario: precio }],
  });

  it('el servidor rechaza una venta con un producto de precio 0 (aunque la línea traiga otro precio) y no guarda nada', async () => {
    const p = await enCarga('Taco sin precio');
    await rechazo(guardarVenta(env, encargado, venta(p.id, p.nombre, 0)), 400, 'sin_precio');
    await rechazo(guardarVenta(env, encargado, venta(p.id, p.nombre, 5)), 400, 'sin_precio');
    expect(await n('SELECT count(*) AS n FROM ventas')).toBe(0);
  });

  it('con precio sí se vende', async () => {
    const p = await enCarga('Taco con precio');
    await actualizarProducto(env, admin, p.id, { precio_venta: 5 });
    const v = await guardarVenta(env, encargado, venta(p.id, p.nombre, 5));
    expect(v.total).toBe(5);
  });
});
