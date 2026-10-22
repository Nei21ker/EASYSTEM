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
import * as devolucionesDb from './db/devoluciones';
import * as localesDb from './db/locales';
import * as ordenesDb from './db/ordenes';
import * as nominaDb from './db/nomina';
import type { ProductoConInventario } from './db/productos';
import { esGlobal, leerSuscripcionesLocales, obtenerSesionActual } from './auth';
import { $contextoLocal, type ContextoLocal } from '../stores/local';
import { ALCANCE_TODOS, LOCAL_ACCESORIOS_ID, LOCAL_SERVICIO_TECNICO_ID, LOCAL_VIDRIOS_ID, localVigente, localesPorDefecto } from './constantes-locales';
import type { MovimientoConProducto } from './db/movimientos';
import { productosMock, modelosMock, movimientosMock, empleadosMock } from './mock-data';
import { pagoBaseQuincenal, totalPago, validarAjustes } from '../utils/nomina';
import { imagenDemoParaProducto } from './imagenes-demo';
import { convertirABs, fechaLocalISO } from '../utils/format';
import { blobADataUrl } from '../utils/imagenes';
import { esMetodoBolivares, METODOS_PAGO, METODOS_REEMBOLSO, METODOS_VUELTO } from '../utils/pagos';
import type { FilaImportacion } from './importador';
import type {
  ClienteVenta,
  Compatibilidad,
  Devolucion,
  DineroEntregado,
  Empleado,
  EstadoOrdenServicio,
  InventarioLocal,
  Local,
  MetodoPago,
  ModeloTelefono,
  MovimientoInventario,
  Producto,
  ProductoConRelaciones,
  NuevaDevolucion,
  NuevaOrdenServicio,
  NuevaTasa,
  NuevaVenta,
  NuevoEmpleado,
  Nomina,
  OrdenServicio,
  PagoVenta,
  ProductoStockBajo,
  RepuestoOrden,
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
  /** Los 3 locales y el stock de cada producto en cada local (los navegadores con datos anteriores se migran al leer) */
  locales: Local[];
  inventario: InventarioLocal[];
  /** Órdenes de servicio técnico */
  ordenes?: OrdenServicio[];
  /** Opcional: los navegadores con datos anteriores a las ventas con cliente no lo traen */
  ventas?: Venta[];
  /** Historial de la tasa del dólar (opcional por la misma razón que ventas) */
  tasas?: TasaCambio[];
  devoluciones?: Devolucion[];
  /** Nómina (personal y pagos quincenales); los navegadores con datos anteriores los reciben al leer */
  empleados?: Empleado[];
  nominas?: Nomina[];
  /** Ya se pusieron las imágenes de prueba a los productos del Local Accesorios (una sola vez) */
  imagenesDemo?: boolean;
}

