// Ventas y devoluciones. Reglas portadas de las políticas RLS 0011/0014/0016/0023:
//   · registrar una venta: cualquier rol con acceso al local (el vendedor queda como `vendedor_id` por su sesión);
//   · ver ventas: administrador, gerente y encargado las de sus locales; vendedor y técnico solo las suyas;
//   · registrar una devolución: administrador, gerente y encargado del local de la venta; nadie edita ni borra.
// El folio sale de la tabla `contadores` DENTRO del mismo lote que inserta la fila (no se repite ni con ventas simultáneas).
import { alcanceDe, condicionAlcance, esAdministrador, esGerencia, localAccesible, type Sesion } from '../authz';
import { sentenciasCambio } from '../cambios';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';
import { limiteSeguro, nuevoId, redondear2 } from '../util';
import { esRutaPagoMovilDeLocal } from './archivos';
import { normalizarCedula, separarNombre } from './clientes';
import { verificarCodigoManual, verificarPrecioPromotor, type PrecioPromotorVerificado } from './autorizaciones';
import { marcas, registrarMovimientos, tramos, type EntradaMovimiento } from './movimientos';
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
 * Un cobro por pago móvil exige un respaldo: la captura del comprobante O la referencia del pago (4 dígitos), o ambas. La captura debe
 * estar ya subida al almacenamiento privado, ser de ESTE local y no estar usada por otra venta (una misma captura no respalda dos
 * ventas). Devuelve lo que se guarda (todo null si no hay pago móvil: en ese caso cualquier captura o referencia enviada se ignora).
 */
async function validarComprobantePagoMovil(env: Entorno, datos: NuevaVenta): Promise<{ ruta: string | null; referencia: string | null }> {
  const conPagoMovil = datos.metodo_pago === 'BS_PAGO_MOVIL' || (datos.pagos ?? []).some((p) => p.metodo === 'BS_PAGO_MOVIL');
  if (!conPagoMovil) return { ruta: null, referencia: null };
  const ruta = (datos.comprobante_path ?? '').trim();
  const referencia = (datos.referencia_pago_movil ?? '').trim();
  if (referencia && !/^\d{4}$/.test(referencia)) throw new ErrorApi(400, 'La referencia del pago móvil debe tener exactamente 4 dígitos.', 'referencia_invalida');
  if (!ruta && !referencia) {
    throw new ErrorApi(400, 'Adjunta la captura del comprobante del pago móvil o escribe su referencia (4 dígitos) para registrar la venta.', 'comprobante_requerido');
  }
  if (!ruta) return { ruta: null, referencia };
  if (!esRutaPagoMovilDeLocal(ruta, datos.local_id)) throw new ErrorApi(400, 'La captura del pago móvil no es válida para este local.', 'comprobante_invalido');
  if (!(await env.FOTOS_PRIVADAS.head(ruta))) throw new ErrorApi(400, 'La captura del pago móvil no se subió. Vuelve a adjuntarla.', 'comprobante_invalido');
  const usada = await env.DB.prepare('SELECT 1 AS ok FROM ventas WHERE comprobante_path = ?').bind(ruta).first();
  if (usada) throw new ErrorApi(409, 'Esa captura ya respalda otra venta. Adjunta la del pago de esta venta.', 'comprobante_en_uso');
  return { ruta, referencia: referencia || null };
}

interface PrecioPromotorDeVenta {
  /** Líneas de la venta, con `precio_lista` en las que se cobraron más caras que el catálogo */
  items: VentaItem[];
  comision: number;
  promotor: PrecioPromotorVerificado | null;
}

