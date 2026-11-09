// Movimientos de inventario y unidades con código único. Reemplaza los triggers de Postgres
// aplicar_movimiento_inventario y preparar_unidades_movimiento:
//   · el STOCK lo actualizan los triggers de SQLite (trg_mov_validar_salida / trg_mov_aplicar) al insertar el movimiento;
//   · las UNIDADES se calculan aquí (códigos nuevos, las indicadas, las más antiguas) y se escriben en el MISMO db.batch,
//     donde el trigger trg_unidad_ya_vendida aborta todo el lote si una unidad ya no está disponible (doble venta).
// Una ENTRADA de N crea N unidades; una SALIDA marca VENDIDA las indicadas y completa por orden de llegada; una ENTRADA
// que lista códigos (devolución) reactiva esas unidades y crea el resto.
//
// Los productos "por cantidad" (`control_por_cantidad = 1`, mercancía de $1 a $3 sin etiqueta por pieza) no tienen unidades: sus
// movimientos solo mueven el número de inventario_local (lo hacen los triggers), sin códigos. Solo ellos admiten el tipo BAJA aquí
// (las piezas con código se dan de baja por `traslados.darDeBaja`), y cada BAJA lleva su fila en `mermas` (quién y por qué).
import { alcanceDe, condicionAlcance, esGerencia, localAccesible, type Sesion } from '../authz';
import { sentenciasCambio } from '../cambios';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';
import { ahoraISO, limiteSeguro, nuevoId } from '../util';
import { construirCodigoUnidad } from '../../utils/codigos';
import type { MovimientoInventario, TipoMovimiento, TipoMovimientoManual, UnidadProducto } from '../../types/database.types';

/** Quién y por qué se botaron piezas de un producto por cantidad (se guarda en `mermas`, junto al movimiento BAJA). */
export interface DatosMerma {
  origen: 'VENTA' | 'DESCARGO';
  motivo?: 'DEFECTO_FABRICA' | 'DANADO_AL_COLOCAR' | 'OTRO' | null;
  nota?: string | null;
  autorizadoPor?: string | null;
  autorizadoNombre?: string | null;
}

export interface EntradaMovimiento {
  productoId: string;
  /** BAJA solo para productos por cantidad (con su `merma`) */
  tipo: TipoMovimientoManual | 'BAJA';
  /** Obligatoria en una BAJA */
  merma?: DatosMerma;
  cantidad: number;
  localId: string;
  motivo?: string;
  /** Unidades concretas que se mueven (escaneadas en una venta, o devueltas en una entrada). El resto lo completa el sistema. */
  unidadCodigos?: string[];
}

export interface ResultadoMovimiento {
  movimiento: MovimientoInventario;
  /** TODAS las unidades que movió este movimiento */
  unidadCodigos: string[];
}

export type MovimientoConProducto = MovimientoInventario & {
  producto?: { nombre: string; codigo_barras: string } | null;
  local?: { nombre: string } | null;
};

const MAX_MOVIMIENTOS = 50;
const MAX_UNIDADES = 500;
const TRAMO = 90; // D1 admite 100 parámetros por consulta

const MSG_NO_DISPONIBLE = 'Alguna de las unidades escaneadas ya no está disponible (se vendió, es de otro local o de otro producto).';
const MSG_NO_VENDIDA = 'Alguna de las unidades indicadas no está vendida o no pertenece a este producto.';

export const tramos = <T>(lista: T[]): T[][] => Array.from({ length: Math.ceil(lista.length / TRAMO) }, (_, i) => lista.slice(i * TRAMO, (i + 1) * TRAMO));
export const marcas = (n: number) => Array.from({ length: n }, () => '?').join(', ');

interface FilaUnidad {
  codigo: string;
  estado: 'DISPONIBLE' | 'VENDIDA';
  producto_id: string;
  local_id: string;
}

const stockInsuficiente = (nombre: string, disponible: number, solicitado: number) =>
  new ErrorApi(409, `Stock insuficiente para "${nombre}" en este local: disponible ${disponible}, solicitado ${solicitado}.`, 'stock_insuficiente');