function generarId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`;
}

function construirSeedInicial(): LocalDB {
  const productos: Producto[] = productosMock.map(({ modelos_compatibles, ...producto }) => producto);
  const compatibilidades: Compatibilidad[] = productosMock.flatMap((p) =>
    p.modelos_compatibles.map((modelo) => ({ id: generarId(), producto_id: p.id, modelo_id: modelo.id }))
  );
  // Demo: los vidrios templados en el Local Vidrios, los repuestos en el de Servicio Técnico y el resto en Accesorios
  const localDe = (categoria: string) =>
    categoria === 'Vidrios Templados' ? LOCAL_VIDRIOS_ID : categoria === 'Repuestos' ? LOCAL_SERVICIO_TECNICO_ID : LOCAL_ACCESORIOS_ID;
  const localPorProducto = new Map(productos.map((p) => [p.id, localDe(p.categoria)]));
  // Imágenes de prueba para los productos del Local Accesorios (hasta cargar las fotos reales)
  for (const p of productos) {
    if (localPorProducto.get(p.id) === LOCAL_ACCESORIOS_ID && !p.imagen_url) p.imagen_url = imagenDemoParaProducto(p.nombre, p.categoria);
  }
  const inventario: InventarioLocal[] = productos.map((p) => ({
    local_id: localPorProducto.get(p.id)!,
    producto_id: p.id,
    stock_actual: p.stock_actual,
    stock_minimo: p.stock_minimo,
  }));
  const movimientos: MovimientoInventario[] = movimientosMock.map(({ producto, ...movimiento }) => ({
    ...movimiento,
    local_id: localPorProducto.get(movimiento.producto_id) ?? LOCAL_ACCESORIOS_ID,
  }));

  return { productos, modelos: modelosMock, compatibilidades, movimientos, locales: localesPorDefecto(), inventario, empleados: empleadosMock(), nominas: [], imagenesDemo: true };
}

/**
 * Datos guardados antes del multi-local: se agregan los 3 locales y TODO lo existente (stock, movimientos,
 * ventas, devoluciones) pasa al Local Accesorios, igual que hace la migración 0016 en Supabase.
 */
function migrarAMultilocal(db: LocalDB): boolean {
  let cambio = false;
  if (!db.locales) {
    db.locales = localesPorDefecto();
    cambio = true;
  }
  if (!db.inventario) {
    db.inventario = db.productos.map((p) => ({ local_id: LOCAL_ACCESORIOS_ID, producto_id: p.id, stock_actual: p.stock_actual, stock_minimo: p.stock_minimo }));
    cambio = true;
  }
  for (const lista of [db.movimientos, db.ventas ?? [], db.devoluciones ?? []] as { local_id?: string }[][]) {
    for (const fila of lista) {
      if (!fila.local_id) {
        fila.local_id = LOCAL_ACCESORIOS_ID;
        cambio = true;
      }
    }
  }
  return cambio;
}

/** Datos guardados antes de las imágenes de prueba: se les pone una (sin pisar fotos) a los productos del Local Accesorios, una sola vez. */
function migrarImagenesDemo(db: LocalDB): boolean {
  if (db.imagenesDemo) return false;
  const enAccesorios = new Set(db.inventario.filter((i) => i.local_id === LOCAL_ACCESORIOS_ID).map((i) => i.producto_id));
  for (const p of db.productos) {
    if (enAccesorios.has(p.id) && !p.imagen_url) p.imagen_url = imagenDemoParaProducto(p.nombre, p.categoria);
  }
  db.imagenesDemo = true;
  return true;
}

/** Datos guardados antes de la nómina: se agrega el personal de ejemplo. */
function migrarNomina(db: LocalDB): boolean {
  let cambio = false;
  if (!db.empleados) {
    db.empleados = empleadosMock();
    cambio = true;
  }
  if (!db.nominas) {
    db.nominas = [];
    cambio = true;
  }
  return cambio;
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
      const migrado = [migrarAMultilocal(db), migrarNomina(db), migrarImagenesDemo(db)].some(Boolean);
      if (faltantes.length > 0) db.modelos.push(...faltantes);
      if (faltantes.length > 0 || migrado) guardarDB(db);
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

function normalizarProductoLocal(producto: Producto, db: LocalDB): ProductoConInventario {
  const modeloIds = db.compatibilidades.filter((c) => c.producto_id === producto.id).map((c) => c.modelo_id);
  const modelos_compatibles = db.modelos.filter((m) => modeloIds.includes(m.id));
  const inventario = db.inventario.filter((i) => i.producto_id === producto.id);
  return { ...producto, modelos_compatibles, inventario };
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
const LS_CACHE_VENTAS = 'easystem:cache:ventas';
const LS_CACHE_DEVOLUCIONES = 'easystem:cache:devoluciones';
const EVENTO_CONEXION = 'easystem:conexion-cambio';

interface MovimientoPendiente {
  id: string;
  producto_id: string;
  tipo: TipoMovimiento;
  cantidad: number;
  motivo?: string;
  /** Local del movimiento (los pendientes guardados antes del multi-local no lo traen: eran del Local Accesorios) */
  local_id?: string;
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

/** Ajusta el stock en caché (por local) restando/sumando los movimientos aún no sincronizados. */
function aplicarPendientesAProductos(productos: ProductoConInventario[]): ProductoConInventario[] {
  const pendientes = leerColaSync();
  if (pendientes.length === 0) return productos;

  return productos.map((p) => {
    const propios = pendientes.filter((m) => m.producto_id === p.id);
    if (propios.length === 0) return p;

    const inventario = p.inventario.map((i) => ({ ...i }));
    let total = p.stock_actual;
    for (const m of propios) {
      const delta = m.tipo === 'ENTRADA' ? m.cantidad : -m.cantidad;
      const localId = m.local_id ?? LOCAL_ACCESORIOS_ID;
      let fila = inventario.find((i) => i.local_id === localId);
      if (!fila) {
        fila = { local_id: localId, producto_id: p.id, stock_actual: 0, stock_minimo: 0 };
        inventario.push(fila);
      }
      fila.stock_actual += delta;
      total += delta;
    }
    return { ...p, stock_actual: total, inventario };
  });
}

function encolarMovimientoPendiente(input: {
  producto_id: string;
  tipo: TipoMovimiento;
  cantidad: number;
  motivo?: string;
  local_id: string;
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
    local_id: input.local_id,
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
        local_id: pendiente.local_id ?? LOCAL_ACCESORIOS_ID,
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
      await ventasDb.insertarVenta({ ...venta, local_id: venta.local_id ?? LOCAL_ACCESORIOS_ID });
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
// Contexto de local (multi-local)
//
// El administrador puede ver "Todos los locales" o uno en concreto (selector del encabezado,
// recordado en este navegador); el resto de roles trabaja siempre con su local asignado. Casi todas
// las funciones de este servicio se filtran solas por ese alcance, así que las pantallas no tienen
// que pasar el local; las operaciones que ESCRIBEN (vender, mover stock...) exigen un local concreto.
// La base de datos vuelve a imponer lo mismo con RLS.
// ----------------------------------------------------------------------------
const LS_LOCAL_ACTIVO = 'easystem:local-activo';
const LS_CACHE_LOCALES = 'easystem:cache:locales';

let contextoPromesa: Promise<ContextoLocal | null> | null = null;

export async function listarLocales(): Promise<Local[]> {
  // Modo LocalStorage: el estado de suscripción simulado (lo cambia el super_admin) se mezcla con los locales
  if (!supabaseConfigurado) {
    const suscripciones = leerSuscripcionesLocales();
    return leerDB().locales.map((l) => ({ ...l, ...suscripciones[l.id] }));
  }

  try {
    const locales = await localesDb.listarLocales();
    guardarCache(LS_CACHE_LOCALES, locales);
    return locales;
  } catch (err) {
    if (!esErrorDeRed(err)) throw err;
    return leerCache<Local[]>(LS_CACHE_LOCALES) ?? [];
  }
}

async function cargarContexto(): Promise<ContextoLocal | null> {
  const sesion = await obtenerSesionActual();
  if (!sesion) return null;

  const locales = await listarLocales();
  let alcance: string | null;
  if (esGlobal(sesion.rol)) {
    let guardado: string | null = null;
    try {
      guardado = localStorage.getItem(LS_LOCAL_ACTIVO);
    } catch {
      /* sin almacenamiento: vista "Todos" */
    }
    // Al gerente un local suspendido no le devuelve nada, así que no se puede elegir: vuelve a "Todos".
    // El administrador entra a cualquier local, aunque esté suspendido.
    alcance =
      guardado && (guardado === ALCANCE_TODOS || locales.some((l) => l.id === guardado && (sesion.rol === 'administrador' || localVigente(l))))
        ? guardado
        : ALCANCE_TODOS;
  } else {
    alcance = sesion.local_id && locales.some((l) => l.id === sesion.local_id) ? sesion.local_id : null;
  }

  const contexto: ContextoLocal = { sesion, locales, alcance, local: locales.find((l) => l.id === alcance) ?? null };
  $contextoLocal.set(contexto);
  return contexto;
}

/** Sesión + locales + local activo. Se calcula una vez por carga de página. null si no hay sesión. */
export function obtenerContextoLocal(): Promise<ContextoLocal | null> {
  if (!contextoPromesa) contextoPromesa = cargarContexto();
  return contextoPromesa;
}

/**
 * Cambia el local activo del administrador ('todos' o el id de un local) y recarga la vista para que
 * Dashboard, POS, Inventario y Reportes se vuelvan a pedir ya filtrados. Los demás roles no pueden cambiar.
 */
export function cambiarLocalActivo(alcance: string): void {
  const contexto = $contextoLocal.get();
  if (!esGlobal(contexto?.sesion.rol)) return;
  if (alcance !== ALCANCE_TODOS && !contexto.locales.some((l) => l.id === alcance)) return;
  try {
    localStorage.setItem(LS_LOCAL_ACTIVO, alcance);
  } catch {
    /* sin almacenamiento: no se recuerda, pero se aplica */
  }
  window.location.reload();
}

interface Alcance {
  /** true = vista "Todos los locales" (administrador) */
  todos: boolean;
  /** Local concreto (null en "todos" o si el usuario no tiene local) */
  localId: string | null;
}

async function alcanceActual(): Promise<Alcance> {
  const contexto = await obtenerContextoLocal();
  if (!contexto) return { todos: true, localId: null };
  if (contexto.alcance === ALCANCE_TODOS) return { todos: true, localId: null };
  return { todos: false, localId: contexto.alcance };
}

/** El local concreto sobre el que se va a escribir; si no hay uno (vista "Todos" o sin local asignado) lanza un error accionable. */
async function exigirLocal(accion: string): Promise<string> {
  const alcance = await alcanceActual();
  if (alcance.localId) return alcance.localId;
  const contexto = await obtenerContextoLocal();
  throw new Error(
    contexto && contexto.alcance === null
      ? 'Tu usuario no tiene un local asignado. Pídele al administrador que te asigne uno.'
      : `Elige un local en el selector del encabezado para ${accion}.`
  );
}

// ----------------------------------------------------------------------------
// Productos
// ----------------------------------------------------------------------------
/**
 * Productos del catálogo con su inventario en cada local (crudo). Las pantallas usan listarProductos(),
 * que lo proyecta al local activo.
 */
async function listarProductosCrudos(): Promise<ProductoConInventario[]> {
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
    return aplicarPendientesAProductos(leerCache<ProductoConInventario[]>(LS_CACHE_PRODUCTOS) ?? []);
  }
}

/**
 * Proyecta un producto al alcance activo: el stock y el mínimo son los del local elegido; en "Todos los
 * locales" el stock es el total (con el desglose en stock_por_local) y no se juzga el mínimo (las alertas
 * de reabastecimiento son por local: ver listarProductosStockBajo). null = ese local no maneja el producto.
 */
function proyectarProducto(crudo: ProductoConInventario, alcance: Alcance, catalogoCompleto: boolean): ProductoConRelaciones | null {
  const { inventario, ...producto } = crudo;
  if (alcance.todos) {
    return {
      ...producto,
      stock_actual: inventario.reduce((suma, i) => suma + i.stock_actual, 0),
      stock_minimo: 0,
      stock_por_local: Object.fromEntries(inventario.map((i) => [i.local_id, i.stock_actual])),
    };
  }
  const fila = alcance.localId ? inventario.find((i) => i.local_id === alcance.localId) : undefined;
  if (!fila && !catalogoCompleto) return null;
  return { ...producto, stock_actual: fila?.stock_actual ?? 0, stock_minimo: fila?.stock_minimo ?? 0 };
}

/**
 * Productos del alcance activo. Con un local elegido: solo los que ese local maneja (tienen inventario ahí).
 * `catalogoCompleto`: todo el catálogo, con stock 0 donde el local no lo maneja (para dar de alta entradas,
 * escanear códigos o consultar compatibilidades). `localId`: proyecta a ese local en vez de al activo.
 */
export async function listarProductos(opciones: { catalogoCompleto?: boolean; localId?: string } = {}): Promise<ProductoConRelaciones[]> {
  // `localId` fuerza un local concreto (p. ej. el de una venta que se está devolviendo) en vez del local activo
  const [crudos, alcance] = await Promise.all([
    listarProductosCrudos(),
    opciones.localId ? Promise.resolve<Alcance>({ todos: false, localId: opciones.localId }) : alcanceActual(),
  ]);
  return crudos.map((p) => proyectarProducto(p, alcance, !!opciones.catalogoCompleto)).filter((p): p is ProductoConRelaciones => p !== null);
}

export async function obtenerProductoPorCodigoBarras(codigoBarras: string): Promise<ProductoConRelaciones | null> {
  let crudo: ProductoConInventario | null | undefined;
  if (!supabaseConfigurado) {
    const db = leerDB();
    const producto = db.productos.find((p) => p.codigo_barras === codigoBarras);
    crudo = producto ? normalizarProductoLocal(producto, db) : null;
  } else {
    try {
      crudo = await productosDb.obtenerProductoPorCodigoBarras(codigoBarras);
    } catch (err) {
      if (!esErrorDeRed(err)) throw err;
      const cache = aplicarPendientesAProductos(leerCache<ProductoConInventario[]>(LS_CACHE_PRODUCTOS) ?? []);
      crudo = cache.find((p) => p.codigo_barras === codigoBarras) ?? null;
    }
  }
  return crudo ? proyectarProducto(crudo, await alcanceActual(), true) : null;
}

/** Alertas de reabastecimiento del alcance activo: una fila por producto y local con mínimo > 0 y stock ≤ mínimo. */
export async function listarProductosStockBajo(): Promise<ProductoStockBajo[]> {
  const alcance = await alcanceActual();

  const derivar = async (): Promise<ProductoStockBajo[]> => {
    const [crudos, locales] = await Promise.all([listarProductosCrudos(), listarLocales()]);
    const nombres = new Map(locales.map((l) => [l.id, l.nombre]));
    const filas: ProductoStockBajo[] = [];
    for (const p of crudos) {
      for (const i of p.inventario) {
        if (!(i.stock_minimo > 0 && i.stock_actual <= i.stock_minimo)) continue;
        if (!alcance.todos && i.local_id !== alcance.localId) continue;
        filas.push({
          id: p.id,
          codigo_barras: p.codigo_barras,
          nombre: p.nombre,
          categoria: p.categoria,
          stock_actual: i.stock_actual,
          stock_minimo: i.stock_minimo,
          local_id: i.local_id,
          local_nombre: nombres.get(i.local_id),
        });
      }
    }
    return filas.sort((a, b) => a.stock_actual - b.stock_actual);
  };

  if (!supabaseConfigurado) return derivar();

  try {
    return await productosDb.listarProductosStockBajo(alcance.localId);
  } catch (err) {
    if (!esErrorDeRed(err)) throw err;
    return derivar(); // sin conexión: se deriva del catálogo en caché en vez de fallar
  }
}

export async function crearProducto(
  input: Partial<Producto> & Pick<Producto, 'codigo_barras' | 'nombre' | 'categoria'>
): Promise<Producto> {
  // El producto nace en el catálogo (compartido); si hay un local elegido, ese local empieza a manejarlo (con su mínimo)
  const { localId } = await alcanceActual();

  if (supabaseConfigurado) {
    const creado = await productosDb.crearProducto(input);
    if (localId) await productosDb.fijarMinimosLote(localId, [{ producto_id: creado.id, stock_minimo: input.stock_minimo ?? 0 }]);
    return creado;
  }

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
  if (localId) db.inventario.push({ local_id: localId, producto_id: producto.id, stock_actual: 0, stock_minimo: producto.stock_minimo });
  guardarDB(db);
  return producto;
}

export async function actualizarProducto(id: string, cambiosCrudos: Partial<Producto>): Promise<Producto> {
  // El stock solo cambia mediante movimientos (kardex); nunca por edición directa.
  const { stock_actual: _ignorado, id: _id, created_at: _creado, ...cambios } = cambiosCrudos;
  // El stock mínimo es POR LOCAL: con un local elegido se guarda en su inventario
  const { localId } = await alcanceActual();

  if (supabaseConfigurado) {
    const actualizado = await productosDb.actualizarProducto(id, cambios);
    if (localId && cambios.stock_minimo !== undefined) {
      await productosDb.fijarMinimosLote(localId, [{ producto_id: id, stock_minimo: cambios.stock_minimo }]);
    }
    return actualizado;
  }

  const db = leerDB();
  const producto = db.productos.find((p) => p.id === id);
  if (!producto) throw new Error('Producto no encontrado.');
  Object.assign(producto, cambios);
  if (localId && cambios.stock_minimo !== undefined) {
    const fila = db.inventario.find((i) => i.local_id === localId && i.producto_id === id);
    if (fila) fila.stock_minimo = cambios.stock_minimo;
    else db.inventario.push({ local_id: localId, producto_id: id, stock_actual: 0, stock_minimo: cambios.stock_minimo });
  }
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
  db.inventario = db.inventario.filter((i) => i.producto_id !== id);
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
  const alcance = await alcanceActual();
  const delAlcance = (m: { local_id: string }) => alcance.todos || m.local_id === alcance.localId;

  if (!supabaseConfigurado) {
    const db = leerDB();
    const productosPorId = Object.fromEntries(db.productos.map((p) => [p.id, p]));
    const localesPorId = Object.fromEntries(db.locales.map((l) => [l.id, l]));

    return db.movimientos
      .filter(delAlcance)
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
      .slice(0, limite)
      .map((m) => {
        const producto = productosPorId[m.producto_id];
        const local = localesPorId[m.local_id];
        return {
          ...m,
          producto: producto ? { nombre: producto.nombre, codigo_barras: producto.codigo_barras } : null,
          local: local ? { nombre: local.nombre } : null,
        };
      });
  }

  try {
    const movimientos = await movimientosDb.listarMovimientosRecientes(limite, alcance.localId);
    if (alcance.todos) guardarCache(LS_CACHE_MOVIMIENTOS, movimientos);
    return movimientos;
  } catch (err) {
    if (!esErrorDeRed(err)) throw err;
    console.warn('[EASYSTEM] Sin conexión con Supabase; usando movimientos guardados localmente.', err);
    return (leerCache<MovimientoConProducto[]>(LS_CACHE_MOVIMIENTOS) ?? []).filter(delAlcance).slice(0, limite);
  }
}

/**
 * Mueve el stock de UN local. Si no se indica local_id se usa el local activo (en la vista "Todos los
 * locales" hay que indicarlo o elegir uno antes).
 */
export async function registrarMovimiento(input: {
  producto_id: string;
  tipo: TipoMovimiento;
  cantidad: number;
  motivo?: string;
  local_id?: string;
}): Promise<MovimientoInventario> {
  if (input.cantidad <= 0) throw new Error('La cantidad debe ser mayor a 0.');
  const local_id = input.local_id ?? (await exigirLocal('registrar el movimiento de stock'));

  if (!supabaseConfigurado) {
    const db = leerDB();
    const producto = db.productos.find((p) => p.id === input.producto_id);
    if (!producto) throw new Error('Producto no encontrado.');

    let fila = db.inventario.find((i) => i.local_id === local_id && i.producto_id === input.producto_id);
    const disponible = fila?.stock_actual ?? 0;
    if (input.tipo === 'SALIDA' && disponible < input.cantidad) {
      throw new Error(`Stock insuficiente para "${producto.nombre}" en este local: disponible ${disponible}, solicitado ${input.cantidad}.`);
    }
    if (!fila) {
      fila = { local_id, producto_id: input.producto_id, stock_actual: 0, stock_minimo: 0 };
      db.inventario.push(fila);
    }

    const delta = input.tipo === 'ENTRADA' ? input.cantidad : -input.cantidad;
    fila.stock_actual += delta;
    producto.stock_actual += delta; // total entre locales

    const movimiento: MovimientoInventario = {
      id: generarId(),
      producto_id: input.producto_id,
      tipo: input.tipo,
      cantidad: input.cantidad,
      motivo: input.motivo ?? null,
      fecha: new Date().toISOString(),
      local_id,
    };
    db.movimientos.unshift(movimiento);
    guardarDB(db);
    return movimiento;
  }

  const registro = { producto_id: input.producto_id, tipo: input.tipo, cantidad: input.cantidad, motivo: input.motivo, local_id };
  try {
    return await movimientosDb.registrarMovimiento(registro);
  } catch (err) {
    if (!esErrorDeRed(err)) throw err;

    // Sin conexión: valida contra el último stock conocido de ESE local y encola el movimiento
    // para reintentarlo cuando vuelva la red (ver sincronizarPendientes).
    const cache = aplicarPendientesAProductos(leerCache<ProductoConInventario[]>(LS_CACHE_PRODUCTOS) ?? []);
    const producto = cache.find((p) => p.id === input.producto_id);
    const disponible = producto?.inventario.find((i) => i.local_id === local_id)?.stock_actual ?? 0;
    if (input.tipo === 'SALIDA' && producto && disponible < input.cantidad) {
      throw new Error(`Stock insuficiente para "${producto.nombre}" en este local: disponible ${disponible}, solicitado ${input.cantidad}.`);
    }

    console.warn('[EASYSTEM] Sin conexión con Supabase; el movimiento se guardó localmente para sincronizar después.', err);
    return encolarMovimientoPendiente(registro);
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
  /**
   * Cómo pagó el cliente: uno o varios tipos de cobro (sin repetir). La suma de monto_usd debe ser el
   * total de la venta; en los cobros en Bs, monto_bs es lo que se recibió en bolívares.
   */
  pagos: PagoVenta[];
  /** Vuelto entregado si los pagos superan el total (suma de pagos − vuelto = total) */
  vuelto?: DineroEntregado | null;
  /** Bs por $ del día; se guarda en la venta */
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

/** Valida que el vuelto sea de un tipo permitido y coherente con su moneda. */
function validarVuelto(vuelto: DineroEntregado | null | undefined, etiqueta: string, permitidos: MetodoPago[]) {
  if (!vuelto) return;
  if (!permitidos.includes(vuelto.metodo)) throw new Error(`${etiqueta}: ese tipo de cobro no se puede usar aquí.`);
  if (!(vuelto.monto_usd > 0)) throw new Error(`${etiqueta} debe ser mayor a 0.`);
  if (esMetodoBolivares(vuelto.metodo) !== (vuelto.monto_bs != null)) throw new Error(`${etiqueta}: el monto en bolívares no corresponde al tipo de cobro.`);
}

/**
 * Reparte pagos (y vuelto) en proporción a un total menor (venta que solo se completó en parte);
 * el residuo de centavos va al último pago, de modo que pagos − vuelto = totalNuevo.
 */
function ajustarPagos(
  pagos: PagoVenta[],
  vuelto: DineroEntregado | null,
  totalAnterior: number,
  totalNuevo: number,
  tasa: number
): { pagos: PagoVenta[]; vuelto: DineroEntregado | null } {
  const factor = totalAnterior > 0 ? totalNuevo / totalAnterior : 0;
  const centavos = (n: number) => Math.round(n * 100) / 100;
  const ajustados = pagos.map((p) => {
    const usd = centavos(p.monto_usd * factor);
    return { ...p, monto_usd: usd, monto_bs: p.monto_bs != null ? convertirABs(usd, tasa) : null };
  });
  let vueltoAjustado: DineroEntregado | null = null;
  if (vuelto) {
    const usd = centavos(vuelto.monto_usd * factor);
    if (usd > 0) vueltoAjustado = { ...vuelto, monto_usd: usd, monto_bs: vuelto.monto_bs != null ? convertirABs(usd, tasa) : null };
  }
  const neto = ajustados.reduce((suma, p) => suma + p.monto_usd, 0) - (vueltoAjustado?.monto_usd ?? 0);
  const ultimo = ajustados[ajustados.length - 1];
  ultimo.monto_usd = centavos(ultimo.monto_usd + (totalNuevo - neto));
  if (ultimo.monto_bs != null) ultimo.monto_bs = convertirABs(ultimo.monto_usd, tasa);
  return { pagos: ajustados.filter((p) => p.monto_usd > 0), vuelto: vueltoAjustado };
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
  const local_id = await exigirLocal('vender');

  const cliente = {
    cedula: datos.cliente.cedula.trim(),
    nombre: datos.cliente.nombre.trim().replace(/\s+/g, ' '),
    telefono: datos.cliente.telefono.trim(),
  };
  if (!cliente.cedula || !cliente.nombre || !cliente.telefono) {
    throw new Error('Faltan datos del cliente (cédula, nombre y teléfono).');
  }
  if (datos.pagos.length === 0) throw new Error('Indica cómo pagará el cliente.');
  if (datos.pagos.some((p) => !METODOS_PAGO.some((m) => m.valor === p.metodo) || !(p.monto_usd > 0))) {
    throw new Error('Cada forma de pago necesita un tipo de cobro válido y un monto mayor a 0.');
  }
  if (new Set(datos.pagos.map((p) => p.metodo)).size !== datos.pagos.length) {
    throw new Error('No repitas un tipo de cobro: suma sus montos en una sola forma de pago.');
  }
  const totalSolicitado = Math.round(items.reduce((suma, i) => suma + i.precio_unitario * i.cantidad, 0) * 100) / 100;
  validarVuelto(datos.vuelto, 'El vuelto', METODOS_VUELTO);
  const totalPagos = Math.round((datos.pagos.reduce((suma, p) => suma + p.monto_usd, 0) - (datos.vuelto?.monto_usd ?? 0)) * 100) / 100;
  if (Math.abs(totalPagos - totalSolicitado) > 0.011) {
    throw new Error(`Los pagos (menos el vuelto) suman ${totalPagos.toFixed(2)} y la venta es de ${totalSolicitado.toFixed(2)} dólares: deben coincidir.`);
  }
  if (!(datos.tasa_cambio > 0)) throw new Error('Falta la tasa del dólar del día. Regístrala e inténtalo de nuevo.');

  const registradas: VentaItem[] = [];
  let fallo: unknown = null;
  for (const item of items) {
    try {
      await registrarMovimiento({ producto_id: item.producto_id, tipo: 'SALIDA', cantidad: item.cantidad, motivo: 'Venta POS', local_id });
      registradas.push(item);
    } catch (err) {
      fallo = err;
      break;
    }
  }
  if (registradas.length === 0) throw fallo; // nada salió del inventario: se puede reintentar tal cual

  const totalUsd = Math.round(registradas.reduce((suma, i) => suma + i.precio_unitario * i.cantidad, 0) * 100) / 100;
  // Si solo se alcanzaron a registrar algunas líneas, los pagos se reparten en proporción al nuevo total.
  const reparto =
    registradas.length === items.length
      ? { pagos: datos.pagos, vuelto: datos.vuelto ?? null }
      : ajustarPagos(datos.pagos, datos.vuelto ?? null, totalSolicitado, totalUsd, datos.tasa_cambio);
  const { pagos, vuelto } = reparto;
  const registro: NuevaVenta = {
    fecha: new Date().toISOString(),
    local_id,
    cliente_cedula: cliente.cedula,
    cliente_nombre: cliente.nombre,
    cliente_telefono: cliente.telefono,
    metodo_pago: pagos.length === 1 ? pagos[0].metodo : 'MIXTO',
    pagos,
    vuelto,
    total: totalUsd,
    items: registradas,
    vendedor_nombre: datos.vendedor_nombre ?? null,
    tasa_cambio: datos.tasa_cambio,
    // Bolívares netos: lo recibido en Bs menos el vuelto entregado en Bs
    total_bs:
      pagos.some((p) => p.monto_bs != null) || vuelto?.monto_bs != null
        ? Math.round((pagos.reduce((suma, p) => suma + (p.monto_bs ?? 0), 0) - (vuelto?.monto_bs ?? 0)) * 100) / 100
        : null,
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

/**
 * Historial de ventas (más nuevas primero). Un vendedor recibe solo las suyas y el
 * administrador todas (lo exige la base de datos). Las ventas hechas sin conexión
 * y aún sin sincronizar aparecen con folio 0 y `pendienteSincronizar`.
 */
export async function listarVentas(opciones: { desde?: Date; hasta?: Date; limite?: number } = {}): Promise<VentaRegistrada[]> {
  const limite = opciones.limite ?? 1000;
  const alcance = await alcanceActual();
  const delAlcance = (v: { local_id?: string }) => alcance.todos || (v.local_id ?? LOCAL_ACCESORIOS_ID) === alcance.localId;
  const enRango = (v: { fecha: string }) => {
    const t = new Date(v.fecha).getTime();
    return (!opciones.desde || t >= opciones.desde.getTime()) && (!opciones.hasta || t <= opciones.hasta.getTime());
  };
  const masNuevasPrimero = (a: { fecha: string }, b: { fecha: string }) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime();

  if (!supabaseConfigurado) {
    return (leerDB().ventas ?? []).filter(enRango).filter(delAlcance).sort(masNuevasPrimero).slice(0, limite);
  }

  let remotas: Venta[];
  try {
    remotas = await ventasDb.listarVentas({ desde: opciones.desde, hasta: opciones.hasta, limite, localId: alcance.localId });
    if (alcance.todos) guardarCache(LS_CACHE_VENTAS, remotas);
  } catch (err) {
    if (!esErrorDeRed(err)) throw err;
    console.warn('[EASYSTEM] Sin conexión con Supabase; usando las ventas guardadas localmente.', err);
    remotas = (leerCache<Venta[]>(LS_CACHE_VENTAS) ?? []).filter(enRango).filter(delAlcance);
  }

  const pendientes: VentaRegistrada[] = leerColaVentas()
    .map((v, i) => ({ ...v, id: `pendiente-${i}-${v.fecha}`, folio: 0, pendienteSincronizar: true }))
    .filter(enRango)
    .filter(delAlcance);
  return [...pendientes, ...remotas].sort(masNuevasPrimero).slice(0, limite);
}

// ----------------------------------------------------------------------------
// Devoluciones y cambios de producto
// ----------------------------------------------------------------------------

/**
 * Devoluciones, más nuevas primero. El administrador ve todas; un vendedor, solo las de las ventas
 * que puede ver (lo exige la base de datos).
 */
export async function listarDevoluciones(opciones: { limite?: number; ventaId?: string } = {}): Promise<Devolucion[]> {
  const limite = opciones.limite ?? 2000;
  // Las de UNA venta se piden completas (aunque el local activo sea otro): hace falta para no devolver de más
  const alcance = opciones.ventaId ? { todos: true, localId: null } : await alcanceActual();
  const pasa = (d: Devolucion) => (!opciones.ventaId || d.venta_id === opciones.ventaId) && (alcance.todos || d.local_id === alcance.localId);
  const masNuevasPrimero = (a: Devolucion, b: Devolucion) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime();

  if (!supabaseConfigurado) {
    return (leerDB().devoluciones ?? []).filter(pasa).sort(masNuevasPrimero).slice(0, limite);
  }
  try {
    const remotas = await devolucionesDb.listarDevoluciones({ limite, ventaId: opciones.ventaId, localId: alcance.localId });
    if (!opciones.ventaId && alcance.todos) guardarCache(LS_CACHE_DEVOLUCIONES, remotas);
    return remotas;
  } catch (err) {
    if (!esErrorDeRed(err)) throw err;
    console.warn('[EASYSTEM] Sin conexión con Supabase; usando las devoluciones guardadas localmente.', err);
    return (leerCache<Devolucion[]>(LS_CACHE_DEVOLUCIONES) ?? []).filter(pasa).slice(0, limite);
  }
}

export interface DatosDevolucion {
  /** La venta original (ya guardada: con id y folio reales) */
  venta: Venta;
  /** Líneas de la venta que el cliente devuelve, con la cantidad (≤ lo vendido que aún no se devolvió) */
  devueltos: { producto_id: string; cantidad: number }[];
  /** Productos entregados a cambio, a su precio vigente (vacío = devolución simple) */
  nuevos: VentaItem[];
  motivo: string;
  /** Bs por $ de hoy */
  tasa_cambio: number;
  /** Si el cliente paga más que lo devuelto: cómo paga la diferencia (suma de pagos − vuelto = diferencia) */
  pagos?: PagoVenta[];
  vuelto?: DineroEntregado | null;
  /** Si se le debe dinero al cliente: con qué tipo de cobro se le devuelve (el monto se calcula) */
  reembolso_metodo?: MetodoPago | null;
  registrado_nombre?: string;
}

/** Lo que ya se devolvió de cada producto de una venta, sumando todas sus devoluciones. */
function cantidadesYaDevueltas(devoluciones: Devolucion[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const d of devoluciones) {
    for (const i of d.items_devueltos) mapa.set(i.producto_id, (mapa.get(i.producto_id) ?? 0) + i.cantidad);
  }
  return mapa;
}

/**
 * Registra una devolución o un cambio de producto de una venta. Lo devuelto entra al inventario
 * (ENTRADA) y lo entregado a cambio sale (SALIDA); después se guarda el registro con la diferencia
 * y su cobro o reembolso. Es una operación de administrador (la base de datos exige rol
 * administrador para las ENTRADAS y para el registro) y necesita conexión.
 */
export async function registrarDevolucion(datos: DatosDevolucion): Promise<Devolucion> {
  const { venta } = datos;
  if (!venta.folio || venta.id.startsWith('pendiente-')) {
    throw new Error('Esa venta aún no se sincroniza (está pendiente de enviarse). Espera a que se sincronice para devolverla.');
  }
  if (supabaseConfigurado && !obtenerEstadoConexion().online) {
    throw new Error('Las devoluciones necesitan conexión a internet. Inténtalo de nuevo cuando vuelva.');
  }
  const motivo = datos.motivo.trim().replace(/\s+/g, ' ');
  if (motivo.length < 3) throw new Error('Escribe el motivo de la devolución.');
  if (!(datos.tasa_cambio > 0)) throw new Error('Falta la tasa del dólar del día. Regístrala e inténtalo de nuevo.');
  if (datos.devueltos.length === 0) throw new Error('Indica qué producto se devuelve.');

  // 1) Cantidades: no se puede devolver más de lo vendido (descontando devoluciones anteriores)
  const ya = cantidadesYaDevueltas(await listarDevoluciones({ ventaId: venta.id }));
  const itemsDevueltos: VentaItem[] = [];
  for (const d of datos.devueltos) {
    const original = venta.items.find((i) => i.producto_id === d.producto_id);
    if (!original) throw new Error('Uno de los productos a devolver no pertenece a esa venta.');
    if (!Number.isInteger(d.cantidad) || d.cantidad <= 0) throw new Error(`La cantidad de "${original.nombre}" debe ser un número entero mayor a 0.`);
    const disponible = original.cantidad - (ya.get(d.producto_id) ?? 0);
    if (d.cantidad > disponible) {
      throw new Error(`De "${original.nombre}" solo se pueden devolver ${disponible} unidad(es) (vendidas ${original.cantidad}, ya devueltas ${original.cantidad - disponible}).`);
    }
    itemsDevueltos.push({ ...original, cantidad: d.cantidad });
  }
  if (datos.nuevos.some((n) => !Number.isInteger(n.cantidad) || n.cantidad <= 0 || !(n.precio_unitario >= 0))) {
    throw new Error('Revisa los productos de reemplazo: cantidad entera mayor a 0.');
  }

  // 2) Dinero: la diferencia decide si el cliente paga o se le reembolsa
  const centavos = (n: number) => Math.round(n * 100) / 100;
  const totalDevuelto = centavos(itemsDevueltos.reduce((suma, i) => suma + i.precio_unitario * i.cantidad, 0));
  const totalNuevo = centavos(datos.nuevos.reduce((suma, i) => suma + i.precio_unitario * i.cantidad, 0));
  const diferencia = centavos(totalNuevo - totalDevuelto);

  let pagos: PagoVenta[] | null = null;
  let vuelto: DineroEntregado | null = null;
  let reembolso: DineroEntregado | null = null;
  if (diferencia > 0.01) {
    pagos = datos.pagos ?? [];
    vuelto = datos.vuelto ?? null;
    if (pagos.length === 0 || pagos.some((p) => !METODOS_PAGO.some((m) => m.valor === p.metodo) || !(p.monto_usd > 0))) {
      throw new Error('El cliente debe pagar la diferencia: indica cómo paga.');
    }
    validarVuelto(vuelto, 'El vuelto', METODOS_VUELTO);
    const neto = centavos(pagos.reduce((suma, p) => suma + p.monto_usd, 0) - (vuelto?.monto_usd ?? 0));
    if (Math.abs(neto - diferencia) > 0.011) {
      throw new Error(`Los pagos (menos el vuelto) suman ${neto.toFixed(2)} y la diferencia a cobrar es ${diferencia.toFixed(2)} dólares: deben coincidir.`);
    }
  } else if (diferencia < -0.01) {
    const metodo = datos.reembolso_metodo;
    if (!metodo || !METODOS_REEMBOLSO.includes(metodo)) throw new Error('Indica con qué tipo de cobro se devuelve el dinero al cliente.');
    const usd = centavos(-diferencia);
    reembolso = { metodo, monto_usd: usd, monto_bs: esMetodoBolivares(metodo) ? convertirABs(usd, datos.tasa_cambio) : null };
  }

  // 3) Inventario. Primero lo que SALE (puede fallar por stock y entonces no se ha tocado nada más)
  const salidas: VentaItem[] = [];
  const motivoSalida = `Cambio de producto, venta #${venta.folio}`;
  for (const n of datos.nuevos) {
    try {
      await registrarMovimiento({ producto_id: n.producto_id, tipo: 'SALIDA', cantidad: n.cantidad, motivo: motivoSalida, local_id: venta.local_id });
      salidas.push(n);
    } catch (err) {
      // Deshace lo que alcanzó a salir para no dejar el inventario a medias
      for (const hecha of salidas) {
        await registrarMovimiento({ producto_id: hecha.producto_id, tipo: 'ENTRADA', cantidad: hecha.cantidad, motivo: 'Reverso: cambio de producto no completado', local_id: venta.local_id }).catch(() => undefined);
      }
      throw err;
    }
  }
  for (const d of itemsDevueltos) {
    await registrarMovimiento({ producto_id: d.producto_id, tipo: 'ENTRADA', cantidad: d.cantidad, motivo: `Devolución, venta #${venta.folio}`, local_id: venta.local_id }).catch((err) => {
      throw new Error(`No se pudo devolver "${d.nombre}" al inventario: ${err instanceof Error ? err.message : err}`);
    });
  }

  // 4) Registro
  const registro: NuevaDevolucion = {
    fecha: new Date().toISOString(),
    local_id: venta.local_id,
    venta_id: venta.id,
    venta_folio: venta.folio,
    motivo,
    items_devueltos: itemsDevueltos,
    items_nuevos: datos.nuevos,
    total_devuelto: totalDevuelto,
    total_nuevo: totalNuevo,
    diferencia,
    tasa_cambio: datos.tasa_cambio,
    pagos,
    vuelto,
    reembolso,
    registrado_nombre: datos.registrado_nombre ?? null,
  };
  try {
    if (!supabaseConfigurado) {
      const db = leerDB();
      const lista = db.devoluciones ?? (db.devoluciones = []);
      const devolucion: Devolucion = { ...registro, id: generarId(), folio: lista.reduce((m, d) => Math.max(m, d.folio), 0) + 1 };
      lista.unshift(devolucion);
      guardarDB(db);
      return devolucion;
    }
    return await devolucionesDb.insertarDevolucion(registro);
  } catch (err) {
    throw new Error(`El inventario ya se ajustó, pero no se pudo guardar el registro de la devolución: ${err instanceof Error ? err.message : err}`);
  }
}

