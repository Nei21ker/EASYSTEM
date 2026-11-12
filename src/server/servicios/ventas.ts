// Ventas y devoluciones. Reglas portadas de las políticas RLS 0011/0014/0016/0023:
//   · registrar una venta: cualquier rol con acceso al local (el vendedor queda como `vendedor_id` por su sesión);
//   · ver ventas: administrador, gerente y encargado las de sus locales; vendedor y técnico solo las suyas;
//   · registrar una devolución: administrador, gerente y encargado del local de la venta; nadie edita ni borra.
// El folio sale de la tabla `contadores` DENTRO del mismo lote que inserta la fila (no se repite ni con ventas simultáneas).
import { alcanceDe, condicionAlcance, esAdministrador, esGerencia, esGlobal, localAccesible, type Sesion } from '../authz';
import { sentenciasCambio } from '../cambios';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';
import { limiteSeguro, nuevoId, redondear2 } from '../util';
import { esRutaPagoMovilDeLocal } from './archivos';
import { normalizarCedula, separarNombre } from './clientes';
import { verificarCodigoManual, verificarPrecioPromotor, type PrecioPromotorVerificado } from './autorizaciones';
import { marcas, registrarMovimientos, tramos, type EntradaMovimiento } from './movimientos';
import { sentenciasBorrarComisiones, sentenciasComisionPromotor } from './pendientes';
import { descripcionInstalacionPromotor, instalacionDelPromotor, limpiarInstalacion } from '../../utils/instalacion';
import { normalizarPromotor } from '../../utils/promotor';
import { redondeoValido } from '../../utils/pagos';
import type { Devolucion, NuevaDevolucion, NuevaVenta, Venta, VentaItem } from '../../types/database.types';

const METODOS = ['BS_PAGO_MOVIL', 'BS_PUNTO_VENTA', 'BS_EFECTIVO', 'USD_EFECTIVO', 'BINANCE_USDT', 'MIXTO'];

const json = (valor: unknown) => (valor === null || valor === undefined ? null : JSON.stringify(valor));
const analizar = <T>(texto: unknown): T | null => (typeof texto === 'string' ? (JSON.parse(texto) as T) : null);

function aVenta(f: Record<string, unknown>): Venta {
  return {
    ...(f as unknown as Venta),
    items: analizar(f.items) ?? [],
    pagos: analizar(f.pagos),
    vuelto: analizar(f.vuelto),
    tasa_cambio: (f.tasa_cambio as number | null) ?? null,
    total_bs: (f.total_bs as number | null) ?? null,
    vendedor_id: (f.vendedor_id as string | null) ?? null,
    vendedor_nombre: (f.vendedor_nombre as string | null) ?? null,
    comprobante_path: (f.comprobante_path as string | null) ?? null,
    referencia_pago_movil: (f.referencia_pago_movil as string | null) ?? null,
    promotor_id: (f.promotor_id as string | null) ?? null,
    promotor_nombre: (f.promotor_nombre as string | null) ?? null,
    promotor_cedula: (f.promotor_cedula as string | null) ?? null,
    promotor_telefono: (f.promotor_telefono as string | null) ?? null,
    promotor_banco: (f.promotor_banco as string | null) ?? null,
    comision: (f.comision as number | null) ?? 0,
    precio_autorizado_por: (f.precio_autorizado_por as string | null) ?? null,
    precio_autorizado_nombre: (f.precio_autorizado_nombre as string | null) ?? null,
  };
}

function aDevolucion(f: Record<string, unknown>): Devolucion {
  return {
    ...(f as unknown as Devolucion),
    items_devueltos: analizar(f.items_devueltos) ?? [],
    items_nuevos: analizar(f.items_nuevos) ?? [],
    pagos: analizar(f.pagos),
    vuelto: analizar(f.vuelto),
    reembolso: analizar(f.reembolso),
    tasa_cambio: (f.tasa_cambio as number | null) ?? null,
    registrado_nombre: (f.registrado_nombre as string | null) ?? null,
  };
}

/** La fecha que trae la venta (las hechas sin conexión conservan la suya); no se aceptan fechas del futuro. */
function fechaValida(fecha: string, mensaje: string): string {
  const t = Date.parse(fecha);
  if (!Number.isFinite(t) || t > Date.now() + 10 * 60_000) throw new ErrorApi(400, mensaje, 'datos_invalidos');
  return new Date(t).toISOString();
}

// --- Ventas ---------------------------------------------------------------------------------------------------
/**
 * Pago móvil: la venta lleva SIEMPRE la referencia (exactamente 4 dígitos); ya no se pide ni se guarda la captura del comprobante
 * (las ventas viejas conservan la suya). Devuelve lo que se guarda (todo null si no hay pago móvil: en ese caso cualquier referencia
 * o captura enviada se ignora).
 */
async function validarComprobantePagoMovil(_env: Entorno, datos: NuevaVenta): Promise<{ ruta: string | null; referencia: string | null }> {
  const conPagoMovil = datos.metodo_pago === 'BS_PAGO_MOVIL' || (datos.pagos ?? []).some((p) => p.metodo === 'BS_PAGO_MOVIL');
  if (!conPagoMovil) return { ruta: null, referencia: null };
  const referencia = (datos.referencia_pago_movil ?? '').trim();
  if (!referencia) throw new ErrorApi(400, 'Escribe la referencia del pago móvil (4 dígitos) para registrar la venta.', 'comprobante_requerido');
  if (!/^\d{4}$/.test(referencia)) throw new ErrorApi(400, 'La referencia del pago móvil debe tener exactamente 4 dígitos.', 'referencia_invalida');
  return { ruta: null, referencia };
}

interface PrecioPromotorDeVenta {
  /** Líneas de la venta, con `precio_lista` en las que se cobraron más caras que el catálogo */
  items: VentaItem[];
  comision: number;
  promotor: PrecioPromotorVerificado | null;
}

