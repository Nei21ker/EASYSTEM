// Servicio de datos único para toda la app: decide en tiempo de ejecución si
// habla con Supabase o con LocalStorage, según haya o no credenciales en .env
// (supabaseConfigurado, ver src/lib/supabase.ts). Los componentes/páginas solo
// deberían importar este archivo, nunca src/lib/db/*.ts directamente, para no
// acoplarse al backend elegido.
//
// El fallback de LocalStorage solo puede ejecutarse en el navegador: usa este
// módulo desde un <script> de cliente (ver src/pages/ventas.astro), no desde
// el frontmatter de Astro (que corre en el servidor).
//
// Resiliencia offline (solo aplica cuando supabaseConfigurado es true): las
// lecturas de productos/modelos se cachean en LocalStorage en cada consulta
// exitosa; si una llamada falla por falta de red, se sirve esa caché en su
// lugar. Las ventas hechas sin conexión se encolan (easystem:cola-sync) y se
// reintentan automáticamente al reconectar, o manualmente con
// sincronizarPendientes(). Ver ConnectionStatus.astro para el indicador de UI.
import { supabaseConfigurado } from './supabase';
import * as productosDb from './db/productos';
import * as modelosDb from './db/modelos';
import * as movimientosDb from './db/movimientos';
import * as ventasDb from './db/ventas';
import * as tasasDb from './db/tasas';
import type { MovimientoConProducto } from './db/movimientos';
import { productosMock, modelosMock, movimientosMock } from './mock-data';
import { convertirABs, esStockBajo, fechaLocalISO } from '../utils/format';
import { blobADataUrl } from '../utils/imagenes';
import { esMetodoBolivares, METODOS_PAGO } from '../utils/pagos';
import type { FilaImportacion } from './importador';
import type {
  ClienteVenta,
  Compatibilidad,
  MetodoPago,
  ModeloTelefono,
  MovimientoInventario,
  Producto,
  ProductoConRelaciones,
  NuevaTasa,
  NuevaVenta,
  ProductoStockBajo,
  TasaCambio,
  TipoMovimiento,
  Venta,
  VentaItem,
} from '../types/database.types';

// ----------------------------------------------------------------------------
// LocalStorage: esquema y persistencia (modo sin Supabase configurado)
// ----------------------------------------------------------------------------
const LS_KEY = 'easystem:db:v1';

interface LocalDB {
  productos: Producto[];
  modelos: ModeloTelefono[];
  compatibilidades: Compatibilidad[];
  movimientos: MovimientoInventario[];
  /** Opcional: los navegadores con datos anteriores a las ventas con cliente no lo traen */
  ventas?: Venta[];
  /** Historial de la tasa del dólar (opcional por la misma razón que ventas) */
  tasas?: TasaCambio[];
}