// ----------------------------------------------------------------------------
// Servicio técnico: órdenes de servicio / reparaciones
//
// Una orden recibe el equipo del cliente y su falla, y pasa por Pendiente → En reparación → Listo →
// Entregado. Los repuestos salen del stock del local de servicio técnico como movimientos SALIDA
// (quedan en Movimientos como "Repuesto, orden #N"). Solo existen en locales de tipo servicio_tecnico.
// ----------------------------------------------------------------------------
export const ESTADOS_ORDEN: { valor: EstadoOrdenServicio; etiqueta: string }[] = [
  { valor: 'pendiente', etiqueta: 'Pendiente' },
  { valor: 'en_reparacion', etiqueta: 'En reparación' },
  { valor: 'listo', etiqueta: 'Listo' },
  { valor: 'entregado', etiqueta: 'Entregado' },
];

const LS_CACHE_ORDENES = 'easystem:cache:ordenes';

const totalDeOrden = (repuestos: RepuestoOrden[], manoDeObra: number): number =>
  Math.round((repuestos.reduce((suma, r) => suma + r.precio_unitario * r.cantidad, 0) + manoDeObra) * 100) / 100;

/** Órdenes del alcance activo (más nuevas primero). */
export async function listarOrdenesServicio(limite = 500): Promise<OrdenServicio[]> {
  const alcance = await alcanceActual();
  const delAlcance = (o: OrdenServicio) => alcance.todos || o.local_id === alcance.localId;
  const masNuevasPrimero = (a: OrdenServicio, b: OrdenServicio) => new Date(b.recibida_en).getTime() - new Date(a.recibida_en).getTime();

  if (!supabaseConfigurado) return (leerDB().ordenes ?? []).filter(delAlcance).sort(masNuevasPrimero).slice(0, limite);

  try {
    const ordenes = await ordenesDb.listarOrdenes({ limite, localId: alcance.localId });
    if (alcance.todos) guardarCache(LS_CACHE_ORDENES, ordenes);
    return ordenes;
  } catch (err) {
    if (!esErrorDeRed(err)) throw err;
    console.warn('[EASYSTEM] Sin conexión con Supabase; usando las órdenes de servicio guardadas localmente.', err);
    return (leerCache<OrdenServicio[]>(LS_CACHE_ORDENES) ?? []).filter(delAlcance).slice(0, limite);
  }
}