/**
 * Compara lo cobrado en cada línea con el precio de catálogo. Una línea con otro precio exige la autorización firmada de un supervisor:
 * si es más cara (precio de promotor) la diferencia es la comisión; si es más barata (descuento) la autoriza solo un gerente o un administrador. Los productos que no están en el catálogo se
 * dejan pasar (no hay con qué comparar).
 */
async function aplicarPrecioPromotor(env: Entorno, sesion: Sesion, datos: NuevaVenta): Promise<PrecioPromotorDeVenta> {
  const ids = [...new Set(datos.items.map((i) => i.producto_id))];
  const precios = new Map<string, number>();
  for (const grupo of tramos(ids)) {
    const filas = await env.DB
      .prepare(`SELECT id, precio_venta FROM productos WHERE id IN (${marcas(grupo.length)})`)
      .bind(...grupo)
      .all<{ id: string; precio_venta: number }>();
    for (const f of filas.results) precios.set(f.id, f.precio_venta);
  }

  const desviadas: [string, number][] = [];
  let hayDescuento = false;
  const items = datos.items.map((item): VentaItem => {
    const lista = precios.get(item.producto_id);
    if (lista === undefined) return item;
    const { precio_lista: _ignorado, precio_tipo: _tipo, ...limpio } = item;
    if (Math.abs(item.precio_unitario - lista) <= 0.005) return limpio;
    // Más caro (precio de promotor) o más barato (descuento) que el catálogo: exige la autorización firmada de un supervisor
    desviadas.push([item.producto_id, item.precio_unitario]);
    if (item.precio_unitario < lista - 0.005) hayDescuento = true;
    return { ...limpio, precio_lista: lista };
  });
  if (desviadas.length === 0) return { items, comision: 0, promotor: null };

  const promotor = await verificarPrecioPromotor(env, sesion, datos, desviadas, hayDescuento);
  if (promotor.modo === 'local') {
    // Precio del local: la tienda cambió el precio (más caro o con descuento) por su cuenta: sin promotor y sin comisión
    return { items: items.map((i) => (i.precio_lista === undefined ? i : { ...i, precio_tipo: 'local' as const })), comision: 0, promotor };
  }
  // La comisión es solo de las líneas más caras que el catálogo; un descuento no la reduce
  const comision = redondear2(items.reduce((s, i) => s + (i.precio_lista === undefined || i.precio_unitario <= i.precio_lista ? 0 : i.cantidad * (i.precio_unitario - i.precio_lista)), 0));
  return { items, comision, promotor };
}

/**
 * Las unidades que quien vende eligió a mano (la etiqueta no se leía) exigen la autorización firmada de un supervisor para ESE producto.
 * Se guardan marcadas y con quién las autorizó; la autorización en sí no se guarda. Las líneas sin selección manual salen limpias.
 */
async function aplicarSeleccionManual(env: Entorno, sesion: Sesion, localId: string, items: VentaItem[]): Promise<VentaItem[]> {
  const resultado: VentaItem[] = [];
  for (const item of items) {
    const { codigos_manuales: manuales, autorizacion_codigo: token, seleccion_manual: _ignorada, ...limpio } = item;
    if (!manuales?.length) {
      resultado.push(limpio);
      continue;
    }
    const propias = new Set(item.unidades ?? []);
    if (manuales.some((c) => !propias.has(c))) throw new ErrorApi(400, 'Un código elegido a mano no es de las unidades de esa línea.', 'datos_invalidos');
    const aut = await verificarCodigoManual(env, sesion, localId, item.producto_id, token ?? '');
    resultado.push({ ...limpio, seleccion_manual: { codigos: [...new Set(manuales)], autorizado_por: aut.autorizado_por, autorizado_nombre: aut.autorizado_nombre } });
  }
  return resultado;
}

/**
 * Piezas defectuosas de productos por cantidad: solo las marca el encargado, el gerente o el administrador. La baja ya se hizo aparte
 * (`registrarSalidaConMerma`); aquí solo queda en la venta cuántas fueron y su motivo. La autorización y la nota nunca se guardan en la venta.
 */
function limpiarDanados(sesion: Sesion, items: VentaItem[]): VentaItem[] {
  return items.map((item) => {
    const { autorizacion_danados: _token, danados_nota: _nota, danados, danados_motivo: motivo, ...resto } = item;
    if (!danados) return resto;
    if (!esGerencia(sesion.rol)) throw new ErrorApi(403, 'Solo el encargado, el gerente o el administrador pueden marcar piezas defectuosas.', 'sin_permiso');
    return { ...resto, danados, ...(motivo ? { danados_motivo: motivo } : {}) };
  });
}

/** Texto del pendiente de comisión: qué productos se vendieron más caros que la lista y a cuánto. */
function descripcionComision(items: VentaItem[]): string {
  const lineas = items
    .filter((i) => i.precio_lista !== undefined && i.precio_unitario > i.precio_lista)
    .map((i) => `${i.cantidad} × ${i.nombre} ($${i.precio_unitario} cobrado, lista $${i.precio_lista})`);
  const texto = lineas.slice(0, 3).join('; ') + (lineas.length > 3 ? `; y ${lineas.length - 3} más` : '');
  return `Comisión por venta con precio de promotor: ${texto}`;
}

type PromotorDeVenta = { cedula: string | null; nombre: string | null; nombrePropio: string; apellido: string; telefono: string | null; banco: string | null };

function identidadDeAutorizacion(p: PrecioPromotorVerificado): PromotorDeVenta {
  return { cedula: p.promotor_cedula, nombre: p.promotor_nombre, nombrePropio: p.promotor_nombre_propio, apellido: p.promotor_apellido, telefono: p.promotor_telefono, banco: p.promotor_banco };
}

