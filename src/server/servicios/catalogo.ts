// Catálogo compartido (productos, modelos, compatibilidades), alta de productos por local y lista de locales.
// Reglas portadas de las políticas RLS 0023 y 0025:
//   · leer el catálogo: cualquier rol con acceso (catalogo_accesible: no el contador)
//   · crear/editar productos y compatibilidades: administrador, gerente y encargado; eliminar productos y editar
//     modelos y el importador en lote: solo administrador y gerente
//   · inventario por local: administrador y gerente (cualquier local accesible) y el encargado (el suyo), y solo el
//     MÍNIMO y el alta: el stock cambia únicamente por movimientos (trigger de la base de datos)
import { alcanceDe, esAdministrador, esGerencia, esGlobal, localAccesible, type Sesion } from '../authz';
import { avisarCambio, sentenciasCambio } from '../cambios';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';
import { listarConInventario, listarStockBajo as repoStockBajo, obtenerPorCodigo, obtenerPorId, type ProductoConInventario } from '../repos/productos';
import { cargarLocales } from '../repos/locales';
import { ahoraISO, nuevoId, redondear2 } from '../util';
import { normalizarNombre } from '../../utils/altaRapida';
import { construirReferencia, esPrefijoValido, generarCodigosInternos, sugerirPrefijo } from '../../utils/codigos';
import { errorPrecioPorCantidad } from '../../utils/controlPorCantidad';
import { errorPrecioBs, esMonedaPrecio, normalizarPrecioBs, usdDesdeBs, type MonedaPrecio } from '../../utils/precioBs';
import { tasaVigente } from './tasas';
import type { Local, ModeloTelefono, Producto, ProductoStockBajo } from '../../types/database.types';

export type { ProductoConInventario } from '../repos/productos';

const sinPermiso = (mensaje = 'Tu rol no tiene permiso para hacer esto.') => new ErrorApi(403, mensaje, 'sin_permiso');
const LIMITE_LOTE = 100;
const LIMITE_INVENTARIO = 200;

function exigirGerencia(sesion: Sesion): void {
  if (!esGerencia(sesion.rol)) throw sinPermiso();
}
function exigirGlobal(sesion: Sesion): void {
  if (!esGlobal(sesion.rol)) throw sinPermiso();
}

export interface DatosProducto {
  codigo_barras: string;
  nombre: string;
  categoria: string;
  precio_compra?: number;
  precio_venta?: number;
  /** 'BS' = el precio se fija en bolívares (`precio_bs`) y no sigue a la tasa; `precio_venta` se calcula con la tasa de hoy. Por defecto 'USD'. */
  moneda_precio?: MonedaPrecio;
  precio_bs?: number | null;
  stock_minimo?: number;
  imagen_url?: string | null;
  /** Prefijo del código de sus unidades (2 a 4 letras). Si no se indica se sugiere por la marca del nombre o la categoría. */
  prefijo_codigo?: string;
  /** 1 = producto por cantidad (sin código ni etiqueta por pieza; solo si cuesta menos de $3). Se fija al crearlo; cambiarlo después exige stock 0. */
  control_por_cantidad?: number;
}

/** Pasa a mayúsculas el prefijo indicado y comprueba que sean 2 a 4 letras A-Z. */
function prefijoIndicado(valor: string): string {
  const prefijo = valor.trim().toUpperCase();
  if (!esPrefijoValido(prefijo)) throw new ErrorApi(400, 'El prefijo del código debe tener de 2 a 4 letras (A-Z), por ejemplo INF.', 'datos_invalidos');
  return prefijo;
}

async function marcasConocidas(env: Entorno): Promise<string[]> {
  const filas = await env.DB.prepare('SELECT DISTINCT marca FROM modelos_telefono').all<{ marca: string }>();
  return filas.results.map((f) => f.marca);
}

/**
 * Reserva las referencias de varios productos nuevos (una por prefijo de la lista, en ese orden) con el contador
 * `producto:<PREFIJO>`. Se reserva ANTES de insertar: si el insert falla queda un hueco en la numeración, nunca un repetido.
 */
async function reservarReferencias(env: Entorno, prefijos: string[]): Promise<string[]> {
  const cuantos = new Map<string, number>();
  for (const p of prefijos) cuantos.set(p, (cuantos.get(p) ?? 0) + 1);
  const siguiente = new Map<string, number>();
  for (const [prefijo, n] of cuantos) {
    const fila = await env.DB
      .prepare('INSERT INTO contadores (nombre, valor) VALUES (?, ?) ON CONFLICT (nombre) DO UPDATE SET valor = valor + excluded.valor RETURNING valor')
      .bind(`producto:${prefijo}`, n)
      .first<{ valor: number }>();
    siguiente.set(prefijo, fila!.valor - n + 1);
  }
  return prefijos.map((p) => {
    const numero = siguiente.get(p)!;
    siguiente.set(p, numero + 1);
    return construirReferencia(p, numero);
  });
}