async function obtenerOrdenServicio(id: string): Promise<OrdenServicio> {
  const orden = supabaseConfigurado
    ? await ordenesDb.obtenerOrden(id)
    : ((leerDB().ordenes ?? []).find((o) => o.id === id) ?? null);
  if (!orden) throw new Error('Orden de servicio no encontrada.');
  return orden;
}

/** Guarda cambios de una orden (en LocalStorage también pone las marcas de tiempo que en Supabase pone un trigger). */
async function guardarCambiosOrden(orden: OrdenServicio, cambios: Partial<OrdenServicio>): Promise<OrdenServicio> {
  const ahora = new Date().toISOString();
  const nuevo: Partial<OrdenServicio> = { ...cambios };
  const repuestos = cambios.repuestos ?? orden.repuestos;
  const mano = cambios.mano_de_obra_usd ?? orden.mano_de_obra_usd;
  nuevo.total_usd = totalDeOrden(repuestos, mano);

  if (supabaseConfigurado) return ordenesDb.actualizarOrden(orden.id, nuevo);

  const db = leerDB();
  const guardada = (db.ordenes ?? []).find((o) => o.id === orden.id);
  if (!guardada) throw new Error('Orden de servicio no encontrada.');
  Object.assign(guardada, nuevo, { actualizada_en: ahora });
  if (nuevo.estado === 'listo' && orden.estado !== 'listo') guardada.listo_en = ahora;
  if (nuevo.estado === 'entregado' && orden.estado !== 'entregado') {
    guardada.entregada_en = ahora;
    guardada.listo_en = guardada.listo_en ?? ahora;
  }
  guardarDB(db);
  return guardada;
}