function validarEntradas(entradas: EntradaMovimiento[]): void {
  if (entradas.length === 0) throw new ErrorApi(400, 'No hay movimientos que registrar.', 'datos_invalidos');
  if (entradas.length > MAX_MOVIMIENTOS) throw new ErrorApi(400, `Se pueden registrar hasta ${MAX_MOVIMIENTOS} movimientos por petición.`, 'lote_grande');
  let unidades = 0;
  for (const e of entradas) {
    if (!Number.isInteger(e.cantidad) || e.cantidad <= 0) throw new ErrorApi(400, 'La cantidad debe ser un número entero mayor a 0.', 'datos_invalidos');
    unidades += e.cantidad;
    const codigos = e.unidadCodigos ?? [];
    if (codigos.length > e.cantidad) {
      throw new ErrorApi(400, `Se indicaron ${codigos.length} códigos de unidad para un movimiento de ${e.cantidad} unidades.`, 'datos_invalidos');
    }
    if (new Set(codigos).size !== codigos.length) throw new ErrorApi(400, 'Hay códigos de unidad repetidos en el movimiento.', 'datos_invalidos');
  }
  if (unidades > MAX_UNIDADES) throw new ErrorApi(400, `Son demasiadas unidades para una sola petición (máximo ${MAX_UNIDADES}).`, 'lote_grande');
}

async function validarPermisos(env: Entorno, sesion: Sesion, entradas: EntradaMovimiento[]): Promise<void> {
  if (entradas.some((e) => e.tipo === 'ENTRADA') && !esGerencia(sesion.rol)) {
    throw new ErrorApi(403, 'Tu rol no puede registrar entradas de inventario.', 'sin_permiso');
  }
  if (entradas.some((e) => e.tipo === 'BAJA') && !esGerencia(sesion.rol)) {
    throw new ErrorApi(403, 'Solo el administrador, el gerente o el encargado pueden dar de baja mercancía.', 'sin_permiso');
  }
  for (const localId of new Set(entradas.map((e) => e.localId))) {
    if (!(await localAccesible(env, sesion, localId))) throw new ErrorApi(403, 'No tienes acceso a ese local.', 'sin_permiso');
  }
}

/** Registra uno o varios movimientos en UN lote atómico (todo o nada). Devuelve, por movimiento, TODAS sus unidades. */
export async function registrarMovimientos(env: Entorno, sesion: Sesion, entradas: EntradaMovimiento[]): Promise<ResultadoMovimiento[]> {
  validarEntradas(entradas);
  await validarPermisos(env, sesion, entradas);

  // Con dos ventas simultáneas "por orden de llegada" pueden elegir la misma unidad: la segunda aborta y se vuelve a elegir
  const reintentable = entradas.every((e) => !(e.unidadCodigos?.length));
  for (let intento = 1; ; intento++) {
    try {
      return await aplicar(env, sesion, entradas);
    } catch (err) {
      if (reintentable && intento < 4 && err instanceof ErrorApi && err.codigo === 'unidad_no_disponible') continue;
      throw err;
    }
  }
}

export async function registrarMovimiento(env: Entorno, sesion: Sesion, entrada: EntradaMovimiento): Promise<ResultadoMovimiento> {
  return (await registrarMovimientos(env, sesion, [entrada]))[0];
}