function validarProducto(d: Partial<DatosProducto>, completo: boolean): void {
  const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  if ((completo || d.codigo_barras !== undefined) && !texto(d.codigo_barras)) throw new ErrorApi(400, 'El código de barras es obligatorio.', 'datos_invalidos');
  if ((completo || d.nombre !== undefined) && !texto(d.nombre)) throw new ErrorApi(400, 'El nombre es obligatorio.', 'datos_invalidos');
  if ((completo || d.categoria !== undefined) && !texto(d.categoria)) throw new ErrorApi(400, 'La categoría es obligatoria.', 'datos_invalidos');
  for (const campo of ['precio_compra', 'precio_venta'] as const) {
    const valor = d[campo];
    if (valor !== undefined && !(Number.isFinite(valor) && valor >= 0)) throw new ErrorApi(400, 'Los precios deben ser números mayores o iguales a 0.', 'datos_invalidos');
  }
  if (d.stock_minimo !== undefined && !(Number.isInteger(d.stock_minimo) && d.stock_minimo >= 0)) {
    throw new ErrorApi(400, 'El stock mínimo debe ser un número entero mayor o igual a 0.', 'datos_invalidos');
  }
  if (d.moneda_precio !== undefined && !esMonedaPrecio(d.moneda_precio)) throw new ErrorApi(400, 'La moneda del precio debe ser USD o BS.', 'datos_invalidos');
  if (d.moneda_precio === 'BS' || (d.moneda_precio === undefined && d.precio_bs != null)) {
    const mensaje = errorPrecioBs(d.precio_bs ?? Number.NaN);
    if (mensaje) throw new ErrorApi(400, mensaje, 'precio_bs_invalido');
  }
  if (d.prefijo_codigo !== undefined) prefijoIndicado(d.prefijo_codigo);
  if (d.control_por_cantidad !== undefined && d.control_por_cantidad !== 0 && d.control_por_cantidad !== 1) {
    throw new ErrorApi(400, 'El control por cantidad debe ser 0 o 1.', 'datos_invalidos');
  }
  // (el tope de $3 de los productos por cantidad se comprueba con el precio en dólares ya resuelto: ver `resolverPrecio`)
}

/** Los tres valores de precio que se guardan de un producto. */
interface PrecioResuelto {
  precio_venta: number;
  moneda_precio: MonedaPrecio;
  precio_bs: number | null;
}

const SIN_TASA = 'Para fijar un precio en bolívares primero hay que registrar la tasa del dólar del día (chip «$1 = Bs.» arriba).';

/**
 * Decide el precio que se guarda: en dólares (como siempre) o fijo en bolívares, en cuyo caso el equivalente en dólares sale de la tasa
 * vigente (409 si todavía no hay ninguna). Con `control_por_cantidad` el equivalente debe ser menor a $3.
 */
async function resolverPrecio(env: Entorno, d: Pick<DatosProducto, 'moneda_precio' | 'precio_bs' | 'precio_venta' | 'control_por_cantidad'>): Promise<PrecioResuelto> {
  let precio: PrecioResuelto;
  if (d.moneda_precio === 'BS') {
    const tasa = await tasaVigente(env);
    if (!tasa) throw new ErrorApi(409, SIN_TASA, 'sin_tasa');
    const bs = normalizarPrecioBs(d.precio_bs!);
    precio = { precio_venta: usdDesdeBs(bs, tasa), moneda_precio: 'BS', precio_bs: bs };
  } else {
    precio = { precio_venta: redondear2(d.precio_venta ?? 0), moneda_precio: 'USD', precio_bs: null };
  }
  if (d.control_por_cantidad === 1) {
    const mensaje = errorPrecioPorCantidad(precio.precio_venta);
    if (mensaje) throw new ErrorApi(400, mensaje, 'precio_no_permitido');
  }
  return precio;
}

const duplicado = (codigo: string) => new ErrorApi(409, `Ya existe un producto con el código de barras ${codigo}.`, 'codigo_repetido');
const esViolacionUnica = (err: unknown) => err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
const esViolacionForanea = (err: unknown) => err instanceof Error && /FOREIGN KEY constraint failed/i.test(err.message);

/**
 * Un producto no se repite por nombre: si ya existe uno igual (sin importar mayúsculas, acentos ni espacios de más) se rechaza con 409
 * y se dice cuál es, para sumarle unidades con «+ Stock» en vez de crear otro ítem. También rechaza nombres repetidos dentro de la
 * misma petición. `excluirId` es el producto que se está renombrando (no choca consigo mismo). Se compara en JS porque SQLite no
 * quita acentos; el catálogo es de unos miles de filas y crear productos es poco frecuente.
 */
async function exigirNombresLibres(env: Entorno, nombres: string[], excluirId?: string): Promise<void> {
  const dentro = new Set<string>();
  for (const nombre of nombres) {
    const clave = normalizarNombre(nombre);
    if (dentro.has(clave)) throw new ErrorApi(400, `El nombre «${nombre.trim()}» está repetido en la lista.`, 'nombre_repetido');
    dentro.add(clave);
  }
  const filas = await env.DB.prepare('SELECT id, nombre, referencia FROM productos').all<{ id: string; nombre: string; referencia: string | null }>();
  const porNombre = new Map<string, { id: string; nombre: string; referencia: string | null }>();
  for (const f of filas.results) {
    const clave = normalizarNombre(f.nombre);
    if (!porNombre.has(clave) || f.id === excluirId) porNombre.set(clave, f);
  }
  for (const nombre of nombres) {
    const existente = porNombre.get(normalizarNombre(nombre));
    if (existente && existente.id !== excluirId) {
      throw new ErrorApi(
        409,
        `Ya existe un producto con ese nombre: «${existente.nombre}»${existente.referencia ? ` (${existente.referencia})` : ''}. Para agregarle unidades usa «+ Stock» (Ingreso de mercancía); si es otro producto, cámbiale el nombre.`,
        'nombre_repetido'
      );
    }
  }
}