export interface DatosNuevaOrden {
  cliente_cedula: string;
  cliente_nombre: string;
  cliente_telefono: string;
  equipo_marca: string;
  equipo_modelo: string;
  equipo_imei?: string | null;
  accesorios_recibidos?: string | null;
  falla_reportada: string;
  registrado_nombre?: string | null;
}

/** Recibe un equipo: crea la orden en estado Pendiente en el local de servicio técnico activo. */
export async function crearOrdenServicio(datos: DatosNuevaOrden): Promise<OrdenServicio> {
  const local_id = await exigirLocal('recibir un equipo');
  const contexto = await obtenerContextoLocal();
  const local = contexto?.locales.find((l) => l.id === local_id);
  if (local?.tipo !== 'servicio_tecnico') {
    throw new Error('Las órdenes de servicio solo se registran en el Local Servicio Técnico: elígelo en el selector del encabezado.');
  }

  const texto = (v: string | null | undefined) => (v ?? '').trim().replace(/\s+/g, ' ');
  const registro: NuevaOrdenServicio = {
    local_id,
    cliente_cedula: texto(datos.cliente_cedula),
    cliente_nombre: texto(datos.cliente_nombre),
    cliente_telefono: texto(datos.cliente_telefono),
    equipo_marca: texto(datos.equipo_marca),
    equipo_modelo: texto(datos.equipo_modelo),
    equipo_imei: texto(datos.equipo_imei) || null,
    accesorios_recibidos: texto(datos.accesorios_recibidos) || null,
    falla_reportada: texto(datos.falla_reportada),
    registrado_nombre: datos.registrado_nombre ?? null,
  };
  if (!registro.cliente_cedula || !registro.cliente_nombre || !registro.cliente_telefono) throw new Error('Faltan datos del cliente (cédula, nombre y teléfono).');
  if (!registro.equipo_marca || !registro.equipo_modelo) throw new Error('Indica la marca y el modelo del equipo.');
  if (registro.falla_reportada.length < 3) throw new Error('Describe la falla que reporta el cliente.');

  if (supabaseConfigurado) return ordenesDb.insertarOrden(registro);

  const db = leerDB();
  const ordenes = db.ordenes ?? (db.ordenes = []);
  const ahora = new Date().toISOString();
  const orden: OrdenServicio = {
    ...registro,
    id: generarId(),
    folio: ordenes.reduce((m, o) => Math.max(m, o.folio), 0) + 1,
    diagnostico: null,
    estado: 'pendiente',
    tecnico_id: null,
    tecnico_nombre: null,
    repuestos: [],
    mano_de_obra_usd: 0,
    total_usd: 0,
    recibida_en: ahora,
    actualizada_en: ahora,
    listo_en: null,
    entregada_en: null,
  };
  ordenes.unshift(orden);
  guardarDB(db);
  return orden;
}