async function aplicar(env: Entorno, sesion: Sesion, entradas: EntradaMovimiento[]): Promise<ResultadoMovimiento[]> {
  const db = env.DB;

  // 1. Productos (existencia y nombre para los mensajes)
  const idsProducto = [...new Set(entradas.map((e) => e.productoId))];
  const nombres = new Map<string, string>();
  const prefijos = new Map<string, string>();
  const porCantidad = new Set<string>();
  for (const tramo of tramos(idsProducto)) {
    const filas = await db
      .prepare(`SELECT id, nombre, prefijo_codigo, control_por_cantidad FROM productos WHERE id IN (${marcas(tramo.length)})`)
      .bind(...tramo)
      .all<{ id: string; nombre: string; prefijo_codigo: string; control_por_cantidad: number }>();
    for (const f of filas.results) {
      nombres.set(f.id, f.nombre);
      prefijos.set(f.id, f.prefijo_codigo);
      if (f.control_por_cantidad === 1) porCantidad.add(f.id);
    }
  }
  if (nombres.size !== idsProducto.length) throw new ErrorApi(404, 'Producto no encontrado.', 'no_existe');
  for (const e of entradas) {
    if (porCantidad.has(e.productoId) && e.unidadCodigos?.length) {
      throw new ErrorApi(400, `"${nombres.get(e.productoId)}" se controla por cantidad: no tiene códigos por pieza.`, 'datos_invalidos');
    }
    if (e.tipo === 'BAJA' && (!porCantidad.has(e.productoId) || !e.merma)) {
      throw new ErrorApi(400, `"${nombres.get(e.productoId)}" lleva código por pieza: se da de baja escaneando su etiqueta (Mercancía → Descargo).`, 'datos_invalidos');
    }
  }

  // 2. Stock actual por (producto, local)
  const stock = new Map<string, number>();
  const clave = (productoId: string, localId: string) => `${productoId}|${localId}`;
  for (const localId of new Set(entradas.map((e) => e.localId))) {
    const delLocal = [...new Set(entradas.filter((e) => e.localId === localId).map((e) => e.productoId))];
    for (const tramo of tramos(delLocal)) {
      const filas = await db
        .prepare(`SELECT producto_id, stock_actual FROM inventario_local WHERE local_id = ? AND producto_id IN (${marcas(tramo.length)})`)
        .bind(localId, ...tramo)
        .all<{ producto_id: string; stock_actual: number }>();
      for (const f of filas.results) stock.set(clave(f.producto_id, localId), f.stock_actual);
    }
  }

  // 3. Estado de las unidades indicadas y cola de disponibles (orden de llegada) de cada (producto, local) con salidas
  const unidades = new Map<string, FilaUnidad>();
  const indicadas = [...new Set(entradas.flatMap((e) => e.unidadCodigos ?? []))];
  for (const tramo of tramos(indicadas)) {
    const filas = await db.prepare(`SELECT codigo, estado, producto_id, local_id FROM unidades_producto WHERE codigo IN (${marcas(tramo.length)})`).bind(...tramo).all<FilaUnidad>();
    for (const f of filas.results) unidades.set(f.codigo, f);
  }
  const colas = new Map<string, string[]>();
  for (const localId of new Set(entradas.filter((e) => e.tipo === 'SALIDA').map((e) => e.localId))) {
    const productos = [...new Set(entradas.filter((e) => e.tipo === 'SALIDA' && e.localId === localId && !porCantidad.has(e.productoId)).map((e) => e.productoId))];
    for (const tramo of tramos(productos)) {
      const filas = await db
        .prepare(`SELECT codigo, estado, producto_id, local_id FROM unidades_producto WHERE local_id = ? AND estado = 'DISPONIBLE' AND producto_id IN (${marcas(tramo.length)}) ORDER BY created_at, rowid`)
        .bind(localId, ...tramo)
        .all<FilaUnidad>();
      for (const f of filas.results) {
        unidades.set(f.codigo, f);
        const k = clave(f.producto_id, localId);
        (colas.get(k) ?? colas.set(k, []).get(k)!).push(f.codigo);
      }
    }
  }

  // 4. Códigos nuevos: cada prefijo (INF, TEC…) lleva su propia cuenta; se reserva un rango por prefijo (cada petición recibe uno propio)
  const nuevasPorPrefijo = new Map<string, number>();
  for (const e of entradas) {
    if (e.tipo !== 'ENTRADA' || porCantidad.has(e.productoId)) continue;
    const nuevas = e.cantidad - (e.unidadCodigos?.length ?? 0);
    if (nuevas > 0) nuevasPorPrefijo.set(prefijos.get(e.productoId)!, (nuevasPorPrefijo.get(prefijos.get(e.productoId)!) ?? 0) + nuevas);
  }
  const siguientePorPrefijo = new Map<string, number>();
  for (const [prefijo, nuevas] of nuevasPorPrefijo) {
    const fila = await db
      .prepare('INSERT INTO contadores (nombre, valor) VALUES (?, ?) ON CONFLICT (nombre) DO UPDATE SET valor = valor + excluded.valor RETURNING valor')
      .bind(`unidad:${prefijo}`, nuevas)
      .first<{ valor: number }>();
    if (fila!.valor > 999_999) {
      throw new ErrorApi(409, `Se agotaron los códigos del prefijo ${prefijo} (999999). Cambia el prefijo del producto para seguir ingresando.`, 'prefijo_agotado');
    }
    siguientePorPrefijo.set(prefijo, fila!.valor - nuevas + 1);
  }

  // 5. Se simula cada movimiento en orden y se arman las sentencias
  const ahora = ahoraISO();
  const sentencias: D1PreparedStatement[] = [];
  const resultados: ResultadoMovimiento[] = [];
  for (const e of entradas) {
    const k = clave(e.productoId, e.localId);
    const nombre = nombres.get(e.productoId)!;
    const indicadasMov = e.unidadCodigos ?? [];
    const codigos: string[] = [];
    const sentenciasUnidades: D1PreparedStatement[] = [];

    if (porCantidad.has(e.productoId)) {
      // Sin unidades: el stock es solo un número por local
      const disponible = stock.get(k) ?? 0;
      if (e.tipo !== 'ENTRADA' && disponible < e.cantidad) throw stockInsuficiente(nombre, disponible, e.cantidad);
      stock.set(k, e.tipo === 'ENTRADA' ? disponible + e.cantidad : disponible - e.cantidad);
    } else if (e.tipo === 'ENTRADA') {
      for (const codigo of indicadasMov) {
        const u = unidades.get(codigo);
        if (!u || u.estado !== 'VENDIDA' || u.producto_id !== e.productoId) throw new ErrorApi(400, MSG_NO_VENDIDA, 'unidad_no_vendida');
        u.estado = 'DISPONIBLE';
        u.local_id = e.localId;
        (colas.get(k) ?? colas.set(k, []).get(k)!).push(codigo);
        codigos.push(codigo);
        sentenciasUnidades.push(db.prepare("UPDATE unidades_producto SET estado = 'DISPONIBLE', local_id = ?, vendida_en = NULL WHERE codigo = ?").bind(e.localId, codigo));
      }
      for (let i = indicadasMov.length; i < e.cantidad; i++) {
        const prefijo = prefijos.get(e.productoId)!;
        const numero = siguientePorPrefijo.get(prefijo)!;
        siguientePorPrefijo.set(prefijo, numero + 1);
        const codigo = construirCodigoUnidad(prefijo, numero);
        unidades.set(codigo, { codigo, estado: 'DISPONIBLE', producto_id: e.productoId, local_id: e.localId });
        (colas.get(k) ?? colas.set(k, []).get(k)!).push(codigo);
        codigos.push(codigo);
        sentenciasUnidades.push(
          db.prepare("INSERT INTO unidades_producto (id, producto_id, local_id, codigo, estado, created_at) VALUES (?, ?, ?, ?, 'DISPONIBLE', ?)").bind(nuevoId(), e.productoId, e.localId, codigo, ahora)
        );
      }
      stock.set(k, (stock.get(k) ?? 0) + e.cantidad);
    } else if (e.tipo === 'SALIDA') {
      const disponible = stock.get(k) ?? 0;
      if (disponible < e.cantidad) throw stockInsuficiente(nombre, disponible, e.cantidad);
      for (const codigo of indicadasMov) {
        const u = unidades.get(codigo);
        if (!u || u.estado !== 'DISPONIBLE' || u.producto_id !== e.productoId || u.local_id !== e.localId) {
          throw new ErrorApi(409, MSG_NO_DISPONIBLE, 'unidad_no_disponible');
        }
        u.estado = 'VENDIDA';
        codigos.push(codigo);
      }
      const cola = colas.get(k) ?? [];
      while (codigos.length < e.cantidad) {
        const codigo = cola.shift();
        if (codigo === undefined) throw stockInsuficiente(nombre, disponible, e.cantidad); // hay menos unidades que stock: no debería pasar
        const u = unidades.get(codigo)!;
        if (u.estado !== 'DISPONIBLE') continue;
        u.estado = 'VENDIDA';
        codigos.push(codigo);
      }
      for (const codigo of codigos) {
        // Sin filtro por estado a propósito: si otra venta ya se llevó la unidad, el trigger aborta TODO el lote
        sentenciasUnidades.push(db.prepare("UPDATE unidades_producto SET estado = 'VENDIDA', vendida_en = ? WHERE codigo = ?").bind(ahora, codigo));
      }
      stock.set(k, disponible - e.cantidad);
    } else {
      throw new ErrorApi(400, 'Tipo de movimiento no válido para este producto.', 'datos_invalidos');
    }

    const movimiento: MovimientoInventario = {
      id: nuevoId(),
      producto_id: e.productoId,
      tipo: e.tipo,
      cantidad: e.cantidad,
      fecha: ahora,
      motivo: e.motivo ?? null,
      local_id: e.localId,
      unidad_codigos: codigos,
    };
    sentencias.push(
      db
        .prepare('INSERT INTO movimientos_inventario (id, producto_id, tipo, cantidad, fecha, motivo, local_id, unidad_codigos) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(movimiento.id, movimiento.producto_id, movimiento.tipo, movimiento.cantidad, movimiento.fecha, movimiento.motivo, movimiento.local_id, JSON.stringify(codigos)),
      ...sentenciasUnidades
    );
    if (e.tipo === 'BAJA' && e.merma) {
      const m = e.merma;
      sentencias.push(
        db
          .prepare(
            'INSERT INTO mermas (id, movimiento_id, producto_id, local_id, cantidad, origen, motivo, nota, por_id, por_nombre, autorizado_por, autorizado_nombre, fecha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          )
          .bind(nuevoId(), movimiento.id, e.productoId, e.localId, e.cantidad, m.origen, m.motivo ?? null, m.nota ?? null, sesion.userId, sesion.nombre, m.autorizadoPor ?? null, m.autorizadoNombre ?? null, ahora)
      );
    }
    resultados.push({ movimiento, unidadCodigos: codigos });
  }

  const tablasCambio = entradas.some((e) => e.tipo === 'BAJA') ? ['movimientos_inventario', 'inventario_local', 'unidades_producto', 'mermas'] : ['movimientos_inventario', 'inventario_local', 'unidades_producto'];
  for (const localId of new Set(entradas.map((e) => e.localId))) {
    sentencias.push(...sentenciasCambio(db, tablasCambio, localId));
  }
  sentencias.push(...sentenciasCambio(db, ['productos'], null));

  try {
    await db.batch(sentencias);
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : '';
    if (/ya no está disponible/.test(mensaje)) throw new ErrorApi(409, MSG_NO_DISPONIBLE, 'unidad_no_disponible');
    if (/no está vendida o no pertenece/.test(mensaje)) throw new ErrorApi(400, MSG_NO_VENDIDA, 'unidad_no_vendida');
    if (/Stock insuficiente/.test(mensaje)) {
      const unico = entradas.length === 1 ? nombres.get(entradas[0].productoId) : null;
      throw new ErrorApi(409, unico ? `Stock insuficiente para "${unico}" en este local.` : 'Stock insuficiente en este local.', 'stock_insuficiente');
    }
    throw err;
  }
  return resultados;
}

// --- Lectura ----------------------------------------------------------------------------------------------------------
export async function listarMovimientos(env: Entorno, sesion: Sesion, limite = 100, localId?: string): Promise<MovimientoConProducto[]> {
  const alcance = await alcanceDe(env, sesion, localId);
  const { sql, valores } = condicionAlcance(alcance, 'm.local_id');
  const filas = await env.DB
    .prepare(
      `SELECT m.id, m.producto_id, m.tipo, m.cantidad, m.fecha, m.motivo, m.local_id, m.unidad_codigos,
              p.nombre AS producto_nombre, p.codigo_barras AS producto_codigo, l.nombre AS local_nombre
       FROM movimientos_inventario m
       LEFT JOIN productos p ON p.id = m.producto_id
       LEFT JOIN locales l ON l.id = m.local_id
       WHERE ${sql}
       ORDER BY m.fecha DESC, m.rowid DESC
       LIMIT ?`
    )
    .bind(...valores, limiteSeguro(limite, 100, 2000))
    .all<Record<string, unknown>>();
  return filas.results.map((f) => ({
    id: f.id as string,
    producto_id: f.producto_id as string,
    tipo: f.tipo as TipoMovimiento,
    cantidad: f.cantidad as number,
    fecha: f.fecha as string,
    motivo: (f.motivo as string | null) ?? null,
    local_id: f.local_id as string,
    unidad_codigos: f.unidad_codigos ? (JSON.parse(f.unidad_codigos as string) as string[]) : null,
    producto: f.producto_nombre ? { nombre: f.producto_nombre as string, codigo_barras: f.producto_codigo as string } : null,
    local: f.local_nombre ? { nombre: f.local_nombre as string } : null,
  }));
}

export async function listarUnidades(
  env: Entorno,
  sesion: Sesion,
  filtro: { productoId?: string; estado?: UnidadProducto['estado']; sinImprimir?: boolean; codigos?: string[]; localId?: string } = {}
): Promise<UnidadProducto[]> {
  const alcance = await alcanceDe(env, sesion, filtro.localId);
  const { sql, valores } = condicionAlcance(alcance, 'local_id');
  const condiciones = [sql];
  const params: unknown[] = [...valores];
  if (filtro.productoId) {
    condiciones.push('producto_id = ?');
    params.push(filtro.productoId);
  }
  if (filtro.estado) {
    condiciones.push('estado = ?');
    params.push(filtro.estado);
  }
  if (filtro.sinImprimir) condiciones.push('impresa_en IS NULL');
  if (filtro.codigos) {
    if (filtro.codigos.length === 0) return [];
    if (filtro.codigos.length > TRAMO) throw new ErrorApi(400, `Se pueden consultar hasta ${TRAMO} códigos por petición.`, 'lote_grande');
    condiciones.push(`codigo IN (${marcas(filtro.codigos.length)})`);
    params.push(...filtro.codigos);
  }
  const filas = await env.DB
    .prepare(`SELECT * FROM unidades_producto WHERE ${condiciones.join(' AND ')} ORDER BY created_at, rowid LIMIT 5000`)
    .bind(...params)
    .all<UnidadProducto>();
  return filas.results;
}

/** La unidad con ese código, solo si pertenece a un local al que el usuario accede. */
export async function obtenerUnidadPorCodigo(env: Entorno, sesion: Sesion, codigo: string): Promise<UnidadProducto | null> {
  const alcance = await alcanceDe(env, sesion);
  const { sql, valores } = condicionAlcance(alcance, 'local_id');
  return env.DB.prepare(`SELECT * FROM unidades_producto WHERE codigo = ? AND ${sql}`).bind(codigo, ...valores).first<UnidadProducto>();
}

/**
 * Anota que ya se imprimieron las etiquetas de esas unidades (administrador, gerente y encargado; solo sus locales).
 * Con `reimpresion` no cambia la primera impresión: suma una reimpresión y la fecha, y solo a unidades DISPONIBLES (una vendida ya
 * no está en el local: su etiqueta no se pega en otra pieza).
 */
export async function marcarUnidadesImpresas(env: Entorno, sesion: Sesion, codigos: string[], opciones: { reimpresion?: boolean } = {}): Promise<number> {
  if (!esGerencia(sesion.rol)) throw new ErrorApi(403, 'Solo administrador, gerente o encargado pueden imprimir etiquetas.', 'sin_permiso');
  const alcance = await alcanceDe(env, sesion);
  const { sql, valores } = condicionAlcance(alcance, 'local_id');
  const ahora = ahoraISO();
  let marcadas = 0;
  for (const tramo of tramos([...new Set(codigos)])) {
    const r = await env.DB
      .prepare(
        opciones.reimpresion
          ? `UPDATE unidades_producto SET reimpresiones = reimpresiones + 1, ultima_reimpresion = ? WHERE codigo IN (${marcas(tramo.length)}) AND estado = 'DISPONIBLE' AND ${sql}`
          : `UPDATE unidades_producto SET impresa_en = ? WHERE codigo IN (${marcas(tramo.length)}) AND ${sql}`
      )
      .bind(ahora, ...tramo, ...valores)
      .run();
    marcadas += r.meta.changes ?? 0;
  }
  return marcadas;
}