// --- Lectura ------------------------------------------------------------------------------------------------
export async function listarProductos(env: Entorno, sesion: Sesion): Promise<ProductoConInventario[]> {
  return listarConInventario(env, await alcanceDe(env, sesion));
}

export async function obtenerProductoPorCodigo(env: Entorno, sesion: Sesion, codigo: string): Promise<ProductoConInventario | null> {
  return obtenerPorCodigo(env, await alcanceDe(env, sesion), codigo);
}

export async function obtenerProductoPorId(env: Entorno, sesion: Sesion, id: string): Promise<ProductoConInventario | null> {
  return obtenerPorId(env, await alcanceDe(env, sesion), id);
}

export async function listarStockBajo(env: Entorno, sesion: Sesion, localId?: string): Promise<ProductoStockBajo[]> {
  return repoStockBajo(env, await alcanceDe(env, sesion, localId));
}

// --- Productos -------------------------------------------------------------------------------------------------
export async function crearProducto(env: Entorno, sesion: Sesion, datos: DatosProducto): Promise<Producto> {
  exigirGerencia(sesion);
  await alcanceDe(env, sesion);
  validarProducto(datos, true);
  await exigirNombresLibres(env, [datos.nombre]);

  const precio = await resolverPrecio(env, datos);
  const fila = {
    id: nuevoId(),
    codigo_barras: datos.codigo_barras.trim(),
    nombre: datos.nombre.trim(),
    categoria: datos.categoria.trim(),
    // El encargado no ve ni fija el precio de compra
    precio_compra: sesion.rol === 'encargado' ? 0 : redondear2(datos.precio_compra ?? 0),
    ...precio,
    stock_minimo: datos.stock_minimo ?? 5,
    imagen_url: datos.imagen_url ?? null,
    prefijo_codigo: datos.prefijo_codigo !== undefined ? prefijoIndicado(datos.prefijo_codigo) : sugerirPrefijo(datos.nombre.trim(), datos.categoria.trim(), await marcasConocidas(env)),
    referencia: '',
    control_por_cantidad: datos.control_por_cantidad === 1 ? 1 : 0,
    created_at: ahoraISO(),
  };
  fila.referencia = (await reservarReferencias(env, [fila.prefijo_codigo]))[0];
  try {
    await env.DB
      .prepare('INSERT INTO productos (id, codigo_barras, nombre, categoria, precio_compra, precio_venta, moneda_precio, precio_bs, stock_minimo, imagen_url, prefijo_codigo, referencia, control_por_cantidad, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(fila.id, fila.codigo_barras, fila.nombre, fila.categoria, fila.precio_compra, fila.precio_venta, fila.moneda_precio, fila.precio_bs, fila.stock_minimo, fila.imagen_url, fila.prefijo_codigo, fila.referencia, fila.control_por_cantidad, fila.created_at)
      .run();
  } catch (err) {
    if (esViolacionUnica(err)) throw duplicado(fila.codigo_barras);
    throw err;
  }
  await avisarCambio(env.DB, ['productos']);
  return { ...fila, stock_actual: 0 };
}

export async function actualizarProducto(env: Entorno, sesion: Sesion, id: string, cambios: Partial<DatosProducto>): Promise<Producto> {
  exigirGerencia(sesion);
  await alcanceDe(env, sesion);
  validarProducto(cambios, false);

  const actual = await env.DB.prepare('SELECT * FROM productos WHERE id = ?').bind(id).first<Producto>();
  if (!actual) throw new ErrorApi(404, 'Producto no encontrado.', 'no_existe');
  // Solo si de verdad cambia el nombre: los productos que ya estaban repetidos se pueden seguir editando sin tocarlo
  if (cambios.nombre !== undefined && normalizarNombre(cambios.nombre) !== normalizarNombre(actual.nombre)) {
    await exigirNombresLibres(env, [cambios.nombre], id);
  }

  // Pasar de "con código por pieza" a "por cantidad" (o al revés) cambia cómo se cuenta el stock: solo administrador/gerente y solo con
  // el stock en 0 (y nada en tránsito); si no, quedarían piezas con código sin dueño o stock sin piezas.
  const cambiaControl = cambios.control_por_cantidad !== undefined && cambios.control_por_cantidad !== (actual.control_por_cantidad ? 1 : 0);
  if (cambiaControl) {
    exigirGlobal(sesion);
    const hay = await env.DB
      .prepare(
        `SELECT (SELECT COALESCE(SUM(stock_actual), 0) FROM inventario_local WHERE producto_id = ?) AS stock,
                (SELECT count(*) FROM unidades_producto WHERE producto_id = ? AND estado IN ('DISPONIBLE', 'EN_TRANSITO')) AS piezas`
      )
      .bind(id, id)
      .first<{ stock: number; piezas: number }>();
    if (hay && (hay.stock > 0 || hay.piezas > 0)) {
      throw new ErrorApi(409, 'Para cambiar entre "por cantidad" y "con etiqueta por pieza" el producto debe tener el stock en 0 en todos los locales (y nada en tránsito). Retíralo con una baja o crea otro producto.', 'control_con_stock');
    }
    if (cambios.control_por_cantidad === 1) {
      const mensaje = errorPrecioPorCantidad(cambios.precio_venta ?? actual.precio_venta);
      if (mensaje) throw new ErrorApi(400, mensaje, 'precio_no_permitido');
    }
  }

  // Precio: en dólares o fijo en bolívares. Un producto con precio en Bs no cambia de moneda por un `precio_venta` suelto (lo mandaría una
  // pantalla vieja o el importador CSV): ese valor se ignora y hay que pedir el cambio con `moneda_precio`.
  const tocaMoneda = cambios.moneda_precio !== undefined || cambios.precio_bs !== undefined;
  const precioActualEnBs = actual.moneda_precio === 'BS';
  let precioNuevo: PrecioResuelto | null = null;
  if (tocaMoneda) {
    const moneda: MonedaPrecio = cambios.moneda_precio ?? (precioActualEnBs ? 'BS' : 'USD');
    precioNuevo = await resolverPrecio(env, {
      moneda_precio: moneda,
      precio_bs: cambios.precio_bs ?? actual.precio_bs ?? undefined,
      precio_venta: cambios.precio_venta ?? actual.precio_venta,
      control_por_cantidad: 0,
    });
  } else if (precioActualEnBs) {
    delete cambios.precio_venta;
  }

  // Solo estos campos se editan: el stock no (cambia por movimientos) y el encargado no toca el precio de compra
  const permitidos: (keyof DatosProducto)[] = ['codigo_barras', 'nombre', 'categoria', 'precio_venta', 'stock_minimo', 'imagen_url', 'prefijo_codigo'];
  if (cambiaControl) permitidos.push('control_por_cantidad');
  if (sesion.rol !== 'encargado') permitidos.push('precio_compra');
  const columnas: string[] = [];
  const valores: unknown[] = [];
  if (precioNuevo) {
    columnas.push('precio_venta = ?', 'moneda_precio = ?', 'precio_bs = ?');
    valores.push(precioNuevo.precio_venta, precioNuevo.moneda_precio, precioNuevo.precio_bs);
  }
  for (const campo of permitidos) {
    if (cambios[campo] === undefined) continue;
    if (precioNuevo && campo === 'precio_venta') continue;
    const valor = cambios[campo];
    columnas.push(`${campo} = ?`);
    valores.push(campo === 'prefijo_codigo' ? prefijoIndicado(String(valor)) : typeof valor === 'string' ? valor.trim() : typeof valor === 'number' && campo.startsWith('precio') ? redondear2(valor) : valor);
  }
  if (columnas.length > 0) {
    try {
      await env.DB.prepare(`UPDATE productos SET ${columnas.join(', ')} WHERE id = ?`).bind(...valores, id).run();
    } catch (err) {
      if (esViolacionUnica(err)) throw duplicado(String(cambios.codigo_barras));
      throw err;
    }
    await avisarCambio(env.DB, ['productos']);
  }
  return (await env.DB.prepare('SELECT * FROM productos WHERE id = ?').bind(id).first<Producto>())!;
}

const MOTIVO_CON_HISTORIAL = 'Ya tiene ventas, traslados, bajas u otros movimientos: borrarlo haría desaparecer ese historial. Retira su stock con una baja (Mercancía → Descargo).';

/**
 * Ids (de los pedidos) de productos que NO se pueden borrar porque dejarían historial perdido: los que tuvieron cualquier
 * movimiento que no sea una ENTRADA (ventas, traslados, bajas, devoluciones…) o tienen piezas que ya no están disponibles.
 * Un producto que solo tuvo ingresos (el caso de un ingreso equivocado) sí se puede borrar completo.
 */
async function conHistorial(env: Entorno, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const marcas = ids.map(() => '?').join(', ');
  const filas = await env.DB
    .prepare(
      `SELECT producto_id FROM movimientos_inventario WHERE tipo <> 'ENTRADA' AND producto_id IN (${marcas})
       UNION SELECT producto_id FROM unidades_producto WHERE estado <> 'DISPONIBLE' AND producto_id IN (${marcas})`
    )
    .bind(...ids, ...ids)
    .all<{ producto_id: string }>();
  return new Set(filas.results.map((f) => f.producto_id));
}

/** Borra un producto ingresado por error, con sus unidades, movimientos y stock (solo administrador y gerente; 409 si ya tiene historial). */
export async function eliminarProducto(env: Entorno, sesion: Sesion, id: string): Promise<void> {
  exigirGlobal(sesion);
  await alcanceDe(env, sesion);
  const existe = await env.DB.prepare('SELECT 1 AS ok FROM productos WHERE id = ?').bind(id).first();
  if (!existe) throw new ErrorApi(404, 'Producto no encontrado.', 'no_existe');
  if ((await conHistorial(env, [id])).has(id)) throw new ErrorApi(409, MOTIVO_CON_HISTORIAL, 'producto_con_historial');
  await env.DB.prepare('DELETE FROM productos WHERE id = ?').bind(id).run();
  await avisarCambio(env.DB, ['productos', 'inventario_local', 'compatibilidades', 'unidades_producto']);
}

/**
 * Borra varios productos de una vez (hasta 100): los que se pueden y avisa cuáles no, con el motivo, sin tocar esos.
 * Los ids que no existen se ignoran (otro dispositivo pudo borrarlos antes).
 */
export async function eliminarProductosLote(
  env: Entorno,
  sesion: Sesion,
  ids: string[]
): Promise<{ eliminados: string[]; bloqueados: { id: string; nombre: string; motivo: string }[] }> {
  exigirGlobal(sesion);
  await alcanceDe(env, sesion);
  if (ids.length > LIMITE_LOTE) throw new ErrorApi(400, `Se pueden eliminar hasta ${LIMITE_LOTE} productos por petición.`, 'lote_grande');
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return { eliminados: [], bloqueados: [] };

  const filas = await env.DB
    .prepare(`SELECT id, nombre FROM productos WHERE id IN (${unicos.map(() => '?').join(', ')})`)
    .bind(...unicos)
    .all<{ id: string; nombre: string }>();
  const bloqueadosIds = await conHistorial(env, filas.results.map((f) => f.id));
  const borrables = filas.results.filter((f) => !bloqueadosIds.has(f.id));
  if (borrables.length > 0) {
    await env.DB.batch(borrables.map((f) => env.DB.prepare('DELETE FROM productos WHERE id = ?').bind(f.id)));
    await avisarCambio(env.DB, ['productos', 'inventario_local', 'compatibilidades', 'unidades_producto']);
  }
  return {
    eliminados: borrables.map((f) => f.id),
    bloqueados: filas.results.filter((f) => bloqueadosIds.has(f.id)).map((f) => ({ id: f.id, nombre: f.nombre, motivo: MOTIVO_CON_HISTORIAL })),
  };
}

/** Máximo de productos que cambian de precio en una sola petición de «Cambiar precios en lote». */
const LIMITE_PRECIOS_LOTE = 3000;
/** Ids por sentencia UPDATE (D1 admite ~100 parámetros por sentencia; 3 son del precio). */
const IDS_POR_SENTENCIA = 90;

export interface CambioPreciosLote {
  ids: string[];
  moneda: MonedaPrecio;
  /** Dólares si `moneda` es USD; bolívares si es BS. */
  precio: number;
}

/**
 * Pone el MISMO precio a muchos productos de una vez (administrador, gerente y encargado; el catálogo es compartido): por ejemplo todos los vidrios a Bs 1100 cuando el
 * cliente cambia el precio de la semana. En bolívares el precio queda fijo (no sigue a la tasa) y el equivalente en dólares sale de la
 * tasa de hoy; en dólares se quita el precio fijo en Bs. Todo o nada, en un solo lote. Los ids desconocidos se ignoran.
 */
export async function cambiarPreciosLote(env: Entorno, sesion: Sesion, datos: CambioPreciosLote): Promise<{ actualizados: number; precio_venta: number }> {
  exigirGerencia(sesion);
  await alcanceDe(env, sesion);
  if (!esMonedaPrecio(datos.moneda)) throw new ErrorApi(400, 'La moneda del precio debe ser USD o BS.', 'datos_invalidos');
  const unicos = [...new Set(datos.ids)];
  if (unicos.length === 0) throw new ErrorApi(400, 'Elige al menos un producto.', 'datos_invalidos');
  if (unicos.length > LIMITE_PRECIOS_LOTE) throw new ErrorApi(400, `Se pueden cambiar hasta ${LIMITE_PRECIOS_LOTE} productos por vez.`, 'lote_grande');

  let precioVenta: number;
  let precioBs: number | null;
  if (datos.moneda === 'BS') {
    const mensaje = errorPrecioBs(datos.precio);
    if (mensaje) throw new ErrorApi(400, mensaje, 'precio_bs_invalido');
    const tasa = await tasaVigente(env);
    if (!tasa) throw new ErrorApi(409, SIN_TASA, 'sin_tasa');
    precioBs = normalizarPrecioBs(datos.precio);
    precioVenta = usdDesdeBs(precioBs, tasa);
  } else {
    if (!Number.isFinite(datos.precio) || datos.precio < 0) throw new ErrorApi(400, 'El precio debe ser un número mayor o igual a 0.', 'datos_invalidos');
    precioVenta = redondear2(datos.precio);
    precioBs = null;
  }

  // Un producto por cantidad no puede costar $3 o más: si alguno de los elegidos lo es, no se cambia nada
  if (errorPrecioPorCantidad(precioVenta)) {
    for (let i = 0; i < unicos.length; i += IDS_POR_SENTENCIA) {
      const trozo = unicos.slice(i, i + IDS_POR_SENTENCIA);
      const fila = await env.DB
        .prepare(`SELECT nombre FROM productos WHERE control_por_cantidad = 1 AND id IN (${trozo.map(() => '?').join(', ')}) LIMIT 1`)
        .bind(...trozo)
        .first<{ nombre: string }>();
      if (fila) {
        throw new ErrorApi(409, `«${fila.nombre}» se controla por cantidad y solo puede costar menos de $3 (este precio equivale a $${precioVenta}). No se cambió ningún precio.`, 'precio_no_permitido');
      }
    }
  }

  const sentencias: D1PreparedStatement[] = [];
  for (let i = 0; i < unicos.length; i += IDS_POR_SENTENCIA) {
    const trozo = unicos.slice(i, i + IDS_POR_SENTENCIA);
    sentencias.push(
      env.DB
        .prepare(`UPDATE productos SET precio_venta = ?, moneda_precio = ?, precio_bs = ? WHERE id IN (${trozo.map(() => '?').join(', ')})`)
        .bind(precioVenta, datos.moneda, precioBs, ...trozo)
    );
  }
  const resultados = await env.DB.batch([...sentencias, ...sentenciasCambio(env.DB, ['productos'], null)]);
  const actualizados = resultados.slice(0, sentencias.length).reduce((suma, r) => suma + (r.meta.changes ?? 0), 0);
  return { actualizados, precio_venta: precioVenta };
}

/** Importador CSV: crea productos nuevos (solo administrador y gerente). Hasta 100 por petición; todo o nada. */
export async function crearProductosLote(env: Entorno, sesion: Sesion, filas: DatosProducto[]): Promise<{ id: string; codigo_barras: string }[]> {
  exigirGlobal(sesion);
  await alcanceDe(env, sesion);
  if (filas.length > LIMITE_LOTE) throw new ErrorApi(400, `Se pueden crear hasta ${LIMITE_LOTE} productos por petición.`, 'lote_grande');
  filas.forEach((f) => validarProducto(f, true));
  if (filas.length === 0) return [];
  await exigirNombresLibres(env, filas.map((f) => f.nombre));

  const codigos = filas.map((f) => f.codigo_barras.trim());
  if (new Set(codigos).size !== codigos.length) throw new ErrorApi(400, 'Hay códigos de barras repetidos en el lote.', 'codigo_repetido');
  if (codigos.length > 0) {
    const existente = await env.DB
      .prepare(`SELECT codigo_barras FROM productos WHERE codigo_barras IN (${codigos.map(() => '?').join(', ')}) LIMIT 1`)
      .bind(...codigos)
      .first<{ codigo_barras: string }>();
    if (existente) throw duplicado(existente.codigo_barras);
  }

  return insertarProductosNuevos(env, sesion, filas);
}

/** Inserta productos nuevos en UN lote atómico (referencia y prefijo incluidos). Quien llama ya validó permisos, datos y códigos repetidos. */
async function insertarProductosNuevos(env: Entorno, sesion: Sesion, filas: DatosProducto[]): Promise<{ id: string; codigo_barras: string; nombre: string; referencia: string; prefijo_codigo: string }[]> {
  const marcas = await marcasConocidas(env);
  const prefijos = filas.map((f) => (f.prefijo_codigo !== undefined ? prefijoIndicado(f.prefijo_codigo) : sugerirPrefijo(f.nombre.trim(), f.categoria.trim(), marcas)));
  const referencias = await reservarReferencias(env, prefijos);
  const creados = filas.map((f, i) => ({
    id: nuevoId(),
    codigo_barras: f.codigo_barras.trim(),
    prefijo: prefijos[i],
    referencia: referencias[i],
    f,
  }));
  const ahora = ahoraISO();
  const precios = await Promise.all(filas.map((f) => resolverPrecio(env, f)));
  try {
    await env.DB.batch(
      creados.map(({ id, codigo_barras, prefijo, referencia, f }, i) =>
        env.DB
          .prepare('INSERT INTO productos (id, codigo_barras, nombre, categoria, precio_compra, precio_venta, moneda_precio, precio_bs, stock_minimo, imagen_url, prefijo_codigo, referencia, control_por_cantidad, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          // El encargado no ve ni fija el precio de compra
          .bind(id, codigo_barras, f.nombre.trim(), f.categoria.trim(), sesion.rol === 'encargado' ? 0 : redondear2(f.precio_compra ?? 0), precios[i].precio_venta, precios[i].moneda_precio, precios[i].precio_bs, f.stock_minimo ?? 5, f.imagen_url ?? null, prefijo, referencia, f.control_por_cantidad === 1 ? 1 : 0, ahora)
      )
    );
  } catch (err) {
    if (esViolacionUnica(err)) throw new ErrorApi(409, 'Alguno de los códigos de barras ya existe.', 'codigo_repetido');
    throw err;
  }
  await avisarCambio(env.DB, ['productos']);
  return creados.map(({ id, codigo_barras, prefijo, referencia, f }) => ({ id, codigo_barras, nombre: f.nombre.trim(), referencia, prefijo_codigo: prefijo }));
}

export interface FilaAltaRapida {
  nombre: string;
  categoria: string;
  precio_venta: number;
  moneda_precio?: MonedaPrecio;
  precio_bs?: number | null;
  /** Solo lo toman administrador y gerente; para el encargado se guarda 0 */
  precio_compra?: number;
  /** Si no se indica se sugiere por la marca del nombre o la categoría */
  prefijo_codigo?: string;
  /** 1 = por cantidad (sin etiqueta por pieza; solo si cuesta menos de $3) */
  control_por_cantidad?: number;
}

const MAX_NOMBRE_ALTA = 120;

/**
 * Alta rápida: crea hasta 100 productos de una vez a partir de lo mínimo (nombre, categoría, precio). El código de barras interno
 * se genera aquí (a continuación del mayor existente) y el stock mínimo queda en 0 (sin alertas); el stock llega después por el
 * ingreso. Lo puede usar quien crea productos (administrador, gerente y encargado). Todo o nada.
 */
export async function crearProductosRapidos(env: Entorno, sesion: Sesion, filas: FilaAltaRapida[]) {
  exigirGerencia(sesion);
  await alcanceDe(env, sesion);
  if (filas.length === 0) return [];
  if (filas.length > LIMITE_LOTE) throw new ErrorApi(400, `Se pueden crear hasta ${LIMITE_LOTE} productos por petición.`, 'lote_grande');
  for (const f of filas) {
    if (f.nombre.trim().length > MAX_NOMBRE_ALTA) throw new ErrorApi(400, `El nombre "${f.nombre.trim().slice(0, 30)}…" es demasiado largo (máximo ${MAX_NOMBRE_ALTA} letras).`, 'datos_invalidos');
  }
  await exigirNombresLibres(env, filas.map((f) => f.nombre));

  // Dos personas dando de alta a la vez pueden elegir el mismo código interno: la segunda se reintenta con los siguientes
  for (let intento = 1; ; intento++) {
    const existentes = await env.DB.prepare("SELECT codigo_barras FROM productos WHERE length(codigo_barras) = 13 AND codigo_barras LIKE '20%'").all<{ codigo_barras: string }>();
    const codigos = generarCodigosInternos(existentes.results.map((f) => f.codigo_barras), filas.length);
    const completas: DatosProducto[] = filas.map((f, i) => ({
      codigo_barras: codigos[i],
      nombre: f.nombre,
      categoria: f.categoria,
      precio_venta: f.precio_venta,
      moneda_precio: f.moneda_precio,
      precio_bs: f.precio_bs,
      precio_compra: f.precio_compra,
      stock_minimo: 0,
      prefijo_codigo: f.prefijo_codigo?.trim() ? f.prefijo_codigo : undefined,
      control_por_cantidad: f.control_por_cantidad === 1 ? 1 : 0,
    }));
    completas.forEach((f) => validarProducto(f, true));
    try {
      return await insertarProductosNuevos(env, sesion, completas);
    } catch (err) {
      if (err instanceof ErrorApi && err.codigo === 'codigo_repetido' && intento < 3) continue;
      throw err;
    }
  }
}

// --- Compatibilidades ----------------------------------------------------------------------------------------------
export async function establecerCompatibilidades(env: Entorno, sesion: Sesion, productoId: string, modeloIds: string[]): Promise<void> {
  exigirGerencia(sesion);
  await alcanceDe(env, sesion);
  if (modeloIds.length > 500) throw new ErrorApi(400, 'Demasiados modelos en una sola petición.', 'lote_grande');
  try {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM compatibilidades WHERE producto_id = ?').bind(productoId),
      ...[...new Set(modeloIds)].map((modeloId) =>
        env.DB.prepare('INSERT INTO compatibilidades (id, producto_id, modelo_id) VALUES (?, ?, ?)').bind(nuevoId(), productoId, modeloId)
      ),
    ]);
  } catch (err) {
    if (esViolacionForanea(err)) throw new ErrorApi(400, 'El producto o alguno de los modelos no existe.', 'datos_invalidos');
    throw err;
  }
  await avisarCambio(env.DB, ['compatibilidades']);
}