function generarId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`;
}

function construirSeedInicial(): LocalDB {
  const productos: Producto[] = productosMock.map(({ modelos_compatibles, ...producto }) => producto);
  const compatibilidades: Compatibilidad[] = productosMock.flatMap((p) =>
    p.modelos_compatibles.map((modelo) => ({ id: generarId(), producto_id: p.id, modelo_id: modelo.id }))
  );
  const movimientos: MovimientoInventario[] = movimientosMock.map(({ producto, ...movimiento }) => movimiento);

  return { productos, modelos: modelosMock, compatibilidades, movimientos };
}

function leerDB(): LocalDB {
  if (typeof window === 'undefined') {
    // Node 22+ expone un `localStorage` global propio (respaldado en disco),
    // que no tiene relación con el navegador del usuario. Lo evitamos a
    // propósito: el fallback de LocalStorage es solo para el cliente.
    throw new Error(
      '[EASYSTEM] El fallback de LocalStorage solo puede usarse en el navegador. Llama a inventoryService desde un <script> de cliente, no desde el frontmatter de Astro.'
    );
  }

  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const db = JSON.parse(raw) as LocalDB;
      // El catálogo de modelos crece con las versiones: se completan los que
      // falten sin tocar productos ni movimientos existentes.
      const existentes = new Set(db.modelos.map((m) => `${m.marca}|${m.modelo}`));
      const faltantes = modelosMock.filter((m) => !existentes.has(`${m.marca}|${m.modelo}`));
      if (faltantes.length > 0) {
        db.modelos.push(...faltantes);
        guardarDB(db);
      }
      return db;
    }
  } catch (err) {
    console.error('[EASYSTEM] No se pudo leer LocalStorage; se reinicia con datos de ejemplo.', err);
  }
  const inicial = construirSeedInicial();
  guardarDB(inicial);
  return inicial;
}

function guardarDB(db: LocalDB) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(db));
  } catch (err) {
    console.error('[EASYSTEM] No se pudo escribir en LocalStorage.', err);
  }
}

function normalizarProductoLocal(producto: Producto, db: LocalDB): ProductoConRelaciones {
  const modeloIds = db.compatibilidades.filter((c) => c.producto_id === producto.id).map((c) => c.modelo_id);
  const modelos_compatibles = db.modelos.filter((m) => modeloIds.includes(m.id));
  return { ...producto, modelos_compatibles };
}

/** Reinicia LocalStorage a los datos de ejemplo (útil para demos o pruebas). */
export function reiniciarDatosLocales() {
  guardarDB(construirSeedInicial());
}

// ----------------------------------------------------------------------------
// Resiliencia offline (modo Supabase configurado)
// ----------------------------------------------------------------------------
const LS_CACHE_PRODUCTOS = 'easystem:cache:productos';
const LS_CACHE_MODELOS = 'easystem:cache:modelos';
const LS_CACHE_MOVIMIENTOS = 'easystem:cache:movimientos';
const LS_COLA_SYNC = 'easystem:cola-sync';
const LS_COLA_VENTAS = 'easystem:cola-ventas';
const LS_CACHE_TASA = 'easystem:cache:tasa';
const LS_COLA_TASAS = 'easystem:cola-tasas';
const EVENTO_CONEXION = 'easystem:conexion-cambio';

interface MovimientoPendiente {
  id: string;
  producto_id: string;
  tipo: TipoMovimiento;
  cantidad: number;
  motivo?: string;
  encolado_en: string;
}

function leerCache<T>(clave: string): T | null {
  try {
    const raw = localStorage.getItem(clave);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function guardarCache(clave: string, valor: unknown) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch (err) {
    console.error('[EASYSTEM] No se pudo actualizar la caché offline.', clave, err);
  }
}

function leerColaSync(): MovimientoPendiente[] {
  return leerCache<MovimientoPendiente[]>(LS_COLA_SYNC) ?? [];
}

function guardarColaSync(cola: MovimientoPendiente[]) {
  guardarCache(LS_COLA_SYNC, cola);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_CONEXION));
}

/** Registros de venta (cliente + tipo de cobro) que no se pudieron guardar por falta de red. */
function leerColaVentas(): NuevaVenta[] {
  return leerCache<NuevaVenta[]>(LS_COLA_VENTAS) ?? [];
}

function guardarColaVentas(cola: NuevaVenta[]) {
  guardarCache(LS_COLA_VENTAS, cola);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_CONEXION));
}

/** Tasas del dólar registradas sin conexión, pendientes de enviarse. */
function leerColaTasas(): TasaCambio[] {
  return leerCache<TasaCambio[]>(LS_COLA_TASAS) ?? [];
}

function guardarColaTasas(cola: TasaCambio[]) {
  guardarCache(LS_COLA_TASAS, cola);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_CONEXION));
}

/** Heurística: ¿el error parece ser de conectividad (y no una regla de negocio real)? */
function esErrorDeRed(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const mensaje = err instanceof Error ? err.message : String(err);
  return /fetch|network|conexión|conexion|timeout|NetworkError/i.test(mensaje);
}

/** Ajusta el stock en caché restando/sumando los movimientos aún no sincronizados. */
function aplicarPendientesAProductos(productos: ProductoConRelaciones[]): ProductoConRelaciones[] {
  const pendientes = leerColaSync();
  if (pendientes.length === 0) return productos;

  const ajustePorProducto: Record<string, number> = {};
  for (const p of pendientes) {
    ajustePorProducto[p.producto_id] = (ajustePorProducto[p.producto_id] ?? 0) + (p.tipo === 'ENTRADA' ? p.cantidad : -p.cantidad);
  }

  return productos.map((p) => (ajustePorProducto[p.id] ? { ...p, stock_actual: p.stock_actual + ajustePorProducto[p.id] } : p));
}

function encolarMovimientoPendiente(input: {
  producto_id: string;
  tipo: TipoMovimiento;
  cantidad: number;
  motivo?: string;
}): MovimientoInventario {
  const pendiente: MovimientoPendiente = { id: `pendiente-${generarId()}`, encolado_en: new Date().toISOString(), ...input };
  const cola = leerColaSync();
  cola.push(pendiente);
  guardarColaSync(cola);

  return {
    id: pendiente.id,
    producto_id: pendiente.producto_id,
    tipo: pendiente.tipo,
    cantidad: pendiente.cantidad,
    motivo: pendiente.motivo ?? null,
    fecha: pendiente.encolado_en,
  };
}

/** Reintenta enviar a Supabase los movimientos y registros de venta encolados mientras no había conexión. */
export async function sincronizarPendientes(): Promise<{ sincronizados: number; pendientes: number }> {
  if (!supabaseConfigurado) return { sincronizados: 0, pendientes: 0 };

  const cola = leerColaSync();
  const colaVentas = leerColaVentas();
  const colaTasas = leerColaTasas();
  if (cola.length === 0 && colaVentas.length === 0 && colaTasas.length === 0) return { sincronizados: 0, pendientes: 0 };

  let sincronizados = 0;
  const restantes: MovimientoPendiente[] = [];

  for (const pendiente of cola) {
    try {
      await movimientosDb.registrarMovimiento({
        producto_id: pendiente.producto_id,
        tipo: pendiente.tipo,
        cantidad: pendiente.cantidad,
        motivo: pendiente.motivo,
      });
      sincronizados++;
    } catch (err) {
      if (esErrorDeRed(err)) {
        restantes.push(pendiente); // seguimos sin red: reintentar en la próxima pasada
      } else {
        console.error('[EASYSTEM] Un movimiento pendiente fue rechazado al sincronizar y se descartó:', pendiente, err);
      }
    }
  }
  guardarColaSync(restantes);

  const tasasRestantes: TasaCambio[] = [];
  for (const pendiente of colaTasas) {
    try {
      await tasasDb.insertarTasa({ fecha: pendiente.fecha, tasa: pendiente.tasa, registrado_nombre: pendiente.registrado_nombre });
      sincronizados++;
    } catch (err) {
      if (esErrorDeRed(err)) {
        tasasRestantes.push(pendiente);
      } else {
        console.error('[EASYSTEM] Una tasa de cambio pendiente fue rechazada al sincronizar y se descartó:', pendiente, err);
      }
    }
  }
  guardarColaTasas(tasasRestantes);

  const ventasRestantes: NuevaVenta[] = [];
  for (const venta of colaVentas) {
    try {
      await ventasDb.insertarVenta(venta);
      sincronizados++;
    } catch (err) {
      if (esErrorDeRed(err)) {
        ventasRestantes.push(venta);
      } else {
        console.error('[EASYSTEM] Un registro de venta pendiente fue rechazado al sincronizar y se descartó:', venta, err);
      }
    }
  }
  guardarColaVentas(ventasRestantes);

  return { sincronizados, pendientes: restantes.length + ventasRestantes.length + tasasRestantes.length };
}

export interface EstadoConexion {
  online: boolean;
  pendientes: number;
  usaSupabase: boolean;
}

export function obtenerEstadoConexion(): EstadoConexion {
  return {
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    pendientes: supabaseConfigurado ? leerColaSync().length + leerColaVentas().length + leerColaTasas().length : 0,
    usaSupabase: supabaseConfigurado,
  };
}

/** Notifica cambios de conectividad/cola y dispara auto-sync al reconectar. Devuelve función para desuscribirse. */
export function suscribirseAEstadoConexion(callback: (estado: EstadoConexion) => void): () => void {
  const notificar = () => callback(obtenerEstadoConexion());
  const alReconectar = async () => {
    await sincronizarPendientes();
    notificar();
  };

  window.addEventListener('online', notificar);
  window.addEventListener('online', alReconectar);
  window.addEventListener('offline', notificar);
  window.addEventListener(EVENTO_CONEXION, notificar);
  notificar();

  return () => {
    window.removeEventListener('online', notificar);
    window.removeEventListener('online', alReconectar);
    window.removeEventListener('offline', notificar);
    window.removeEventListener(EVENTO_CONEXION, notificar);
  };
}

// ----------------------------------------------------------------------------
// Productos
// ----------------------------------------------------------------------------
export async function listarProductos(): Promise<ProductoConRelaciones[]> {
  if (!supabaseConfigurado) {
    const db = leerDB();
    return db.productos.map((p) => normalizarProductoLocal(p, db)).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  try {
    const productos = await productosDb.listarProductos();
    guardarCache(LS_CACHE_PRODUCTOS, productos);
    return aplicarPendientesAProductos(productos);
  } catch (err) {
    if (!esErrorDeRed(err)) throw err;
    console.warn('[EASYSTEM] Sin conexión con Supabase; usando el catálogo guardado localmente.', err);
    return aplicarPendientesAProductos(leerCache<ProductoConRelaciones[]>(LS_CACHE_PRODUCTOS) ?? []);
  }
}

export async function obtenerProductoPorCodigoBarras(codigoBarras: string): Promise<ProductoConRelaciones | null> {
  if (!supabaseConfigurado) {
    const db = leerDB();
    const producto = db.productos.find((p) => p.codigo_barras === codigoBarras);
    return producto ? normalizarProductoLocal(producto, db) : null;
  }

  try {
    return await productosDb.obtenerProductoPorCodigoBarras(codigoBarras);
  } catch (err) {
    if (!esErrorDeRed(err)) throw err;
    const cache = aplicarPendientesAProductos(leerCache<ProductoConRelaciones[]>(LS_CACHE_PRODUCTOS) ?? []);
    return cache.find((p) => p.codigo_barras === codigoBarras) ?? null;
  }
}

export async function listarProductosStockBajo(): Promise<ProductoStockBajo[]> {
  if (!supabaseConfigurado) {
    const db = leerDB();
    return db.productos
      .filter(esStockBajo)
      .sort((a, b) => a.stock_actual - b.stock_actual)
      .map(({ id, codigo_barras, nombre, categoria, stock_actual, stock_minimo }) => ({
        id,
        codigo_barras,
        nombre,
        categoria,
        stock_actual,
        stock_minimo,
      }));
  }

  try {
    return await productosDb.listarProductosStockBajo();
  } catch (err) {
    if (!esErrorDeRed(err)) throw err;
    // Sin conexión: lo derivamos del catálogo en caché en vez de fallar.
    const productos = await listarProductos();
    return productos
      .filter(esStockBajo)
      .sort((a, b) => a.stock_actual - b.stock_actual)
      .map(({ id, codigo_barras, nombre, categoria, stock_actual, stock_minimo }) => ({
        id,
        codigo_barras,
        nombre,
        categoria,
        stock_actual,
        stock_minimo,
      }));
  }
}

export async function crearProducto(
  input: Partial<Producto> & Pick<Producto, 'codigo_barras' | 'nombre' | 'categoria'>
): Promise<Producto> {
  if (supabaseConfigurado) return productosDb.crearProducto(input);

  const db = leerDB();
  if (db.productos.some((p) => p.codigo_barras === input.codigo_barras)) {
    throw new Error(`Ya existe un producto con el código de barras ${input.codigo_barras}.`);
  }

  const producto: Producto = {
    id: generarId(),
    precio_compra: 0,
    precio_venta: 0,
    stock_actual: 0,
    stock_minimo: 5,
    created_at: new Date().toISOString(),
    ...input,
  };
  db.productos.push(producto);
  guardarDB(db);
  return producto;
}

export async function actualizarProducto(id: string, cambiosCrudos: Partial<Producto>): Promise<Producto> {
  // El stock solo cambia mediante movimientos (kardex); nunca por edición directa.
  const { stock_actual: _ignorado, id: _id, created_at: _creado, ...cambios } = cambiosCrudos;
  if (supabaseConfigurado) return productosDb.actualizarProducto(id, cambios);

  const db = leerDB();
  const producto = db.productos.find((p) => p.id === id);
  if (!producto) throw new Error('Producto no encontrado.');
  Object.assign(producto, cambios);
  guardarDB(db);
  return producto;
}

/** Como guardarDB, pero avisa si no cabe (las fotos en base64 pueden llenar el cupo del navegador). */
function guardarDBEstricto(db: LocalDB) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(db));
  } catch {
    throw new Error(
      'No hay espacio en el navegador para más fotos. Conecta Supabase (almacenamiento sin ese límite) o quita fotos que no uses.'
    );
  }
}

/**
 * Guarda la foto de un producto. Con Supabase va al Storage (bucket "productos",
 * migración 0009) y se guarda la URL; en modo LocalStorage se guarda como data
 * URL dentro del propio producto. Devuelve la URL/data URL resultante.
 */
export async function guardarImagenProducto(productoId: string, imagen: Blob): Promise<string> {
  if (supabaseConfigurado) {
    const anterior = (await productosDb.obtenerProducto(productoId))?.imagen_url;
    const url = await productosDb.subirImagenProducto(productoId, imagen);
    await productosDb.actualizarProducto(productoId, { imagen_url: url });
    productosDb.eliminarImagenProducto(anterior).catch(() => {}); // limpieza best-effort
    return url;
  }

  const db = leerDB();
  const producto = db.productos.find((p) => p.id === productoId);
  if (!producto) throw new Error('Producto no encontrado.');
  const anterior = producto.imagen_url;
  producto.imagen_url = await blobADataUrl(imagen);
  try {
    guardarDBEstricto(db);
  } catch (err) {
    producto.imagen_url = anterior;
    throw err;
  }
  return producto.imagen_url;
}

export async function quitarImagenProducto(productoId: string): Promise<void> {
  if (supabaseConfigurado) {
    const anterior = (await productosDb.obtenerProducto(productoId))?.imagen_url;
    await productosDb.actualizarProducto(productoId, { imagen_url: null });
    productosDb.eliminarImagenProducto(anterior).catch(() => {});
    return;
  }

  const db = leerDB();
  const producto = db.productos.find((p) => p.id === productoId);
  if (!producto) throw new Error('Producto no encontrado.');
  producto.imagen_url = null;
  guardarDB(db);
}

export async function eliminarProducto(id: string): Promise<void> {
  if (supabaseConfigurado) return productosDb.eliminarProducto(id);

  const db = leerDB();
  db.productos = db.productos.filter((p) => p.id !== id);
  db.compatibilidades = db.compatibilidades.filter((c) => c.producto_id !== id);
  db.movimientos = db.movimientos.filter((m) => m.producto_id !== id);
  guardarDB(db);
}

export async function establecerCompatibilidades(productoId: string, modeloIds: string[]): Promise<void> {
  if (supabaseConfigurado) return productosDb.establecerCompatibilidades(productoId, modeloIds);

  const db = leerDB();
  db.compatibilidades = db.compatibilidades.filter((c) => c.producto_id !== productoId);
  db.compatibilidades.push(...modeloIds.map((modelo_id) => ({ id: generarId(), producto_id: productoId, modelo_id })));
  guardarDB(db);
}

// ----------------------------------------------------------------------------
// Modelos de teléfono
// ----------------------------------------------------------------------------
/** Orden por marca y luego por modelo con números "naturales": iPhone 9 < iPhone 11 < iPhone 15. */
function compararModelos(a: ModeloTelefono, b: ModeloTelefono): number {
  return a.marca.localeCompare(b.marca, 'es') || a.modelo.localeCompare(b.modelo, 'es', { numeric: true });
}

export async function listarModelos(): Promise<ModeloTelefono[]> {
  if (!supabaseConfigurado) {
    return leerDB().modelos.slice().sort(compararModelos);
  }

  try {
    const modelos = await modelosDb.listarModelos();
    guardarCache(LS_CACHE_MODELOS, modelos);
    return modelos.slice().sort(compararModelos);
  } catch (err) {
    if (!esErrorDeRed(err)) throw err;
    console.warn('[EASYSTEM] Sin conexión con Supabase; usando modelos guardados localmente.', err);
    return (leerCache<ModeloTelefono[]>(LS_CACHE_MODELOS) ?? []).sort(compararModelos);
  }
}

export async function crearModelo(input: Pick<ModeloTelefono, 'marca' | 'modelo'>): Promise<ModeloTelefono> {
  if (supabaseConfigurado) return modelosDb.crearModelo(input);

  const db = leerDB();
  if (db.modelos.some((m) => m.marca === input.marca && m.modelo === input.modelo)) {
    throw new Error(`${input.marca} ${input.modelo} ya está en el catálogo.`);
  }
  const modelo: ModeloTelefono = { id: generarId(), created_at: new Date().toISOString(), ...input };
  db.modelos.push(modelo);
  guardarDB(db);
  return modelo;
}

// ----------------------------------------------------------------------------
// Tasa del dólar (Bs por $)
// ----------------------------------------------------------------------------

/** Última tasa conocida en este navegador (sin red), para pintar Bs. enseguida al cargar una página. */
export function leerTasaCacheada(): TasaCambio | null {
  if (typeof window === 'undefined') return null;
  return leerCache<TasaCambio>(LS_CACHE_TASA);
}

export interface EstadoTasa {
  /** La tasa registrada HOY (null = todavía hay que pedirla) */
  hoy: TasaCambio | null;
  /** La última registrada, de cualquier día (para sugerirla/confirmarla) */
  ultima: TasaCambio | null;
}

function estadoDeTasa(ultima: TasaCambio | null): EstadoTasa {
  return { ultima, hoy: ultima && ultima.fecha === fechaLocalISO() ? ultima : null };
}

export async function obtenerTasaVigente(): Promise<EstadoTasa> {
  let ultima: TasaCambio | null;

  if (!supabaseConfigurado) {
    const tasas = leerDB().tasas ?? [];
    ultima = tasas.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  } else {
    try {
      ultima = await tasasDb.obtenerUltimaTasa();
    } catch (err) {
      if (!esErrorDeRed(err)) throw err;
      console.warn('[EASYSTEM] Sin conexión con Supabase; usando la última tasa guardada localmente.', err);
      ultima = leerTasaCacheada();
    }
    // Una tasa registrada sin conexión es más reciente que cualquier otra del servidor
    const pendientes = leerColaTasas();
    if (pendientes.length > 0) ultima = pendientes[pendientes.length - 1];
  }

  if (ultima) guardarCache(LS_CACHE_TASA, ultima);
  return estadoDeTasa(ultima);
}

/** Registra la tasa de hoy (nueva fila del historial). Sin conexión se guarda local y se envía al reconectar. */
export async function registrarTasa(tasa: number, registradoNombre?: string): Promise<TasaCambio> {
  if (!Number.isFinite(tasa) || tasa <= 0 || tasa >= 10_000_000) throw new Error('La tasa debe ser un número mayor a 0.');

  const nueva: NuevaTasa = {
    fecha: fechaLocalISO(),
    tasa: Math.round(tasa * 10000) / 10000,
    registrado_nombre: registradoNombre ?? null,
  };

  let guardada: TasaCambio;
  if (!supabaseConfigurado) {
    const db = leerDB();
    guardada = { ...nueva, id: generarId(), created_at: new Date().toISOString() };
    (db.tasas ?? (db.tasas = [])).unshift(guardada);
    guardarDB(db);
  } else {
    try {
      guardada = await tasasDb.insertarTasa(nueva);
    } catch (err) {
      if (!esErrorDeRed(err)) throw err;
      console.warn('[EASYSTEM] Sin conexión con Supabase; la tasa se guardó localmente para sincronizar después.', err);
      guardada = { ...nueva, id: `pendiente-${generarId()}`, created_at: new Date().toISOString() };
      guardarColaTasas([...leerColaTasas(), guardada]);
    }
  }

  guardarCache(LS_CACHE_TASA, guardada);
  return guardada;
}

// ----------------------------------------------------------------------------
// Movimientos de inventario / Ventas
// ----------------------------------------------------------------------------
export async function listarMovimientos(limite = 100): Promise<MovimientoConProducto[]> {
  if (!supabaseConfigurado) {
    const db = leerDB();
    const productosPorId = Object.fromEntries(db.productos.map((p) => [p.id, p]));

    return db.movimientos
      .slice()
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
      .slice(0, limite)
      .map((m) => {
        const producto = productosPorId[m.producto_id];
        return { ...m, producto: producto ? { nombre: producto.nombre, codigo_barras: producto.codigo_barras } : null };
      });
  }

  try {
    const movimientos = await movimientosDb.listarMovimientosRecientes(limite);
    guardarCache(LS_CACHE_MOVIMIENTOS, movimientos);
    return movimientos;
  } catch (err) {
    if (!esErrorDeRed(err)) throw err;
    console.warn('[EASYSTEM] Sin conexión con Supabase; usando movimientos guardados localmente.', err);
    return (leerCache<MovimientoConProducto[]>(LS_CACHE_MOVIMIENTOS) ?? []).slice(0, limite);
  }
}

export async function registrarMovimiento(input: {
  producto_id: string;
  tipo: TipoMovimiento;
  cantidad: number;
  motivo?: string;
}): Promise<MovimientoInventario> {
  if (input.cantidad <= 0) throw new Error('La cantidad debe ser mayor a 0.');

  if (!supabaseConfigurado) {
    const db = leerDB();
    const producto = db.productos.find((p) => p.id === input.producto_id);
    if (!producto) throw new Error('Producto no encontrado.');

    if (input.tipo === 'SALIDA' && producto.stock_actual < input.cantidad) {
      throw new Error(
        `Stock insuficiente para "${producto.nombre}": disponible ${producto.stock_actual}, solicitado ${input.cantidad}.`
      );
    }

    producto.stock_actual += input.tipo === 'ENTRADA' ? input.cantidad : -input.cantidad;

    const movimiento: MovimientoInventario = {
      id: generarId(),
      producto_id: input.producto_id,
      tipo: input.tipo,
      cantidad: input.cantidad,
      motivo: input.motivo ?? null,
      fecha: new Date().toISOString(),
    };
    db.movimientos.unshift(movimiento);
    guardarDB(db);
    return movimiento;
  }

  try {
    return await movimientosDb.registrarMovimiento(input);
  } catch (err) {
    if (!esErrorDeRed(err)) throw err;

    // Sin conexión: valida contra el último stock conocido y encola la venta
    // para reintentarla cuando vuelva la red (ver sincronizarPendientes).
    const cache = aplicarPendientesAProductos(leerCache<ProductoConRelaciones[]>(LS_CACHE_PRODUCTOS) ?? []);
    const producto = cache.find((p) => p.id === input.producto_id);
    if (input.tipo === 'SALIDA' && producto && producto.stock_actual < input.cantidad) {
      throw new Error(
        `Stock insuficiente para "${producto.nombre}": disponible ${producto.stock_actual}, solicitado ${input.cantidad}.`
      );
    }

    console.warn('[EASYSTEM] Sin conexión con Supabase; el movimiento se guardó localmente para sincronizar después.', err);
    return encolarMovimientoPendiente(input);
  }
}

/**
 * La venta quedó (total o parcialmente) descontada del inventario pero algo
 * falló después. `productosRegistrados` lista las líneas que YA salieron del
 * stock: la pantalla debe quitarlas del carrito para no cobrarlas dos veces.
 */
export class VentaIncompletaError extends Error {
  constructor(
    mensaje: string,
    public productosRegistrados: string[]
  ) {
    super(mensaje);
    this.name = 'VentaIncompletaError';
  }
}

export interface DatosVenta {
  cliente: ClienteVenta;
  metodo_pago: MetodoPago;
  /** Bs por $ del día; se guarda en la venta (y fija el monto en Bs si el cobro es en bolívares) */
  tasa_cambio: number;
  vendedor_nombre?: string;
}

/** Venta ya guardada. `pendienteSincronizar`: se hizo sin conexión y el folio se asignará al sincronizar (folio = 0). */
export type VentaRegistrada = Venta & { pendienteSincronizar?: boolean };

async function guardarRegistroDeVenta(registro: NuevaVenta): Promise<VentaRegistrada> {
  if (!supabaseConfigurado) {
    const db = leerDB();
    const ventas = db.ventas ?? (db.ventas = []);
    const venta: Venta = { ...registro, id: generarId(), folio: ventas.reduce((m, v) => Math.max(m, v.folio), 0) + 1 };
    ventas.unshift(venta);
    guardarDB(db);
    return venta;
  }

  try {
    return await ventasDb.insertarVenta(registro);
  } catch (err) {
    if (!esErrorDeRed(err)) throw err;
    console.warn('[EASYSTEM] Sin conexión con Supabase; el registro de la venta se guardó localmente para sincronizar después.', err);
    guardarColaVentas([...leerColaVentas(), registro]);
    return { ...registro, id: `pendiente-${generarId()}`, folio: 0, pendienteSincronizar: true };
  }
}

/**
 * Registra una venta del POS: cada línea del carrito sale del inventario como un
 * movimiento SALIDA y después se guarda el registro de la venta (cliente, tipo
 * de cobro, total y detalle con los precios del momento).
 * Nota: las líneas se procesan en secuencia y no son atómicas entre sí -- si el
 * stock alcanza para las primeras pero no para una posterior, esas primeras
 * quedan registradas (y la venta se guarda solo con ellas) y se lanza
 * VentaIncompletaError. Una venta transaccional real requeriría una función RPC
 * de Postgres.
 */
export async function registrarVenta(items: VentaItem[], datos: DatosVenta): Promise<VentaRegistrada> {
  if (items.length === 0) throw new Error('El carrito está vacío.');

  const cliente = {
    cedula: datos.cliente.cedula.trim(),
    nombre: datos.cliente.nombre.trim().replace(/\s+/g, ' '),
    telefono: datos.cliente.telefono.trim(),
  };
  if (!cliente.cedula || !cliente.nombre || !cliente.telefono) {
    throw new Error('Faltan datos del cliente (cédula, nombre y teléfono).');
  }
  if (!METODOS_PAGO.some((m) => m.valor === datos.metodo_pago)) throw new Error('Selecciona un tipo de cobro válido.');
  if (!(datos.tasa_cambio > 0)) throw new Error('Falta la tasa del dólar del día. Regístrala e inténtalo de nuevo.');

  const registradas: VentaItem[] = [];
  let fallo: unknown = null;
  for (const item of items) {
    try {
      await registrarMovimiento({ producto_id: item.producto_id, tipo: 'SALIDA', cantidad: item.cantidad, motivo: 'Venta POS' });
      registradas.push(item);
    } catch (err) {
      fallo = err;
      break;
    }
  }
  if (registradas.length === 0) throw fallo; // nada salió del inventario: se puede reintentar tal cual

  const totalUsd = Math.round(registradas.reduce((suma, i) => suma + i.precio_unitario * i.cantidad, 0) * 100) / 100;
  const registro: NuevaVenta = {
    fecha: new Date().toISOString(),
    cliente_cedula: cliente.cedula,
    cliente_nombre: cliente.nombre,
    cliente_telefono: cliente.telefono,
    metodo_pago: datos.metodo_pago,
    total: totalUsd,
    items: registradas,
    vendedor_nombre: datos.vendedor_nombre ?? null,
    tasa_cambio: datos.tasa_cambio,
    total_bs: esMetodoBolivares(datos.metodo_pago) ? convertirABs(totalUsd, datos.tasa_cambio) : null,
  };
  const ids = registradas.map((i) => i.producto_id);

  let venta: VentaRegistrada;
  try {
    venta = await guardarRegistroDeVenta(registro);
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    throw new VentaIncompletaError(
      `El inventario se descontó, pero no se pudo guardar el registro de la venta: ${detalle}`,
      ids
    );
  }

  if (fallo) {
    const detalle = fallo instanceof Error ? fallo.message : String(fallo);
    throw new VentaIncompletaError(
      `${detalle} Se registraron solo ${registradas.length} de ${items.length} líneas (venta #${venta.folio || 'pendiente'}); las demás siguen en el carrito.`,
      ids
    );
  }
  return venta;
}