/** Cambia el estado, el diagnóstico, la mano de obra o el técnico de una orden. Una orden Entregada ya no se modifica. */
export async function actualizarOrdenServicio(
  id: string,
  cambios: { estado?: EstadoOrdenServicio; diagnostico?: string | null; mano_de_obra_usd?: number; tecnico_id?: string | null; tecnico_nombre?: string | null }
): Promise<OrdenServicio> {
  const orden = await obtenerOrdenServicio(id);
  if (orden.estado === 'entregado') throw new Error('Esa orden ya fue entregada y no se puede modificar.');
  if (cambios.mano_de_obra_usd !== undefined && !(cambios.mano_de_obra_usd >= 0)) throw new Error('La mano de obra debe ser 0 o más.');
  return guardarCambiosOrden(orden, cambios);
}

/** Descuenta un repuesto del stock del local de la orden y lo suma a la orden (si ya estaba, suma la cantidad). */
export async function agregarRepuestoOrden(
  id: string,
  producto: { id: string; nombre: string; codigo_barras: string; precio_venta: number },
  cantidad: number
): Promise<OrdenServicio> {
  if (!Number.isInteger(cantidad) || cantidad <= 0) throw new Error('La cantidad del repuesto debe ser un número entero mayor a 0.');
  const orden = await obtenerOrdenServicio(id);
  if (orden.estado === 'entregado') throw new Error('Esa orden ya fue entregada y no se puede modificar.');

  // Primero el stock (falla si no alcanza); después se anota en la orden
  await registrarMovimiento({
    producto_id: producto.id,
    tipo: 'SALIDA',
    cantidad,
    motivo: `Repuesto, orden de servicio #${orden.folio}`,
    local_id: orden.local_id,
  });

  const repuestos = orden.repuestos.map((r) => ({ ...r }));
  const existente = repuestos.find((r) => r.producto_id === producto.id);
  if (existente) existente.cantidad += cantidad;
  else repuestos.push({ producto_id: producto.id, nombre: producto.nombre, codigo_barras: producto.codigo_barras, cantidad, precio_unitario: producto.precio_venta });

  try {
    return await guardarCambiosOrden(orden, { repuestos });
  } catch (err) {
    throw new Error(`El repuesto salió del inventario, pero no se pudo anotar en la orden: ${err instanceof Error ? err.message : err}`);
  }
}