export async function reemplazarCompatibilidadesLote(
  env: Entorno,
  sesion: Sesion,
  pares: { producto_id: string; modelo_id: string }[],
  productoIds: string[]
): Promise<void> {
  exigirGlobal(sesion);
  await alcanceDe(env, sesion);
  if (productoIds.length > LIMITE_LOTE || pares.length > 500) throw new ErrorApi(400, 'El lote de compatibilidades es demasiado grande.', 'lote_grande');
  if (productoIds.length === 0 && pares.length === 0) return; // D1 rechaza un lote sin sentencias
  try {
    await env.DB.batch([
      ...(productoIds.length > 0
        ? [env.DB.prepare(`DELETE FROM compatibilidades WHERE producto_id IN (${productoIds.map(() => '?').join(', ')})`).bind(...productoIds)]
        : []),
      ...pares.map((p) => env.DB.prepare('INSERT OR IGNORE INTO compatibilidades (id, producto_id, modelo_id) VALUES (?, ?, ?)').bind(nuevoId(), p.producto_id, p.modelo_id)),
    ]);
  } catch (err) {
    if (esViolacionForanea(err)) throw new ErrorApi(400, 'Algún producto o modelo no existe.', 'datos_invalidos');
    throw err;
  }
  await avisarCambio(env.DB, ['compatibilidades']);
}