/** Texto del pendiente: la comisión por el precio y/o la instalación que hizo el promotor. */
function descripcionPendiente(items: VentaItem[], comisionPrecio: number, instalacionPromotor: number): string {
  const partes: string[] = [];
  if (comisionPrecio > 0) partes.push(descripcionComision(items));
  if (instalacionPromotor > 0) partes.push(`Instalación hecha por el promotor: ${descripcionInstalacionPromotor(items)}`);
  return partes.join(' · ');
}

export async function guardarVenta(env: Entorno, sesion: Sesion, datos: NuevaVenta): Promise<Venta> {
  if (!(await localAccesible(env, sesion, datos.local_id))) throw new ErrorApi(403, 'No tienes acceso a ese local.', 'sin_permiso');

  const cedula = normalizarCedula(datos.cliente_cedula ?? '');
  const nombre = (datos.cliente_nombre ?? '').trim().replace(/\s+/g, ' ');
  const telefono = datos.cliente_telefono?.trim() ?? '';
  if (cedula.length < 5 || cedula.length > 20 || nombre.length < 3 || nombre.length > 120 || telefono.length < 7 || telefono.length > 25) {
    throw new ErrorApi(400, 'Faltan datos del cliente (cédula, nombre y teléfono).', 'datos_invalidos');
  }
  if (!Array.isArray(datos.items) || datos.items.length === 0) throw new ErrorApi(400, 'El carrito está vacío.', 'datos_invalidos');
  if (!Number.isFinite(datos.total) || datos.total < 0) throw new ErrorApi(400, 'El total de la venta no es válido.', 'datos_invalidos');
  if (!METODOS.includes(datos.metodo_pago)) throw new ErrorApi(400, 'Tipo de cobro inválido.', 'datos_invalidos');
  const fecha = fechaValida(datos.fecha, 'La fecha de la venta no es válida.');
  // Pagó de más en bolívares (redondeo): solo se guarda si es coherente (tipo de cobro en Bs, dentro del tope y con una tasa del día)
  if ((datos.pagos ?? []).some((p) => !redondeoValido(p, datos.tasa_cambio ?? 0))) {
    throw new ErrorApi(400, 'El redondeo de un pago en bolívares no es válido: pasa del límite o no corresponde al tipo de cobro.', 'datos_invalidos');
  }
  const comprobante = await validarComprobantePagoMovil(env, datos);
  const precios = await aplicarPrecioPromotor(env, sesion, datos);
  const itemsGuardados = limpiarDanados(sesion, await aplicarSeleccionManual(env, sesion, datos.local_id, precios.items.map(limpiarInstalacion)));

  // Instalación hecha por el promotor: es dinero que la tienda le entrega, así que se suma a lo que se le debe (comisión del precio + instalación).
  // El promotor sale de la autorización del precio si la hay; si no, de los datos que anotó quien vendió.
  const instalacionPromotor = instalacionDelPromotor(itemsGuardados);
  let identidad: PromotorDeVenta | null = precios.promotor?.modo === 'promotor' ? identidadDeAutorizacion(precios.promotor) : null;
  if (!identidad && instalacionPromotor > 0) {
    const r = normalizarPromotor(datos.promotor ?? null);
    if (!r.ok) throw new ErrorApi(400, r.mensaje, 'datos_invalidos');
    identidad = r.promotor;
  }
  const comisionTotal = redondear2(precios.comision + instalacionPromotor);

  const id = nuevoId();
  const db = env.DB;
  const separado = separarNombre(nombre, datos.cliente_apellido);
  const lote = await db.batch<{ valor: number }>([
    db.prepare("INSERT INTO contadores (nombre, valor) VALUES ('ventas', 1) ON CONFLICT (nombre) DO UPDATE SET valor = valor + 1 RETURNING valor"),
    db
      .prepare(
        `INSERT INTO ventas (id, folio, fecha, local_id, cliente_cedula, cliente_nombre, cliente_telefono, metodo_pago, total, items, pagos, vuelto, tasa_cambio, total_bs, vendedor_id, vendedor_nombre, comprobante_path, referencia_pago_movil,
                             promotor_id, promotor_nombre, promotor_cedula, promotor_telefono, promotor_banco, comision, precio_autorizado_por, precio_autorizado_nombre)
         VALUES (?, (SELECT valor FROM contadores WHERE nombre = 'ventas'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id, fecha, datos.local_id, cedula, nombre, telefono, datos.metodo_pago, redondear2(datos.total), JSON.stringify(itemsGuardados),
        json(datos.pagos), json(datos.vuelto), datos.tasa_cambio ?? null, datos.total_bs ?? null, sesion.userId, sesion.nombre, comprobante.ruta, comprobante.referencia,
        null, identidad?.nombre ?? precios.promotor?.promotor_nombre ?? null, identidad?.cedula ?? precios.promotor?.promotor_cedula ?? null, identidad?.telefono ?? precios.promotor?.promotor_telefono ?? null, identidad?.banco ?? precios.promotor?.promotor_banco ?? null, comisionTotal,
        precios.promotor?.autorizado_por ?? null, precios.promotor?.autorizado_nombre ?? null
      ),
    // El cliente queda recordado (o se actualizan sus datos) en el MISMO lote: si la venta falla, tampoco se guarda
    db
      .prepare(
        `INSERT INTO clientes (cedula, nombre, apellido, telefono, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (cedula) DO UPDATE SET nombre = excluded.nombre, apellido = excluded.apellido, telefono = excluded.telefono, updated_at = excluded.updated_at`
      )
      .bind(cedula, separado.nombre, separado.apellido, telefono, new Date().toISOString()),
    // La comisión del promotor queda anotada en Pendientes (y el promotor en el directorio) en el MISMO lote que la venta
    ...(identidad && comisionTotal > 0
      ? sentenciasComisionPromotor(db, sesion, {
          ventaId: id,
          localId: datos.local_id,
          comision: comisionTotal,
          descripcion: descripcionPendiente(itemsGuardados, precios.comision, instalacionPromotor),
          promotor: identidad,
        })
      : []),
    ...sentenciasCambio(db, ['ventas'], datos.local_id),
  ]);
  const folio = lote[0].results[0].valor;
  const fila = await db.prepare('SELECT * FROM ventas WHERE id = ?').bind(id).first<Record<string, unknown>>();
  return { ...aVenta(fila!), folio };
}

export async function listarVentas(
  env: Entorno,
  sesion: Sesion,
  opciones: { desde?: string; hasta?: string; limite?: number; localId?: string }
): Promise<Venta[]> {
  const alcance = await alcanceDe(env, sesion, opciones.localId);
  const { sql, valores } = condicionAlcance(alcance, 'local_id');
  const condiciones = [sql];
  const params: unknown[] = [...valores];
  // El vendedor y el técnico solo ven sus propias ventas
  if (!esGerencia(sesion.rol)) {
    condiciones.push('vendedor_id = ?');
    params.push(sesion.userId);
  }
  if (opciones.desde) {
    condiciones.push('fecha >= ?');
    params.push(opciones.desde);
  }
  if (opciones.hasta) {
    condiciones.push('fecha <= ?');
    params.push(opciones.hasta);
  }
  const limite = limiteSeguro(opciones.limite, 1000, 5000);
  const filas = await env.DB
    .prepare(`SELECT * FROM ventas WHERE ${condiciones.join(' AND ')} ORDER BY fecha DESC, rowid DESC LIMIT ?`)
    .bind(...params, limite)
    .all<Record<string, unknown>>();
  return filas.results.map(aVenta);
}

// --- Devoluciones --------------------------------------------------------------------------------------------------
export async function guardarDevolucion(env: Entorno, sesion: Sesion, datos: NuevaDevolucion): Promise<Devolucion> {
  if (!esGerencia(sesion.rol)) throw new ErrorApi(403, 'Solo el administrador, el gerente o el encargado registran devoluciones.', 'sin_permiso');
  if (!(await localAccesible(env, sesion, datos.local_id))) throw new ErrorApi(403, 'No tienes acceso a ese local.', 'sin_permiso');

  const motivo = (datos.motivo ?? '').trim().replace(/\s+/g, ' ');
  if (motivo.length < 3 || motivo.length > 200) throw new ErrorApi(400, 'Escribe el motivo de la devolución.', 'datos_invalidos');
  if (!Array.isArray(datos.items_devueltos) || datos.items_devueltos.length === 0) throw new ErrorApi(400, 'Indica qué producto se devuelve.', 'datos_invalidos');
  const fecha = fechaValida(datos.fecha, 'La fecha de la devolución no es válida.');

  const ventaOriginal = await env.DB.prepare('SELECT id, folio, local_id FROM ventas WHERE id = ?').bind(datos.venta_id).first<{ id: string; folio: number; local_id: string }>();
  if (!ventaOriginal) throw new ErrorApi(404, 'La venta no existe.', 'no_existe');
  if (ventaOriginal.local_id !== datos.local_id) throw new ErrorApi(400, 'La devolución debe registrarse en el local de la venta.', 'datos_invalidos');

  const id = nuevoId();
  const db = env.DB;
  const lote = await db.batch<{ valor: number }>([
    db.prepare("INSERT INTO contadores (nombre, valor) VALUES ('devoluciones', 1) ON CONFLICT (nombre) DO UPDATE SET valor = valor + 1 RETURNING valor"),
    db
      .prepare(
        `INSERT INTO devoluciones (id, folio, fecha, local_id, venta_id, venta_folio, motivo, items_devueltos, items_nuevos, total_devuelto, total_nuevo, diferencia, tasa_cambio, pagos, vuelto, reembolso, registrado_por, registrado_nombre)
         VALUES (?, (SELECT valor FROM contadores WHERE nombre = 'devoluciones'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id, fecha, datos.local_id, datos.venta_id, ventaOriginal.folio, motivo, JSON.stringify(datos.items_devueltos), JSON.stringify(datos.items_nuevos ?? []),
        redondear2(datos.total_devuelto), redondear2(datos.total_nuevo ?? 0), redondear2(datos.diferencia), datos.tasa_cambio ?? null,
        json(datos.pagos), json(datos.vuelto), json(datos.reembolso), sesion.userId, datos.registrado_nombre ?? sesion.nombre
      ),
    ...sentenciasCambio(db, ['devoluciones'], datos.local_id),
  ]);
  const fila = await db.prepare('SELECT * FROM devoluciones WHERE id = ?').bind(id).first<Record<string, unknown>>();
  return { ...aDevolucion(fila!), folio: lote[0].results[0].valor };
}

export async function listarDevoluciones(
  env: Entorno,
  sesion: Sesion,
  opciones: { ventaId?: string; limite?: number; localId?: string }
): Promise<Devolucion[]> {
  const alcance = await alcanceDe(env, sesion, opciones.localId);
  const { sql, valores } = condicionAlcance(alcance, 'd.local_id');
  const condiciones = [sql];
  const params: unknown[] = [...valores];
  if (opciones.ventaId) {
    condiciones.push('d.venta_id = ?');
    params.push(opciones.ventaId);
  }
  // Quien no es de gerencia solo ve las devoluciones de las ventas que puede ver (las suyas)
  if (!esGerencia(sesion.rol)) {
    condiciones.push('v.vendedor_id = ?');
    params.push(sesion.userId);
  }
  const limite = limiteSeguro(opciones.limite, 2000, 5000);
  const filas = await env.DB
    .prepare(`SELECT d.* FROM devoluciones d JOIN ventas v ON v.id = d.venta_id WHERE ${condiciones.join(' AND ')} ORDER BY d.fecha DESC, d.rowid DESC LIMIT ?`)
    .bind(...params, limite)
    .all<Record<string, unknown>>();
  return filas.results.map(aDevolucion);
}


// --- Resetear las ventas (solo el administrador) ----------------------------------------------------------------

export interface ResultadoReseteo {
  /** Ventas y devoluciones que se borraron (o que se borrarían, si fue una simulación) */
  ventas: number;
  devoluciones: number;
  /** Piezas que estaban vendidas por esas ventas y vuelven al stock */
  piezas: number;
  simulado: boolean;
}

const MOTIVO_RESETEO = 'Reseteo de ventas (restaura el stock)';
const PIEZAS_POR_TRAMO = 500; // tope de unidades por lote de movimientos
const MOVIMIENTOS_POR_TRAMO = 50;

interface GrupoPiezas {
  productoId: string;
  localId: string;
  codigos: string[];
}

/** De estos códigos, las piezas que siguen VENDIDAS (las devueltas ya están en el stock), agrupadas por producto y local. */
async function piezasVendidas(db: D1Database, codigos: Iterable<string>): Promise<{ grupos: Map<string, GrupoPiezas>; piezas: number }> {
  const grupos = new Map<string, GrupoPiezas>();
  let piezas = 0;
  for (const tramo of tramos([...new Set(codigos)])) {
    const filas = await db
      .prepare(`SELECT codigo, producto_id, local_id FROM unidades_producto WHERE estado = 'VENDIDA' AND codigo IN (${marcas(tramo.length)})`)
      .bind(...tramo)
      .all<{ codigo: string; producto_id: string; local_id: string }>();
    for (const f of filas.results) {
      const clave = `${f.producto_id}|${f.local_id}`;
      const grupo = grupos.get(clave) ?? { productoId: f.producto_id, localId: f.local_id, codigos: [] };
      grupo.codigos.push(f.codigo);
      grupos.set(clave, grupo);
      piezas++;
    }
  }
  return { grupos, piezas };
}

// Productos por cantidad (sin códigos de pieza): lo que una venta sacó del stock se repone por cantidad.
interface GrupoCantidad {
  productoId: string;
  localId: string;
  cantidad: number;
}

type ItemConCantidad = { producto_id: string; cantidad: number; danados?: number };

/**
 * Cuánto de cada producto por cantidad sacaron esas ventas del stock de su local (lo cobrado, las piezas defectuosas que se botaron y lo
 * entregado a cambio en sus devoluciones) menos lo que ya volvió por devoluciones. Las piezas con código se reponen por código.
 */
async function cantidadesPorCantidad(
  db: D1Database,
  ventas: { local_id: string; items: string }[],
  devoluciones: { local_id: string; items_devueltos?: string; items_nuevos: string }[]
): Promise<{ grupos: Map<string, GrupoCantidad>; productos: Set<string> }> {
  const leer = (texto: string | undefined) => (texto ? (JSON.parse(texto) as ItemConCantidad[]) : []);
  const ids = new Set<string>();
  for (const v of ventas) for (const i of leer(v.items)) ids.add(i.producto_id);
  for (const d of devoluciones) for (const i of [...leer(d.items_nuevos), ...leer(d.items_devueltos)]) ids.add(i.producto_id);
  const porCantidad = new Set<string>();
  for (const tramo of tramos([...ids])) {
    const filas = await db.prepare(`SELECT id FROM productos WHERE control_por_cantidad = 1 AND id IN (${marcas(tramo.length)})`).bind(...tramo).all<{ id: string }>();
    for (const f of filas.results) porCantidad.add(f.id);
  }
  const grupos = new Map<string, GrupoCantidad>();
  const sumar = (localId: string, productoId: string, n: number) => {
    if (!porCantidad.has(productoId) || n === 0) return;
    const clave = `${productoId}|${localId}`;
    const g = grupos.get(clave) ?? { productoId, localId, cantidad: 0 };
    g.cantidad += n;
    grupos.set(clave, g);
  };
  for (const v of ventas) for (const i of leer(v.items)) sumar(v.local_id, i.producto_id, i.cantidad + (i.danados ?? 0));
  for (const d of devoluciones) {
    for (const i of leer(d.items_nuevos)) sumar(d.local_id, i.producto_id, i.cantidad);
    for (const i of leer(d.items_devueltos)) sumar(d.local_id, i.producto_id, -i.cantidad);
  }
  for (const [clave, g] of grupos) if (g.cantidad <= 0) grupos.delete(clave);
  return { grupos, productos: porCantidad };
}

/** Repone al stock esas cantidades (una ENTRADA por producto y local, en lotes que respetan los topes). */
async function reponerCantidades(env: Entorno, sesion: Sesion, grupos: Map<string, GrupoCantidad>, motivo: string): Promise<void> {
  let lote: EntradaMovimiento[] = [];
  let enLote = 0;
  const enviar = async () => {
    if (lote.length > 0) await registrarMovimientos(env, sesion, lote);
    lote = [];
    enLote = 0;
  };
  for (const g of grupos.values()) {
    for (let restante = g.cantidad; restante > 0; ) {
      const trozo = Math.min(restante, PIEZAS_POR_TRAMO);
      if (enLote + trozo > PIEZAS_POR_TRAMO || lote.length >= MOVIMIENTOS_POR_TRAMO) await enviar();
      lote.push({ productoId: g.productoId, tipo: 'ENTRADA', cantidad: trozo, localId: g.localId, motivo });
      enLote += trozo;
      restante -= trozo;
    }
  }
  await enviar();
}

/** Repone esas piezas al stock: una ENTRADA por producto y local que reactiva las MISMAS piezas, por lotes que respetan los topes. */
async function reponerPiezas(env: Entorno, sesion: Sesion, grupos: Map<string, GrupoPiezas>, motivo: string): Promise<void> {
  let lote: EntradaMovimiento[] = [];
  let enLote = 0;
  const enviar = async () => {
    if (lote.length > 0) await registrarMovimientos(env, sesion, lote);
    lote = [];
    enLote = 0;
  };
  for (const grupo of grupos.values()) {
    for (let i = 0; i < grupo.codigos.length; i += PIEZAS_POR_TRAMO) {
      const trozo = grupo.codigos.slice(i, i + PIEZAS_POR_TRAMO);
      if (enLote + trozo.length > PIEZAS_POR_TRAMO || lote.length >= MOVIMIENTOS_POR_TRAMO) await enviar();
      lote.push({ productoId: grupo.productoId, tipo: 'ENTRADA', cantidad: trozo.length, localId: grupo.localId, motivo, unidadCodigos: trozo });
      enLote += trozo.length;
    }
  }
  await enviar();
}

/**
 * Borra TODAS las ventas y devoluciones y devuelve al stock las piezas que esas ventas dejaron vendidas (las de la venta y las
 * entregadas a cambio, menos las que ya se devolvieron). Es para limpiar las ventas de prueba: solo el administrador.
 *
 * Primero repone el stock (una ENTRADA "Reseteo de ventas" por producto y local, que reactiva las mismas piezas) y al final borra los
 * registros. Si algo falla a medias, volver a ejecutarlo termina el trabajo: solo repone lo que sigue vendido. Las piezas vendidas
 * por otro motivo (un repuesto de una orden de servicio) no se tocan. Con `simular` solo cuenta, sin cambiar nada.
 */
export async function resetearVentas(env: Entorno, sesion: Sesion, opciones: { simular?: boolean } = {}): Promise<ResultadoReseteo> {
  if (!esAdministrador(sesion.rol)) throw new ErrorApi(403, 'Solo el administrador puede resetear las ventas.', 'sin_permiso');
  const db = env.DB;

  const ventas = (await db.prepare('SELECT local_id, items FROM ventas').all<{ local_id: string; items: string }>()).results;
  const devoluciones = (await db.prepare('SELECT local_id, items_devueltos, items_nuevos FROM devoluciones').all<{ local_id: string; items_devueltos: string; items_nuevos: string }>()).results;

  // Piezas que estas ventas sacaron del stock: las de cada venta y las entregadas a cambio
  const codigos = new Set<string>();
  const juntar = (texto: string) => {
    for (const item of JSON.parse(texto) as { unidades?: string[] }[]) for (const c of item.unidades ?? []) codigos.add(c);
  };
  for (const v of ventas) juntar(v.items);
  for (const d of devoluciones) juntar(d.items_nuevos);

  // De ellas, las que siguen vendidas (las devueltas ya están en el stock)
  const { grupos: porGrupo, piezas: piezasConCodigo } = await piezasVendidas(db, codigos);
  // Los productos por cantidad no tienen códigos de pieza: se reponen por la cantidad que esas ventas sacaron
  const { grupos: porCantidad } = await cantidadesPorCantidad(db, ventas, devoluciones);
  const piezas = piezasConCodigo + [...porCantidad.values()].reduce((s, g) => s + g.cantidad, 0);

  const resultado: ResultadoReseteo = { ventas: ventas.length, devoluciones: devoluciones.length, piezas, simulado: !!opciones.simular };
  if (opciones.simular || (ventas.length === 0 && devoluciones.length === 0 && piezas === 0)) return resultado;

  // 1. Reponer el stock, por lotes que respetan los topes de movimientos y de piezas
  await reponerPiezas(env, sesion, porGrupo, MOTIVO_RESETEO);
  await reponerCantidades(env, sesion, porCantidad, MOTIVO_RESETEO);

  // 2. Borrar los registros (las devoluciones primero: apuntan a las ventas) y avisar a las pantallas abiertas
  const locales = new Set([...ventas.map((v) => v.local_id), ...devoluciones.map((d) => d.local_id)]);
  await db.batch([
    db.prepare('DELETE FROM devoluciones'),
    db.prepare('DELETE FROM ventas'),
    // Las comisiones de promotor por pagar nacieron de esas ventas: desaparecen con ellas (las ya pagadas se conservan)
    db.prepare("DELETE FROM pendientes WHERE tipo = 'COMISION' AND estado <> 'PAGADO' AND venta_id IS NOT NULL"),
    ...[...locales].flatMap((localId) => sentenciasCambio(db, ['ventas', 'devoluciones', 'pendientes'], localId)),
  ]);
  return resultado;
}

// --- Eliminar ventas elegidas (administrador y gerente) ----------------------------------------------------------

export interface ResultadoEliminacionVentas {
  ventas: number;
  /** Folios de las ventas que se eliminan (o eliminarían), de menor a mayor */
  folios: number[];
  devoluciones: number;
  /** Piezas que esas ventas dejaron vendidas y vuelven al stock de su local */
  piezas: number;
  /** Ventas hechas antes de que cada pieza tuviera código: se borran, pero no hay piezas que reponer */
  ventasSinPiezas: number;
  simulado: boolean;
}

export const MAX_VENTAS_A_ELIMINAR = 100;
const MARGEN_FECHA_SALIDA_MS = 10 * 60_000; // la salida de stock se registra un poco antes (o, sin conexión, después) que la fecha de la venta

/**
 * Elimina las ventas elegidas (error al cobrar, venta de prueba…): administrador y gerente, de los locales a los que acceden.
 *
 * Lo hace por una sola vía, igual que "Resetear ventas" pero solo con esas ventas:
 *  1. las piezas que esas ventas dejaron vendidas (las de la venta y las entregadas a cambio en sus devoluciones) vuelven al stock con
 *     una ENTRADA "Eliminación de venta" que reactiva LAS MISMAS piezas (no se crean códigos nuevos; lo ya devuelto no se cuenta dos veces);
 *  2. se borran las ventas con sus devoluciones y las SALIDAS de stock que las originaron, para que desaparezcan también de los
 *     reportes (que cuentan los ingresos y costos por esas salidas); la ENTRADA de reposición queda en Movimientos como rastro;
 *  3. se borra el comprobante del pago móvil (el archivo), que es un dato personal que ya no respalda nada.
 * El stock se repone primero y los registros se borran al final: si algo falla a medias, volver a ejecutarlo termina el trabajo.
 * Con `simular` solo cuenta. Los ids desconocidos se ignoran. No se puede deshacer: respalda antes de usarlo masivamente.
 */
export async function eliminarVentas(env: Entorno, sesion: Sesion, ids: string[], opciones: { simular?: boolean } = {}): Promise<ResultadoEliminacionVentas> {
  if (!esGlobal(sesion.rol)) throw new ErrorApi(403, 'Solo el administrador o el gerente pueden eliminar ventas.', 'sin_permiso');
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) throw new ErrorApi(400, 'Elige al menos una venta.', 'datos_invalidos');
  if (unicos.length > MAX_VENTAS_A_ELIMINAR) throw new ErrorApi(400, `Se pueden eliminar hasta ${MAX_VENTAS_A_ELIMINAR} ventas a la vez.`, 'lote_grande');
  await alcanceDe(env, sesion); // con todos los locales bloqueados (suscripción) el gerente no puede nada, ni siquiera con ids que no existen
  const db = env.DB;

  const ventas: { id: string; folio: number; fecha: string; local_id: string; items: string; comprobante_path: string | null }[] = [];
  for (const tramo of tramos(unicos)) {
    const filas = await db
      .prepare(`SELECT id, folio, fecha, local_id, items, comprobante_path FROM ventas WHERE id IN (${marcas(tramo.length)})`)
      .bind(...tramo)
      .all<(typeof ventas)[number]>();
    ventas.push(...filas.results);
  }
  // Primero el permiso (un gerente solo toca los locales de su alcance) y recién después se actúa
  for (const localId of new Set(ventas.map((v) => v.local_id))) {
    if (!(await localAccesible(env, sesion, localId))) throw new ErrorApi(403, 'No tienes acceso al local de una de esas ventas.', 'sin_permiso');
  }
  const idsVentas = ventas.map((v) => v.id);
  const devoluciones: { id: string; fecha: string; local_id: string; items_devueltos: string; items_nuevos: string }[] = [];
  for (const tramo of tramos(idsVentas)) {
    const filas = await db
      .prepare(`SELECT id, fecha, local_id, items_devueltos, items_nuevos FROM devoluciones WHERE venta_id IN (${marcas(tramo.length)})`)
      .bind(...tramo)
      .all<(typeof devoluciones)[number]>();
    devoluciones.push(...filas.results);
  }

  // Piezas de cada venta y de lo entregado a cambio en sus devoluciones, con el momento desde el que buscar sus salidas de stock
  const codigosDe = (texto: string): string[] => (JSON.parse(texto) as { unidades?: string[] }[]).flatMap((i) => i.unidades ?? []);
  const origenes: { localId: string; fecha: string; codigos: string[] }[] = [
    ...ventas.map((v) => ({ localId: v.local_id, fecha: v.fecha, codigos: codigosDe(v.items) })),
    ...devoluciones.map((d) => ({ localId: d.local_id, fecha: d.fecha, codigos: codigosDe(d.items_nuevos) })),
  ];
  const todos = new Set(origenes.flatMap((o) => o.codigos));
  const { grupos, piezas: piezasConCodigo } = await piezasVendidas(db, todos);
  // Productos por cantidad (sin códigos de pieza): se reponen por cantidad, y sus movimientos se reconocen por el id guardado en la venta
  const { grupos: porCantidad, productos: productosPorCantidad } = await cantidadesPorCantidad(db, ventas, devoluciones);
  const piezas = piezasConCodigo + [...porCantidad.values()].reduce((s, g) => s + g.cantidad, 0);
  const idsPorCantidad = new Set<string>(
    ventas.flatMap((v) => (JSON.parse(v.items) as { movimiento_id?: string; movimiento_baja_id?: string }[]).flatMap((i) => [i.movimiento_id, i.movimiento_baja_id].filter((x): x is string => !!x)))
  );
  const conPiezas = (v: { items: string }) => codigosDe(v.items).length > 0 || (JSON.parse(v.items) as ItemConCantidad[]).some((i) => productosPorCantidad.has(i.producto_id));

  const resultado: ResultadoEliminacionVentas = {
    ventas: ventas.length,
    folios: ventas.map((v) => v.folio).sort((a, b) => a - b),
    devoluciones: devoluciones.length,
    piezas,
    ventasSinPiezas: ventas.filter((v) => !conPiezas(v)).length,
    simulado: !!opciones.simular,
  };
  if (opciones.simular || ventas.length === 0) return resultado;

  // 1. Reponer el stock
  const folios = resultado.folios.map((f) => `#${String(f).padStart(4, '0')}`);
  const motivo = `Eliminación de ${folios.length === 1 ? 'la venta' : 'las ventas'} ${folios.slice(0, 6).join(', ')}${folios.length > 6 ? ` y ${folios.length - 6} más` : ''} (restaura el stock)`;
  await reponerPiezas(env, sesion, grupos, motivo);
  await reponerCantidades(env, sesion, porCantidad, motivo);

  // 2. Las salidas de stock de esas ventas: para cada pieza, la primera salida de su local desde la fecha de la venta
  const salidas = new Set<string>();
  for (const origen of origenes) {
    if (origen.codigos.length === 0) continue;
    const desde = new Date(Date.parse(origen.fecha) - MARGEN_FECHA_SALIDA_MS).toISOString();
    const primera = new Map<string, string>(); // código → id del movimiento más antiguo que lo sacó
    for (const tramo of tramos(origen.codigos)) {
      const filas = await db
        .prepare(
          `SELECT m.id AS id, j.value AS codigo FROM movimientos_inventario m, json_each(m.unidad_codigos) j
           WHERE m.tipo = 'SALIDA' AND m.local_id = ? AND m.fecha >= ? AND j.value IN (${marcas(tramo.length)}) ORDER BY m.fecha ASC`
        )
        .bind(origen.localId, desde, ...tramo)
        .all<{ id: string; codigo: string }>();
      for (const f of filas.results) if (!primera.has(f.codigo)) primera.set(f.codigo, f.id);
    }
    for (const id of primera.values()) salidas.add(id);
  }

  // 3. Borrar los registros (las devoluciones primero: apuntan a las ventas) y avisar a las pantallas abiertas
  const locales = new Set([...ventas.map((v) => v.local_id), ...devoluciones.map((d) => d.local_id)]);
  await db.batch([
    ...tramos(idsVentas).map((t) => db.prepare(`DELETE FROM devoluciones WHERE venta_id IN (${marcas(t.length)})`).bind(...t)),
    ...tramos(idsVentas).map((t) => db.prepare(`DELETE FROM ventas WHERE id IN (${marcas(t.length)})`).bind(...t)),
    ...sentenciasBorrarComisiones(db, idsVentas),
    ...tramos([...salidas]).map((t) => db.prepare(`DELETE FROM movimientos_inventario WHERE tipo = 'SALIDA' AND id IN (${marcas(t.length)})`).bind(...t)),
    // Productos por cantidad: la salida y la baja de las piezas defectuosas de esas ventas, y las filas de mermas que las acompañan
    ...tramos([...idsPorCantidad]).flatMap((t) => [
      db.prepare(`DELETE FROM mermas WHERE movimiento_id IN (${marcas(t.length)})`).bind(...t),
      db.prepare(`DELETE FROM movimientos_inventario WHERE tipo IN ('SALIDA', 'BAJA') AND id IN (${marcas(t.length)})`).bind(...t),
    ]),
    ...[...locales].flatMap((localId) => sentenciasCambio(db, ['ventas', 'devoluciones', 'movimientos_inventario', 'mermas', 'pendientes'], localId)),
  ]);

  // El archivo del comprobante ya no respalda ninguna venta (si falla, queda un archivo suelto sin consecuencias)
  const rutas = ventas.map((v) => v.comprobante_path).filter((r): r is string => !!r && !r.startsWith('data:'));
  if (rutas.length > 0) await env.FOTOS_PRIVADAS.delete(rutas).catch(() => undefined);
  return resultado;
}

// --- Resetear los reportes (solo el administrador) --------------------------------------------------------------

export interface ResultadoReseteoReportes {
  ventas: number;
  devoluciones: number;
  /** Movimientos de compra (ENTRADA) y venta (SALIDA) que alimentan los ingresos, costos y rankings */
  movimientos: number;
  simulado: boolean;
}

/**
 * Deja los reportes en cero: borra TODAS las ventas, las devoluciones y los movimientos ENTRADA/SALIDA (los únicos que los reportes
 * cuentan). NO toca el stock ni las piezas: lo que está en los estantes sigue igual y lo vendido sigue vendido (para devolver al stock
 * las piezas de ventas de prueba está "Resetear ventas"). El historial de bajas y traslados se conserva. Con `simular` solo cuenta.
 * Solo el administrador. Un solo lote atómico: o se borra todo o no se borra nada.
 */
export async function resetearReportes(env: Entorno, sesion: Sesion, opciones: { simular?: boolean } = {}): Promise<ResultadoReseteoReportes> {
  if (!esAdministrador(sesion.rol)) throw new ErrorApi(403, 'Solo el administrador puede resetear los reportes.', 'sin_permiso');
  const db = env.DB;
  const cuenta = async (sql: string) => (await db.prepare(sql).first<{ n: number }>())!.n;
  const resultado: ResultadoReseteoReportes = {
    ventas: await cuenta('SELECT count(*) AS n FROM ventas'),
    devoluciones: await cuenta('SELECT count(*) AS n FROM devoluciones'),
    movimientos: await cuenta("SELECT count(*) AS n FROM movimientos_inventario WHERE tipo IN ('ENTRADA','SALIDA')"),
    simulado: !!opciones.simular,
  };
  if (opciones.simular || (resultado.ventas === 0 && resultado.devoluciones === 0 && resultado.movimientos === 0)) return resultado;

  const locales = (
    await db
      .prepare('SELECT local_id FROM ventas UNION SELECT local_id FROM devoluciones UNION SELECT local_id FROM movimientos_inventario WHERE tipo IN (\'ENTRADA\',\'SALIDA\')')
      .all<{ local_id: string }>()
  ).results.map((f) => f.local_id);
  await db.batch([
    db.prepare('DELETE FROM devoluciones'), // primero: apuntan a las ventas
    db.prepare('DELETE FROM ventas'),
    db.prepare("DELETE FROM movimientos_inventario WHERE tipo IN ('ENTRADA','SALIDA')"),
    db.prepare("DELETE FROM pendientes WHERE tipo = 'COMISION' AND estado <> 'PAGADO' AND venta_id IS NOT NULL"),
    ...locales.flatMap((localId) => sentenciasCambio(db, ['ventas', 'devoluciones', 'movimientos_inventario', 'pendientes'], localId)),
  ]);
  return resultado;
}