/** Quita un repuesto de la orden y lo regresa al stock del local (es una ENTRADA: administrador o encargado). */
export async function quitarRepuestoOrden(id: string, productoId: string): Promise<OrdenServicio> {
  const orden = await obtenerOrdenServicio(id);
  if (orden.estado === 'entregado') throw new Error('Esa orden ya fue entregada y no se puede modificar.');
  const repuesto = orden.repuestos.find((r) => r.producto_id === productoId);
  if (!repuesto) throw new Error('Ese repuesto no está en la orden.');

  await registrarMovimiento({
    producto_id: productoId,
    tipo: 'ENTRADA',
    cantidad: repuesto.cantidad,
    motivo: `Repuesto devuelto al inventario, orden de servicio #${orden.folio}`,
    local_id: orden.local_id,
  });
  return guardarCambiosOrden(orden, { repuestos: orden.repuestos.filter((r) => r.producto_id !== productoId) });
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
  // La cantidad y el mínimo del archivo son los de UN local: el activo
  const local_id = await exigirLocal('importar productos (el stock del archivo se carga en ese local)');

  if (!supabaseConfigurado) {
    const db = leerDB();
    const codigos = new Set(db.productos.map((p) => p.codigo_barras));
    const repetido = nuevas.find((f) => codigos.has(f.codigo_barras));
    if (repetido) throw new Error(`El código ${repetido.codigo_barras} ya existe en el inventario.`);

    const ahora = new Date().toISOString();
    const filaInventario = (productoId: string) => {
      let fila = db.inventario.find((i) => i.local_id === local_id && i.producto_id === productoId);
      if (!fila) {
        fila = { local_id, producto_id: productoId, stock_actual: 0, stock_minimo: 0 };
        db.inventario.push(fila);
      }
      return fila;
    };
    const mover = (producto: Producto, tipo: TipoMovimiento, cantidad: number, motivo: string) => {
      const delta = tipo === 'ENTRADA' ? cantidad : -cantidad;
      filaInventario(producto.id).stock_actual += delta;
      producto.stock_actual += delta;
      db.movimientos.unshift({ id: generarId(), producto_id: producto.id, tipo, cantidad, motivo, fecha: ahora, local_id });
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
      filaInventario(producto.id).stock_minimo = f.stock_minimo ?? 0;
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
      if (f.stock_minimo !== null) {
        producto.stock_minimo = f.stock_minimo;
        filaInventario(producto.id).stock_minimo = f.stock_minimo;
      }
      if (f.modeloIds !== null) {
        db.compatibilidades = db.compatibilidades.filter((c) => c.producto_id !== producto.id);
        for (const modelo_id of f.modeloIds) db.compatibilidades.push({ id: generarId(), producto_id: producto.id, modelo_id });
      }
      // La cantidad del archivo se compara con el stock de ESTE local
      const actual = db.inventario.find((i) => i.local_id === local_id && i.producto_id === producto.id)?.stock_actual ?? 0;
      if (f.stock_objetivo !== null && f.stock_objetivo !== actual) {
        const delta = f.stock_objetivo - actual;
        mover(producto, delta > 0 ? 'ENTRADA' : 'SALIDA', Math.abs(delta), MOTIVO_AJUSTE);
      }
      resultado.actualizados++;
    }

    guardarDB(db);
    return resultado;
  }

  // --- Supabase ---
  const stockActual = new Map(
    (await productosDb.listarProductos()).map((p) => [p.id, p.inventario.find((i) => i.local_id === local_id)?.stock_actual ?? 0])
  );
  const movimientos: { producto_id: string; tipo: TipoMovimiento; cantidad: number; motivo: string; local_id: string }[] = [];
  const pares: { producto_id: string; modelo_id: string }[] = [];
  // Productos que el local pasa a manejar, con su mínimo (null = no se cambia)
  const inventario: { producto_id: string; stock_minimo: number | null }[] = [];

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
      inventario.push({ producto_id: id, stock_minimo: f.stock_minimo ?? 0 });
      for (const modelo_id of f.modeloIds ?? []) pares.push({ producto_id: id, modelo_id });
      if ((f.stock_objetivo ?? 0) > 0) {
        movimientos.push({ producto_id: id, tipo: 'ENTRADA', cantidad: f.stock_objetivo!, motivo: MOTIVO_CARGA_INICIAL, local_id });
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
        inventario.push({ producto_id: f.productoId!, stock_minimo: f.stock_minimo });

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
            local_id,
          });
        }
        resultado.actualizados++;
      })
    );
  }

  if (pares.length > 0 || idsConCompatibilidad.length > 0) {
    await productosDb.reemplazarCompatibilidadesLote(pares, idsConCompatibilidad);
  }
  // El local pasa a manejar lo importado (con su mínimo si el archivo lo trae); el stock llega por movimientos
  const conMinimo = inventario.filter((i) => i.stock_minimo !== null) as { producto_id: string; stock_minimo: number }[];
  if (conMinimo.length > 0) await productosDb.fijarMinimosLote(local_id, conMinimo);
  const sinMinimo = inventario.filter((i) => i.stock_minimo === null).map((i) => i.producto_id);
  if (sinMinimo.length > 0) await productosDb.asegurarEnLocal(local_id, sinMinimo);
  if (movimientos.length > 0) {
    await movimientosDb.registrarMovimientosLote(movimientos);
    resultado.movimientos = movimientos.length;
  }

  return resultado;
}

// ----------------------------------------------------------------------------
// Nómina y gestión de personal (administrador, gerente y contador; migración 0027)
// ----------------------------------------------------------------------------
// Empleados por local y un pago por empleado y quincena: pago_base (= salario / 2) + bonos - deducciones.
// La base de datos (RLS) es quien niega el acceso a encargado, vendedor y técnico; aquí además se corta en LocalStorage.
// Requiere conexión cuando hay Supabase (no se encola sin conexión: son pagos reales).

async function exigirAccesoNomina(): Promise<void> {
  const rol = (await obtenerSesionActual())?.rol;
  if (rol !== 'administrador' && rol !== 'gerente' && rol !== 'contador') {
    throw new Error('Tu rol no tiene acceso a la nómina.');
  }
}

const textoLimpio = (v: string | null | undefined) => (v ?? '').trim().replace(/\s+/g, ' ');

