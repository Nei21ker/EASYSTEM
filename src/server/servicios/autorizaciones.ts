// Precio de promotor: autorización de un supervisor para vender a un precio MAYOR al del catálogo.
//
// El cliente paga, por ejemplo, $15 por un control de lista $12; los $3 de diferencia son la comisión del promotor (un trabajador
// independiente) y la tienda se la paga aparte. La venta guarda lo que de verdad se cobró ($15), el precio de lista ($12) y la comisión.
//
// Quien puede autorizar: encargado del local, gerente y administrador, con SU contraseña de ingreso al sistema (se teclea en el equipo
// de quien vende). El servidor la verifica y devuelve una autorización firmada (HMAC, 20 minutos) atada a quien vende, el local, el
// promotor y los precios exactos: no sirve para otro vendedor, otro precio ni otro promotor, y no se puede alterar. `guardarVenta` la
// exige para cualquier línea cuyo precio no sea el del catálogo.
import { localAccesible, type Sesion } from '../authz';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';
import { hashearClave, verificarClave } from '../password';
import { redondear2 } from '../util';
import type { AutorizacionPrecio, Promotor } from '../../types/database.types';

export const VIDA_AUTORIZACION_MS = 20 * 60_000;
const MAX_FALLOS = 5;
const VENTANA_FALLOS_MS = 15 * 60_000;
const TOLERANCIA = 0.005;

/** Lo que firma la autorización (claves cortas para que el token sea pequeño). */
export interface CargaAutorizacion {
  v: 1;
  /** Quien vende (sesión que la pidió) */
  u: string;
  /** Supervisor que autorizó: id y nombre */
  a: string;
  an: string;
  /** Local */
  l: string;
  /** Promotor: id y nombre */
  p: string;
  pn: string;
  /** [producto_id, precio autorizado] */
  ln: [string, number][];
  /** Vence (ms desde 1970) */
  exp: number;
}