/**
 * Compara lo cobrado en cada línea con el precio de catálogo. Una línea más barata que la lista se rechaza; una más cara exige la
 * autorización firmada de un supervisor y un promotor, y su diferencia es la comisión. Los productos que no están en el catálogo se
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
  const items = datos.items.map((item): VentaItem => {
    const lista = precios.get(item.producto_id);
    if (lista === undefined) return item;
    const { precio_lista: _ignorado, ...limpio } = item;
    if (item.precio_unitario < lista - 0.005) {
      throw new ErrorApi(400, `«${item.nombre}» no puede venderse por debajo del precio de lista ($${lista.toFixed(2)}).`, 'precio_bajo_lista');
    }
    if (item.precio_unitario <= lista + 0.005) return limpio;
    desviadas.push([item.producto_id, item.precio_unitario]);
    return { ...limpio, precio_lista: lista };
  });
  if (desviadas.length === 0) return { items, comision: 0, promotor: null };

  const promotor = await verificarPrecioPromotor(env, sesion, datos, desviadas);
  const comision = redondear2(items.reduce((s, i) => s + (i.precio_lista === undefined ? 0 : i.cantidad * (i.precio_unitario - i.precio_lista)), 0));
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
  const comprobante = await validarComprobantePagoMovil(env, datos);
  const precios = await aplicarPrecioPromotor(env, sesion, datos);
  const itemsGuardados = await aplicarSeleccionManual(env, sesion, datos.local_id, precios.items);

  const id = nuevoId();
  const db = env.DB;
  const separado = separarNombre(nombre, datos.cliente_apellido);
  const lote = await db.batch<{ valor: number }>([
    db.prepare("INSERT INTO contadores (nombre, valor) VALUES ('ventas', 1) ON CONFLICT (nombre) DO UPDATE SET valor = valor + 1 RETURNING valor"),
    db
      .prepare(
        `INSERT INTO ventas (id, folio, fecha, local_id, cliente_cedula, cliente_nombre, cliente_telefono, metodo_pago, total, items, pagos, vuelto, tasa_cambio, total_bs, vendedor_id, vendedor_nombre, comprobante_path, referencia_pago_movil,
                             promotor_id, promotor_nombre, comision, precio_autorizado_por, precio_autorizado_nombre)
         VALUES (?, (SELECT valor FROM contadores WHERE nombre = 'ventas'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id, fecha, datos.local_id, cedula, nombre, telefono, datos.metodo_pago, redondear2(datos.total), JSON.stringify(itemsGuardados),
        json(datos.pagos), json(datos.vuelto), datos.tasa_cambio ?? null, datos.total_bs ?? null, sesion.userId, sesion.nombre, comprobante.ruta, comprobante.referencia,
        precios.promotor?.promotor_id ?? null, precios.promotor?.promotor_nombre ?? null, precios.comision,
        precios.promotor?.autorizado_por ?? null, precios.promotor?.autorizado_nombre ?? null
      ),
    // El cliente queda recordado (o se actualizan sus datos) en el MISMO lote: si la venta falla, tampoco se guarda
    db
      .prepare(
        `INSERT INTO clientes (cedula, nombre, apellido, telefono, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (cedula) DO UPDATE SET nombre = excluded.nombre, apellido = excluded.apellido, telefono = excluded.telefono, updated_at = excluded.updated_at`
      )
      .bind(cedula, separado.nombre, separado.apellido, telefono, new Date().toISOString()),
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
  const devoluciones = (await db.prepare('SELECT local_id, items_nuevos FROM devoluciones').all<{ local_id: string; items_nuevos: string }>()).results;

  // Piezas que estas ventas sacaron del stock: las de cada venta y las entregadas a cambio
  const codigos = new Set<string>();
  const juntar = (texto: string) => {
    for (const item of JSON.parse(texto) as { unidades?: string[] }[]) for (const c of item.unidades ?? []) codigos.add(c);
  };
  for (const v of ventas) juntar(v.items);
  for (const d of devoluciones) juntar(d.items_nuevos);

  // De ellas, las que siguen vendidas (las devueltas ya están en el stock)
  const porGrupo = new Map<string, { productoId: string; localId: string; codigos: string[] }>();
  let piezas = 0;
  for (const tramo of tramos([...codigos])) {
    const filas = await db
      .prepare(`SELECT codigo, producto_id, local_id FROM unidades_producto WHERE estado = 'VENDIDA' AND codigo IN (${marcas(tramo.length)})`)
      .bind(...tramo)
      .all<{ codigo: string; producto_id: string; local_id: string }>();
    for (const f of filas.results) {
      const clave = `${f.producto_id}|${f.local_id}`;
      const grupo = porGrupo.get(clave) ?? { productoId: f.producto_id, localId: f.local_id, codigos: [] };
      grupo.codigos.push(f.codigo);
      porGrupo.set(clave, grupo);
      piezas++;
    }
  }

  const resultado: ResultadoReseteo = { ventas: ventas.length, devoluciones: devoluciones.length, piezas, simulado: !!opciones.simular };
  if (opciones.simular || (ventas.length === 0 && devoluciones.length === 0 && piezas === 0)) return resultado;

  // 1. Reponer el stock, por lotes que respetan los topes de movimientos y de piezas
  let lote: EntradaMovimiento[] = [];
  let enLote = 0;
  const enviar = async () => {
    if (lote.length > 0) await registrarMovimientos(env, sesion, lote);
    lote = [];
    enLote = 0;
  };
  for (const grupo of porGrupo.values()) {
    for (let i = 0; i < grupo.codigos.length; i += PIEZAS_POR_TRAMO) {
      const trozo = grupo.codigos.slice(i, i + PIEZAS_POR_TRAMO);
      if (enLote + trozo.length > PIEZAS_POR_TRAMO || lote.length >= MOVIMIENTOS_POR_TRAMO) await enviar();
      lote.push({ productoId: grupo.productoId, tipo: 'ENTRADA', cantidad: trozo.length, localId: grupo.localId, motivo: MOTIVO_RESETEO, unidadCodigos: trozo });
      enLote += trozo.length;
    }
  }
  await enviar();

  // 2. Borrar los registros (las devoluciones primero: apuntan a las ventas) y avisar a las pantallas abiertas
  const locales = new Set([...ventas.map((v) => v.local_id), ...devoluciones.map((d) => d.local_id)]);
  await db.batch([
    db.prepare('DELETE FROM devoluciones'),
    db.prepare('DELETE FROM ventas'),
    ...[...locales].flatMap((localId) => sentenciasCambio(db, ['ventas', 'devoluciones'], localId)),
  ]);
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
    ...locales.flatMap((localId) => sentenciasCambio(db, ['ventas', 'devoluciones', 'movimientos_inventario'], localId)),
  ]);
  return resultado;
}