export async function listarEmpleados(): Promise<Empleado[]> {
  await exigirAccesoNomina();
  if (supabaseConfigurado) return nominaDb.listarEmpleados();
  return [...(leerDB().empleados ?? [])].sort((a, b) => a.apellido.localeCompare(b.apellido, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
}

function validarEmpleado(d: Partial<NuevoEmpleado>, completo: boolean) {
  if (completo || d.nombre !== undefined) if (!textoLimpio(d.nombre)) throw new Error('El nombre es obligatorio.');
  if (completo || d.apellido !== undefined) if (!textoLimpio(d.apellido)) throw new Error('El apellido es obligatorio.');
  if (completo || d.cedula !== undefined) if (textoLimpio(d.cedula).length < 5) throw new Error('La cédula debe tener al menos 5 caracteres.');
  if (completo || d.cargo !== undefined) if (!textoLimpio(d.cargo)) throw new Error('El cargo es obligatorio.');
  if (completo || d.salario_base !== undefined) if (!(Number(d.salario_base) >= 0)) throw new Error('El salario debe ser un monto mayor o igual a 0.');
  if (completo && !d.local_id) throw new Error('Elige el local del empleado.');
}

function limpiarEmpleado<T extends Partial<NuevoEmpleado>>(d: T): T {
  const copia: Partial<NuevoEmpleado> = { ...d };
  if (copia.nombre !== undefined) copia.nombre = textoLimpio(copia.nombre);
  if (copia.apellido !== undefined) copia.apellido = textoLimpio(copia.apellido);
  if (copia.cedula !== undefined) copia.cedula = textoLimpio(copia.cedula).toUpperCase();
  if (copia.cargo !== undefined) copia.cargo = textoLimpio(copia.cargo);
  if (copia.salario_base !== undefined) copia.salario_base = Math.round(Number(copia.salario_base) * 100) / 100;
  return copia as T;
}

export async function crearEmpleado(datos: NuevoEmpleado): Promise<Empleado> {
  await exigirAccesoNomina();
  validarEmpleado(datos, true);
  const limpio = limpiarEmpleado(datos);

  if (supabaseConfigurado) return nominaDb.crearEmpleado(limpio);

  const db = leerDB();
  const empleados = db.empleados ?? (db.empleados = []);
  if (empleados.some((e) => e.cedula.toLowerCase() === limpio.cedula.toLowerCase())) {
    throw new Error(`Ya existe un empleado con la cédula ${limpio.cedula}.`);
  }
  const empleado: Empleado = {
    id: generarId(),
    frecuencia_pago: 'QUINCENAL',
    estado: 'ACTIVO',
    fecha_ingreso: fechaLocalISO(new Date()),
    created_at: new Date().toISOString(),
    ...limpio,
  };
  empleados.push(empleado);
  guardarDB(db);
  return empleado;
}

export async function actualizarEmpleado(id: string, cambios: Partial<NuevoEmpleado>): Promise<Empleado> {
  await exigirAccesoNomina();
  validarEmpleado(cambios, false);
  const limpio = limpiarEmpleado(cambios);

  if (supabaseConfigurado) return nominaDb.actualizarEmpleado(id, limpio);

  const db = leerDB();
  const empleado = (db.empleados ?? []).find((e) => e.id === id);
  if (!empleado) throw new Error('Empleado no encontrado.');
  if (limpio.cedula && (db.empleados ?? []).some((e) => e.id !== id && e.cedula.toLowerCase() === limpio.cedula!.toLowerCase())) {
    throw new Error(`Ya existe otro empleado con la cédula ${limpio.cedula}.`);
  }
  Object.assign(empleado, limpio);
  guardarDB(db);
  return empleado;
}

/** Pagos de una quincena (período "aaaa-mm-dd" a "aaaa-mm-dd") de todos los locales. */
export async function listarNominas(periodoInicio: string, periodoFin: string): Promise<Nomina[]> {
  await exigirAccesoNomina();
  if (supabaseConfigurado) return nominaDb.listarNominas(periodoInicio, periodoFin);
  return (leerDB().nominas ?? []).filter((n) => n.periodo_inicio >= periodoInicio && n.periodo_fin <= periodoFin);
}

export interface DatosPagoQuincenal {
  empleado: Empleado;
  periodo: { inicio: string; fin: string };
  bonos: number;
  deducciones: number;
  notas?: string | null;
  /** true = registra el pago como PAGADO; false = lo deja PENDIENTE */
  pagar: boolean;
  /** Captura del pago (opcional), ya reducida; reemplaza a la que hubiera */
  comprobante?: Blob | null;
  /** Quita la captura que tenía el pago pendiente */
  quitarComprobante?: boolean;
  /** Pago pendiente ya generado para ese empleado y período (se actualiza en vez de crear otro) */
  existente?: Nomina | null;
}

/** Crea o ajusta el pago de un empleado en una quincena. Un pago PAGADO ya no se modifica. */
export async function guardarPagoQuincenal(datos: DatosPagoQuincenal): Promise<Nomina> {
  await exigirAccesoNomina();
  const { empleado, periodo, existente } = datos;
  if (existente?.estado_pago === 'PAGADO') throw new Error('Ese pago ya está registrado como PAGADO y no se puede modificar.');

  const bonos = Math.round(Number(datos.bonos || 0) * 100) / 100;
  const deducciones = Math.round(Number(datos.deducciones || 0) * 100) / 100;
  const pago_base = pagoBaseQuincenal(empleado.salario_base);
  const errorAjustes = validarAjustes(pago_base, bonos, deducciones);
  if (errorAjustes) throw new Error(errorAjustes);

  const campos: nominaDb.DatosNomina = {
    empleado_id: empleado.id,
    local_id: empleado.local_id,
    periodo_inicio: periodo.inicio,
    periodo_fin: periodo.fin,
    pago_base,
    bonos,
    deducciones,
    total_pagado: totalPago(pago_base, bonos, deducciones),
    estado_pago: datos.pagar ? ('PAGADO' as const) : ('PENDIENTE' as const),
    notas: textoLimpio(datos.notas) || null,
  };

  if (supabaseConfigurado) {
    // La captura va primero al almacenamiento privado; si luego falla el guardado del pago, se borra para no dejar huérfanos
    let rutaNueva: string | null = null;
    if (datos.comprobante) rutaNueva = await nominaDb.subirComprobante(empleado.local_id, empleado.id, periodo.inicio, datos.comprobante);
    campos.comprobante_path = rutaNueva ?? (datos.quitarComprobante ? null : (existente?.comprobante_path ?? null));
    try {
      const guardada = existente ? await nominaDb.actualizarNomina(existente.id, campos) : (await nominaDb.insertarNominas([campos]))[0];
      // Se reemplazó o quitó la captura anterior: se limpia (best-effort)
      if (existente?.comprobante_path && existente.comprobante_path !== guardada.comprobante_path) {
        nominaDb.eliminarComprobante(existente.comprobante_path).catch(() => {});
      }
      return guardada;
    } catch (err) {
      nominaDb.eliminarComprobante(rutaNueva).catch(() => {});
      throw err;
    }
  }

  const db = leerDB();
  const nominas = db.nominas ?? (db.nominas = []);
  const actual = existente ? nominas.find((n) => n.id === existente.id) : nominas.find((n) => n.empleado_id === empleado.id && n.periodo_inicio === periodo.inicio && n.periodo_fin === periodo.fin);
  if (actual?.estado_pago === 'PAGADO') throw new Error('Ese pago ya está registrado como PAGADO y no se puede modificar.');
  const pagado_en = datos.pagar ? new Date().toISOString() : null;
  // En LocalStorage la captura se guarda como data URL dentro del pago (el cupo del navegador es pequeño: se avisa si no cabe)
  const comprobante_path = datos.comprobante ? await blobADataUrl(datos.comprobante) : datos.quitarComprobante ? null : (actual?.comprobante_path ?? existente?.comprobante_path ?? null);

  if (actual) {
    const anterior = { ...actual };
    Object.assign(actual, campos, { pagado_en, comprobante_path });
    try {
      guardarDBEstricto(db);
    } catch (err) {
      Object.assign(actual, anterior);
      throw err;
    }
    return actual;
  }
  const nueva: Nomina = { id: generarId(), ...campos, comprobante_path, pagado_en, created_at: new Date().toISOString() };
  nominas.push(nueva);
  try {
    guardarDBEstricto(db);
  } catch (err) {
    nominas.pop();
    throw err;
  }
  return nueva;
}

/** Enlace para ver la captura de un pago: temporal si está en Supabase (bucket privado); en LocalStorage, un enlace local. */
export async function urlComprobanteNomina(ruta: string): Promise<string> {
  await exigirAccesoNomina();
  if (ruta.startsWith('data:')) {
    // Los navegadores no abren data: URLs en pestañas nuevas: se convierte en un enlace de objeto
    return URL.createObjectURL(await (await fetch(ruta)).blob());
  }
  return nominaDb.urlComprobante(ruta);
}

/** Genera el pago PENDIENTE (sin bonos ni deducciones) de los empleados activos que aún no lo tienen. Devuelve cuántos creó. */
export async function generarPagosPendientes(empleados: Empleado[], periodo: { inicio: string; fin: string }): Promise<number> {
  await exigirAccesoNomina();
  const existentes = await listarNominas(periodo.inicio, periodo.fin);
  const conPago = new Set(existentes.map((n) => n.empleado_id));
  const faltantes = empleados.filter((e) => e.estado === 'ACTIVO' && !conPago.has(e.id));
  if (faltantes.length === 0) return 0;

  const filas = faltantes.map((e) => {
    const pago_base = pagoBaseQuincenal(e.salario_base);
    return {
      empleado_id: e.id,
      local_id: e.local_id,
      periodo_inicio: periodo.inicio,
      periodo_fin: periodo.fin,
      pago_base,
      bonos: 0,
      deducciones: 0,
      total_pagado: pago_base,
      estado_pago: 'PENDIENTE' as const,
      notas: null,
      comprobante_path: null,
    };
  });

  if (supabaseConfigurado) {
    await nominaDb.insertarNominas(filas);
    return filas.length;
  }

  const db = leerDB();
  const nominas = db.nominas ?? (db.nominas = []);
  const ahora = new Date().toISOString();
  for (const f of filas) nominas.push({ id: generarId(), ...f, comprobante_path: null, pagado_en: null, created_at: ahora });
  guardarDB(db);
  return filas.length;
}

/** Borra un pago PENDIENTE (uno PAGADO no se borra). */
export async function eliminarPagoPendiente(id: string): Promise<void> {
  await exigirAccesoNomina();
  if (supabaseConfigurado) return nominaDb.eliminarNomina(id);

  const db = leerDB();
  const nominas = db.nominas ?? [];
  const nomina = nominas.find((n) => n.id === id);
  if (!nomina) return;
  if (nomina.estado_pago === 'PAGADO') throw new Error('Un pago PAGADO no se puede borrar.');
  db.nominas = nominas.filter((n) => n.id !== id);
  guardarDB(db);
}