// --- Firma ---------------------------------------------------------------------------------------------------
const aBase64Url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function deBase64Url(texto: string): Uint8Array | null {
  try {
    const normal = texto.replace(/-/g, '+').replace(/_/g, '/');
    const binario = atob(normal + '='.repeat((4 - (normal.length % 4)) % 4));
    return Uint8Array.from(binario, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function claveFirma(env: Entorno): Promise<CryptoKey> {
  // Se separa el uso de la clave: lo firmado aquí no vale para ninguna otra cosa que firme el sistema con el mismo secreto
  return crypto.subtle.importKey('raw', new TextEncoder().encode(`autorizacion-precio:${env.BETTER_AUTH_SECRET}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function firmarAutorizacion(env: Entorno, carga: CargaAutorizacion): Promise<string> {
  const cuerpo = aBase64Url(new TextEncoder().encode(JSON.stringify(carga)));
  const firma = await crypto.subtle.sign('HMAC', await claveFirma(env), new TextEncoder().encode(cuerpo));
  return `${cuerpo}.${aBase64Url(new Uint8Array(firma))}`;
}

export type ResultadoVerificacion = { ok: true; carga: CargaAutorizacion } | { ok: false; motivo: 'invalida' | 'vencida' };

export async function verificarAutorizacion(env: Entorno, token: string): Promise<ResultadoVerificacion> {
  const [cuerpo, firma, sobra] = token.split('.');
  if (!cuerpo || !firma || sobra !== undefined) return { ok: false, motivo: 'invalida' };
  const firmaBytes = deBase64Url(firma);
  if (!firmaBytes) return { ok: false, motivo: 'invalida' };
  const valida = await crypto.subtle.verify('HMAC', await claveFirma(env), firmaBytes as BufferSource, new TextEncoder().encode(cuerpo));
  if (!valida) return { ok: false, motivo: 'invalida' };
  const bytes = deBase64Url(cuerpo);
  if (!bytes) return { ok: false, motivo: 'invalida' };
  let carga: CargaAutorizacion;
  try {
    carga = JSON.parse(new TextDecoder().decode(bytes)) as CargaAutorizacion;
  } catch {
    return { ok: false, motivo: 'invalida' };
  }
  if (carga.v !== 1 || !Array.isArray(carga.ln) || typeof carga.exp !== 'number') return { ok: false, motivo: 'invalida' };
  if (carga.exp < Date.now()) return { ok: false, motivo: 'vencida' };
  return { ok: true, carga };
}

// --- Promotores ----------------------------------------------------------------------------------------------
interface FilaPromotor {
  id: string;
  nombre: string;
}

/** Promotores de un local: los trabajadores independientes ACTIVOS. Los ve quien vende (la nómina completa es solo de gerencia/contador). */
export async function listarPromotores(env: Entorno, sesion: Sesion, localId: string): Promise<Promotor[]> {
  if (!(await localAccesible(env, sesion, localId))) throw new ErrorApi(403, 'No tienes acceso a ese local.', 'sin_permiso');
  const filas = await env.DB
    .prepare("SELECT id, trim(nombre || ' ' || apellido) AS nombre FROM empleados WHERE local_id = ? AND tipo = 'INDEPENDIENTE' AND estado = 'ACTIVO' ORDER BY nombre COLLATE NOCASE")
    .bind(localId)
    .all<FilaPromotor>();
  return filas.results.map((f) => ({ id: f.id, nombre: f.nombre }));
}

/** El promotor debe ser un trabajador independiente activo de ESE local; devuelve su nombre. */
export async function validarPromotor(env: Entorno, promotorId: string, localId: string): Promise<string> {
  const fila = await env.DB
    .prepare("SELECT trim(nombre || ' ' || apellido) AS nombre FROM empleados WHERE id = ? AND local_id = ? AND tipo = 'INDEPENDIENTE' AND estado = 'ACTIVO'")
    .bind(promotorId, localId)
    .first<{ nombre: string }>();
  if (!fila) throw new ErrorApi(400, 'Elige un promotor activo de este local.', 'promotor_invalido');
  return fila.nombre;
}

// --- Supervisor ----------------------------------------------------------------------------------------------
interface FilaSupervisor {
  id: string;
  nombre: string;
  rol: string;
  local_id: string | null;
  status: string;
  password: string | null;
}

const credencialesInvalidas = () => new ErrorApi(403, 'Correo o contraseña no válidos, o esa persona no puede autorizar precios en este local.', 'autorizador_invalido');

/** ¿Puede esta persona autorizar precios en ese local? Encargado del local, gerente o administrador, con la cuenta activa. */
function puedeAutorizar(f: Pick<FilaSupervisor, 'rol' | 'local_id' | 'status'>, localId: string): boolean {
  if (f.status !== 'active') return false;
  return f.rol === 'administrador' || f.rol === 'gerente' || (f.rol === 'encargado' && f.local_id === localId);
}

/** Vuelve a mirar, al cobrar, que quien autorizó siga pudiendo hacerlo (no lo desactivaron ni lo cambiaron de local en esos minutos). */
async function supervisorSigueVigente(env: Entorno, supervisorId: string, localId: string): Promise<boolean> {
  const f = await env.DB.prepare('SELECT rol, local_id, status FROM perfiles WHERE id = ?').bind(supervisorId).first<Pick<FilaSupervisor, 'rol' | 'local_id' | 'status'>>();
  return !!f && puedeAutorizar(f, localId);
}

// --- Tope de intentos ----------------------------------------------------------------------------------------
// Se cuenta por quien vende (no por el supervisor): un vendedor no puede probar contraseñas a ciegas, y los fallos de uno no bloquean a otro.
const claveIntentos = (userId: string) => `precio-auth:${userId}`;

async function exigirIntentosDisponibles(env: Entorno, userId: string): Promise<void> {
  const fila = await env.DB.prepare('SELECT count, lastRequest FROM rateLimit WHERE key = ?').bind(claveIntentos(userId)).first<{ count: number; lastRequest: number }>();
  if (fila && fila.count >= MAX_FALLOS && Date.now() - fila.lastRequest < VENTANA_FALLOS_MS) {
    throw new ErrorApi(429, 'Demasiados intentos fallidos. Espera unos minutos o pídele al encargado que cambie el precio.', 'demasiados_intentos');
  }
}

async function anotarFallo(env: Entorno, userId: string): Promise<void> {
  const ahora = Date.now();
  const clave = claveIntentos(userId);
  await env.DB
    .prepare(
      `INSERT INTO rateLimit (id, key, count, lastRequest) VALUES (?, ?, 1, ?)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN ? - lastRequest < ? THEN count + 1 ELSE 1 END,
         lastRequest = ?`
    )
    .bind(clave, clave, ahora, ahora, VENTANA_FALLOS_MS, ahora)
    .run();
}

async function borrarFallos(env: Entorno, userId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM rateLimit WHERE key = ?').bind(claveIntentos(userId)).run();
}

// --- Pedir la autorización -----------------------------------------------------------------------------------
export interface PedidoAutorizacion {
  email: string;
  clave: string;
  local_id: string;
  promotor_id: string;
  lineas: { producto_id: string; precio: number }[];
}

export async function autorizarPrecio(env: Entorno, sesion: Sesion, pedido: PedidoAutorizacion): Promise<AutorizacionPrecio> {
  if (!(await localAccesible(env, sesion, pedido.local_id))) throw new ErrorApi(403, 'No tienes acceso a ese local.', 'sin_permiso');

  // Primero lo que se pide (no cuenta como intento fallido): el promotor y los precios
  const promotor = await validarPromotor(env, pedido.promotor_id, pedido.local_id);
  if (!Array.isArray(pedido.lineas) || pedido.lineas.length === 0) throw new ErrorApi(400, 'No hay precios que autorizar.', 'datos_invalidos');
  const vistos = new Set<string>();
  for (const l of pedido.lineas) {
    if (vistos.has(l.producto_id)) throw new ErrorApi(400, 'Un producto aparece dos veces en la autorización.', 'datos_invalidos');
    vistos.add(l.producto_id);
    if (!Number.isFinite(l.precio) || l.precio <= 0 || l.precio > 100_000) throw new ErrorApi(400, 'El precio indicado no es válido.', 'datos_invalidos');
  }
  const ids = [...vistos];
  const productos = await env.DB
    .prepare(`SELECT id, nombre, precio_venta FROM productos WHERE id IN (${ids.map(() => '?').join(', ')})`)
    .bind(...ids)
    .all<{ id: string; nombre: string; precio_venta: number }>();
  const lista = new Map(productos.results.map((p) => [p.id, p]));
  for (const l of pedido.lineas) {
    const producto = lista.get(l.producto_id);
    if (!producto) throw new ErrorApi(400, 'Uno de los productos no existe en el catálogo.', 'datos_invalidos');
    if (l.precio < producto.precio_venta - TOLERANCIA) {
      throw new ErrorApi(400, `El precio de «${producto.nombre}» no puede ser menor al precio de lista ($${producto.precio_venta.toFixed(2)}).`, 'precio_bajo_lista');
    }
  }

  // Luego, la persona que autoriza. Toda falla (correo desconocido, clave mala, rol sin permiso) da el MISMO mensaje y cuenta un intento.
  await exigirIntentosDisponibles(env, sesion.userId);
  const correo = pedido.email.trim().toLowerCase();
  const supervisor = await env.DB
    .prepare(
      `SELECT p.id, p.nombre, p.rol, p.local_id, p.status, a.password
         FROM perfiles p LEFT JOIN account a ON a.userId = p.id AND a.providerId = 'credential'
        WHERE lower(p.email) = ?`
    )
    .bind(correo)
    .first<FilaSupervisor>();
  // Sin cuenta se hace igual el cálculo del hash, para no delatar por el tiempo qué correos existen
  const claveCorrecta = supervisor?.password ? await verificarClave(pedido.clave, supervisor.password) : (await hashearClave(pedido.clave), false);
  if (!supervisor || !claveCorrecta || !puedeAutorizar(supervisor, pedido.local_id)) {
    await anotarFallo(env, sesion.userId);
    throw credencialesInvalidas();
  }
  await borrarFallos(env, sesion.userId);

  const vence = Date.now() + VIDA_AUTORIZACION_MS;
  const token = await firmarAutorizacion(env, {
    v: 1,
    u: sesion.userId,
    a: supervisor.id,
    an: supervisor.nombre,
    l: pedido.local_id,
    p: pedido.promotor_id,
    pn: promotor,
    ln: pedido.lineas.map((l) => [l.producto_id, redondear2(l.precio)]),
    exp: vence,
  });
  return { token, vence_en: vence, autorizado_por: supervisor.nombre, promotor };
}

// --- Usar la autorización al registrar la venta --------------------------------------------------------------
export interface PrecioPromotorVerificado {
  promotor_id: string;
  promotor_nombre: string;
  autorizado_por: string;
  autorizado_nombre: string;
}

const sinAutorizacion = (detalle = 'Pide la autorización de un encargado, gerente o administrador.') =>
  new ErrorApi(400, `El precio no está autorizado. ${detalle}`, 'precio_no_autorizado');

/**
 * Comprueba la autorización de una venta con líneas a un precio distinto al del catálogo. `desviadas` = [producto_id, precio cobrado].
 * Lanza 400 si falta, está alterada, vencida o no corresponde a esta venta (otro vendedor, local, promotor o precio).
 */
export async function verificarPrecioPromotor(
  env: Entorno,
  sesion: Sesion,
  datos: { local_id: string; promotor_id?: string | null; autorizacion_precio?: string | null },
  desviadas: [string, number][]
): Promise<PrecioPromotorVerificado> {
  const token = (datos.autorizacion_precio ?? '').trim();
  if (!token) throw sinAutorizacion();
  if (!datos.promotor_id) throw new ErrorApi(400, 'Elige el promotor de esta venta.', 'promotor_requerido');

  const r = await verificarAutorizacion(env, token);
  if (!r.ok) {
    throw r.motivo === 'vencida'
      ? sinAutorizacion('La autorización venció (dura 20 minutos). Vuelve a pedirla.')
      : sinAutorizacion('La autorización no es válida. Vuelve a pedirla.');
  }
  const c = r.carga;
  if (c.u !== sesion.userId || c.l !== datos.local_id || c.p !== datos.promotor_id) {
    throw sinAutorizacion('Esa autorización es de otra venta, vendedor o promotor. Vuelve a pedirla.');
  }
  const autorizados = new Map(c.ln);
  for (const [productoId, cobrado] of desviadas) {
    const permitido = autorizados.get(productoId);
    if (permitido === undefined || Math.abs(permitido - cobrado) > TOLERANCIA) {
      throw sinAutorizacion('El precio cobrado no coincide con el autorizado. Vuelve a pedirla.');
    }
  }
  if (!(await supervisorSigueVigente(env, c.a, datos.local_id))) throw sinAutorizacion('Quien autorizó ya no puede hacerlo. Vuelve a pedirla.');
  const promotorNombre = await validarPromotor(env, datos.promotor_id, datos.local_id);
  return { promotor_id: datos.promotor_id, promotor_nombre: promotorNombre, autorizado_por: c.a, autorizado_nombre: c.an };
}