// --- Inventario por local (alta y mínimo; el stock NUNCA se escribe aquí) ----------------------------------------------------
async function exigirInventarioLocal(env: Entorno, sesion: Sesion, localId: string): Promise<void> {
  exigirGerencia(sesion);
  if (!(await localAccesible(env, sesion, localId))) throw sinPermiso('No tienes acceso a ese local.');
}

/** Da de alta productos en un local (stock 0, sin mínimo); los que ya estaban no se tocan. */
export async function asegurarEnLocal(env: Entorno, sesion: Sesion, localId: string, productoIds: string[]): Promise<void> {
  await exigirInventarioLocal(env, sesion, localId);
  if (productoIds.length > LIMITE_INVENTARIO) throw new ErrorApi(400, `Se pueden dar de alta hasta ${LIMITE_INVENTARIO} productos por petición.`, 'lote_grande');
  if (productoIds.length === 0) return;
  try {
    await env.DB.batch(
      productoIds.map((id) =>
        env.DB.prepare('INSERT INTO inventario_local (local_id, producto_id, stock_actual, stock_minimo) VALUES (?, ?, 0, 0) ON CONFLICT (local_id, producto_id) DO NOTHING').bind(localId, id)
      )
    );
  } catch (err) {
    if (esViolacionForanea(err)) throw new ErrorApi(400, 'Alguno de los productos no existe.', 'datos_invalidos');
    throw err;
  }
  await avisarCambio(env.DB, ['inventario_local'], localId);
}