// ----------------------------------------------------------------------------
// Importación masiva (plan preparado por src/lib/importador.ts)
// ----------------------------------------------------------------------------
export interface ResultadoImportacion {
  creados: number;
  actualizados: number;
  movimientos: number;
}

const MOTIVO_CARGA_INICIAL = 'Carga inicial (importación)';
const MOTIVO_AJUSTE = 'Ajuste por importación';

/**
 * Aplica un plan de importación. El stock NUNCA se escribe directo: los
 * productos nuevos nacen en 0 y la cantidad entra como movimiento ENTRADA; en
 * los existentes la diferencia contra el stock actual se registra como
 * ENTRADA/SALIDA ("ajuste por importación").
 * Requiere conexión cuando Supabase está configurado (no se encola offline).
 */
export async function importarProductos(filas: FilaImportacion[]): Promise<ResultadoImportacion> {
  const resultado: ResultadoImportacion = { creados: 0, actualizados: 0, movimientos: 0 };
  const nuevas = filas.filter((f) => f.accion === 'crear');
  const existentes = filas.filter((f) => f.accion === 'actualizar' && f.productoId);

  if (!supabaseConfigurado) {
    const db = leerDB();
    const codigos = new Set(db.productos.map((p) => p.codigo_barras));
    const repetido = nuevas.find((f) => codigos.has(f.codigo_barras));
    if (repetido) throw new Error(`El código ${repetido.codigo_barras} ya existe en el inventario.`);

    const ahora = new Date().toISOString();
    const mover = (producto: Producto, tipo: TipoMovimiento, cantidad: number, motivo: string) => {
      producto.stock_actual += tipo === 'ENTRADA' ? cantidad : -cantidad;
      db.movimientos.unshift({ id: generarId(), producto_id: producto.id, tipo, cantidad, motivo, fecha: ahora });
      resultado.movimientos++;
    };

    for (const f of nuevas) {
      const producto: Producto = {
        id: generarId(),
        codigo_barras: f.codigo_barras,
        nombre: f.nombre,
        categoria: f.categoria,
        precio_compra: f.precio_compra ?? 0,
        precio_venta: f.precio_venta,
        stock_actual: 0,
        stock_minimo: f.stock_minimo ?? 0,
        created_at: ahora,
      };
      db.productos.push(producto);
      for (const modelo_id of f.modeloIds ?? []) db.compatibilidades.push({ id: generarId(), producto_id: producto.id, modelo_id });
      if ((f.stock_objetivo ?? 0) > 0) mover(producto, 'ENTRADA', f.stock_objetivo!, MOTIVO_CARGA_INICIAL);
      resultado.creados++;
    }

    for (const f of existentes) {
      const producto = db.productos.find((p) => p.id === f.productoId);
      if (!producto) continue;
      producto.nombre = f.nombre;
      producto.categoria = f.categoria;
      producto.precio_venta = f.precio_venta;
      if (f.precio_compra !== null) producto.precio_compra = f.precio_compra;
      if (f.stock_minimo !== null) producto.stock_minimo = f.stock_minimo;
      if (f.modeloIds !== null) {
        db.compatibilidades = db.compatibilidades.filter((c) => c.producto_id !== producto.id);
        for (const modelo_id of f.modeloIds) db.compatibilidades.push({ id: generarId(), producto_id: producto.id, modelo_id });
      }
      if (f.stock_objetivo !== null && f.stock_objetivo !== producto.stock_actual) {
        const delta = f.stock_objetivo - producto.stock_actual;
        mover(producto, delta > 0 ? 'ENTRADA' : 'SALIDA', Math.abs(delta), MOTIVO_AJUSTE);
      }
      resultado.actualizados++;
    }

    guardarDB(db);
    return resultado;
  }

  // --- Supabase ---
  const stockActual = new Map((await productosDb.listarProductos()).map((p) => [p.id, p.stock_actual]));
  const movimientos: { producto_id: string; tipo: TipoMovimiento; cantidad: number; motivo: string }[] = [];
  const pares: { producto_id: string; modelo_id: string }[] = [];

  if (nuevas.length > 0) {
    const creados = await productosDb.crearProductosLote(
      nuevas.map((f) => ({
        codigo_barras: f.codigo_barras,
        nombre: f.nombre,
        categoria: f.categoria,
        precio_compra: f.precio_compra ?? 0,
        precio_venta: f.precio_venta,
        stock_actual: 0,
        stock_minimo: f.stock_minimo ?? 0,
      }))
    );
    const idPorCodigo = new Map(creados.map((c) => [c.codigo_barras, c.id]));
    for (const f of nuevas) {
      const id = idPorCodigo.get(f.codigo_barras);
      if (!id) continue;
      for (const modelo_id of f.modeloIds ?? []) pares.push({ producto_id: id, modelo_id });
      if ((f.stock_objetivo ?? 0) > 0) {
        movimientos.push({ producto_id: id, tipo: 'ENTRADA', cantidad: f.stock_objetivo!, motivo: MOTIVO_CARGA_INICIAL });
      }
    }
    resultado.creados = creados.length;
  }

  const idsConCompatibilidad: string[] = [];
  for (let i = 0; i < existentes.length; i += 5) {
    await Promise.all(
      existentes.slice(i, i + 5).map(async (f) => {
        const cambios: Partial<Producto> = { nombre: f.nombre, categoria: f.categoria, precio_venta: f.precio_venta };
        if (f.precio_compra !== null) cambios.precio_compra = f.precio_compra;
        if (f.stock_minimo !== null) cambios.stock_minimo = f.stock_minimo;
        await productosDb.actualizarProducto(f.productoId!, cambios);

        if (f.modeloIds !== null) {
          idsConCompatibilidad.push(f.productoId!);
          for (const modelo_id of f.modeloIds) pares.push({ producto_id: f.productoId!, modelo_id });
        }
        const actual = stockActual.get(f.productoId!);
        if (f.stock_objetivo !== null && actual !== undefined && f.stock_objetivo !== actual) {
          const delta = f.stock_objetivo - actual;
          movimientos.push({
            producto_id: f.productoId!,
            tipo: delta > 0 ? 'ENTRADA' : 'SALIDA',
            cantidad: Math.abs(delta),
            motivo: MOTIVO_AJUSTE,
          });
        }
        resultado.actualizados++;
      })
    );
  }

  if (pares.length > 0 || idsConCompatibilidad.length > 0) {
    await productosDb.reemplazarCompatibilidadesLote(pares, idsConCompatibilidad);
  }
  if (movimientos.length > 0) {
    await movimientosDb.registrarMovimientosLote(movimientos);
    resultado.movimientos = movimientos.length;
  }

  return resultado;
}