/** Fija el stock mínimo de varios productos en un local (alta con stock 0 si aún no lo manejaba). */
export async function fijarMinimosLote(
  env: Entorno,
  sesion: Sesion,
  localId: string,
  filas: { producto_id: string; stock_minimo: number }[]
): Promise<void> {
  await exigirInventarioLocal(env, sesion, localId);
  if (filas.length > LIMITE_INVENTARIO) throw new ErrorApi(400, `Se pueden fijar hasta ${LIMITE_INVENTARIO} mínimos por petición.`, 'lote_grande');
  if (filas.some((f) => !(Number.isInteger(f.stock_minimo) && f.stock_minimo >= 0))) {
    throw new ErrorApi(400, 'El stock mínimo debe ser un número entero mayor o igual a 0.', 'datos_invalidos');
  }
  if (filas.length === 0) return;
  try {
    await env.DB.batch(
      filas.map((f) =>
        env.DB
          .prepare('INSERT INTO inventario_local (local_id, producto_id, stock_actual, stock_minimo) VALUES (?, ?, 0, ?) ON CONFLICT (local_id, producto_id) DO UPDATE SET stock_minimo = excluded.stock_minimo')
          .bind(localId, f.producto_id, f.stock_minimo)
      )
    );
  } catch (err) {
    if (esViolacionForanea(err)) throw new ErrorApi(400, 'Alguno de los productos no existe.', 'datos_invalidos');
    throw err;
  }
  await avisarCambio(env.DB, ['inventario_local'], localId);
}

// --- Modelos de teléfono ------------------------------------------------------------------------------------------------
export async function listarModelos(env: Entorno, sesion: Sesion): Promise<ModeloTelefono[]> {
  await alcanceDe(env, sesion);
  const filas = await env.DB.prepare('SELECT id, marca, modelo FROM modelos_telefono ORDER BY marca, modelo').all<ModeloTelefono>();
  return filas.results;
}

export async function crearModelo(env: Entorno, sesion: Sesion, datos: { marca: string; modelo: string }): Promise<ModeloTelefono> {
  exigirGlobal(sesion);
  await alcanceDe(env, sesion);
  const marca = datos.marca.trim();
  const modelo = datos.modelo.trim();
  if (!marca || !modelo) throw new ErrorApi(400, 'Escribe la marca y el modelo.', 'datos_invalidos');
  const fila: ModeloTelefono = { id: nuevoId(), marca, modelo, created_at: ahoraISO() };
  try {
    await env.DB.prepare('INSERT INTO modelos_telefono (id, marca, modelo, created_at) VALUES (?, ?, ?, ?)').bind(fila.id, marca, modelo, fila.created_at).run();
  } catch (err) {
    if (esViolacionUnica(err)) throw new ErrorApi(409, `El modelo ${marca} ${modelo} ya existe.`, 'modelo_repetido');
    throw err;
  }
  await avisarCambio(env.DB, ['modelos_telefono']);
  return fila;
}

export async function eliminarModelo(env: Entorno, sesion: Sesion, id: string): Promise<void> {
  exigirGlobal(sesion);
  await alcanceDe(env, sesion);
  await env.DB.prepare('DELETE FROM modelos_telefono WHERE id = ?').bind(id).run();
  await avisarCambio(env.DB, ['modelos_telefono', 'compatibilidades']);
}

// --- Locales -----------------------------------------------------------------------------------------------------------------
/** Administrador, gerente y contador ven todos los locales; el resto, solo el suyo. */
export async function listarLocalesVisibles(env: Entorno, sesion: Sesion): Promise<Local[]> {
  const locales = await cargarLocales(env);
  if (esAdministrador(sesion.rol) || esGlobal(sesion.rol) || sesion.rol === 'contador') return locales;
  return locales.filter((l) => l.id === sesion.localId);
}
