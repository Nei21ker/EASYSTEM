// Precio modificado: autorización de un supervisor para vender a un precio MAYOR (precio de promotor) o MENOR (descuento) al del catálogo.
//
// El cliente paga, por ejemplo, $15 por un control de lista $12; los $3 de diferencia son la comisión del promotor (un trabajador
// independiente) y la tienda se la paga aparte. La venta guarda lo que de verdad se cobró ($15), el precio de lista ($12) y la comisión.
//
// Un precio MAYOR (promotor o del local) lo anota quien vende, sin contraseña. Un precio MENOR (descuento) lo autoriza solo el gerente o el administrador.
// (Antes un precio mayor lo autorizaba el encargado del local, el gerente o el administrador; esas contraseñas se siguen aceptando si un cliente anterior las manda.) Con SU contraseña de ingreso al sistema (se teclea en el equipo
// de quien vende). El servidor la verifica y devuelve una autorización firmada (HMAC, 20 minutos) atada a quien vende, el local, el
// promotor y los precios exactos: no sirve para otro vendedor, otro precio ni otro promotor, y no se puede alterar. `guardarVenta` la
// exige para cualquier línea cuyo precio no sea el del catálogo.
import { localAccesible, type Sesion } from '../authz';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';
import { hashearClave, verificarClave } from '../password';
import { redondear2 } from '../util';
import type { AutorizacionPrecio, DatosPromotor, ModoPrecio } from '../../types/database.types';
import { UMBRAL_CLAVE_DANADOS } from '../../utils/controlPorCantidad';
import { normalizarPromotor, type PromotorNormalizado } from '../../utils/promotor';

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
  /** Promotor: texto canónico de los datos que se anotaron (cédula, nombre, teléfono) y su nombre; ambos pueden ir vacíos */
  p: string;
  pn: string;
  /** [producto_id, precio autorizado] */
  ln: [string, number][];
  /** Modo: "local" = la tienda cambia el precio (sin promotor ni comisión); ausente o "promotor" = precio de promotor */
  m?: ModoPrecio;
  /** 1 = precio (de promotor o del local) anotado por quien vende, SIN contraseña de supervisor (solo precios MAYORES al del catálogo); `a`/`an` son quien vende */
  s?: 1;
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

/** Autorización para elegir a mano el código de una unidad (la etiqueta no se puede leer): atada a quien vende, el local y el producto. */
export interface CargaCodigoManual {
  v: 1;
  k: 'codigo';
  u: string;
  a: string;
  an: string;
  l: string;
  /** Producto cuyas unidades se pueden elegir a mano */
  pr: string;
  exp: number;
}

async function firmarCarga(env: Entorno, carga: object): Promise<string> {
  const cuerpo = aBase64Url(new TextEncoder().encode(JSON.stringify(carga)));
  const firma = await crypto.subtle.sign('HMAC', await claveFirma(env), new TextEncoder().encode(cuerpo));
  return `${cuerpo}.${aBase64Url(new Uint8Array(firma))}`;
}

export const firmarAutorizacion = (env: Entorno, carga: CargaAutorizacion): Promise<string> => firmarCarga(env, carga);

type ResultadoCarga = { ok: true; carga: Record<string, unknown> } | { ok: false; motivo: 'invalida' | 'vencida' };

/** Comprueba la firma y la vigencia; el llamador revisa que la carga sea del tipo que espera. */
async function leerCargaFirmada(env: Entorno, token: string): Promise<ResultadoCarga> {
  const [cuerpo, firma, sobra] = token.split('.');
  if (!cuerpo || !firma || sobra !== undefined) return { ok: false, motivo: 'invalida' };
  const firmaBytes = deBase64Url(firma);
  if (!firmaBytes) return { ok: false, motivo: 'invalida' };
  const valida = await crypto.subtle.verify('HMAC', await claveFirma(env), firmaBytes as BufferSource, new TextEncoder().encode(cuerpo));
  if (!valida) return { ok: false, motivo: 'invalida' };
  const bytes = deBase64Url(cuerpo);
  if (!bytes) return { ok: false, motivo: 'invalida' };
  let carga: Record<string, unknown>;
  try {
    carga = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return { ok: false, motivo: 'invalida' };
  }
  if (carga.v !== 1 || typeof carga.exp !== 'number') return { ok: false, motivo: 'invalida' };
  if (carga.exp < Date.now()) return { ok: false, motivo: 'vencida' };
  return { ok: true, carga };
}

export type ResultadoVerificacion = { ok: true; carga: CargaAutorizacion } | { ok: false; motivo: 'invalida' | 'vencida' };

/** Autorización de PRECIO de promotor (una de código manual no sirve aquí). */
export async function verificarAutorizacion(env: Entorno, token: string): Promise<ResultadoVerificacion> {
  const r = await leerCargaFirmada(env, token);
  if (!r.ok) return r;
  if (r.carga.k !== undefined || !Array.isArray(r.carga.ln)) return { ok: false, motivo: 'invalida' };
  return { ok: true, carga: r.carga as unknown as CargaAutorizacion };
}

// --- Promotor --------------------------------------------------------------------------------------------------
/** Datos opcionales del promotor, validados con las mismas reglas que el POS. */
export function promotorValido(datos: DatosPromotor | null | undefined): PromotorNormalizado {
  const r = normalizarPromotor(datos);
  if (!r.ok) throw new ErrorApi(400, r.mensaje, 'promotor_invalido');
  return r.promotor;
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

const credencialesInvalidas = (soloGlobal = false, textoGlobal?: string) =>
  new ErrorApi(
    403,
    soloGlobal
      ? (textoGlobal ?? 'Contraseña incorrecta: un precio menor al del catálogo solo lo autoriza un gerente o un administrador.')
      : 'Contraseña incorrecta: debe ser la de un encargado de este local, un supervisor, un gerente o un administrador.',
    'autorizador_invalido'
  );

/**
 * ¿Puede esta persona autorizar en ese local? Encargado del local, gerente o administrador, con la cuenta activa. Con `soloGlobal`
 * (un precio MENOR al del catálogo, es decir un descuento) solo gerente o administrador: el encargado solo autoriza precios mayores.
 */
function puedeAutorizar(f: Pick<FilaSupervisor, 'rol' | 'local_id' | 'status'>, localId: string, soloGlobal = false): boolean {
  if (f.status !== 'active') return false;
  if (f.rol === 'administrador' || f.rol === 'gerente') return true;
  if (soloGlobal) return false;
  // El encargado autoriza en su local; el supervisor (encargado de todos los locales), en cualquiera
  return f.rol === 'supervisor' || (f.rol === 'encargado' && f.local_id === localId);
}

/** Vuelve a mirar, al cobrar, que quien autorizó siga pudiendo hacerlo (no lo desactivaron ni lo cambiaron de local en esos minutos). */
async function supervisorSigueVigente(env: Entorno, supervisorId: string, localId: string, soloGlobal = false): Promise<boolean> {
  const f = await env.DB.prepare('SELECT rol, local_id, status FROM perfiles WHERE id = ?').bind(supervisorId).first<Pick<FilaSupervisor, 'rol' | 'local_id' | 'status'>>();
  return !!f && puedeAutorizar(f, localId, soloGlobal);
}

// --- Tope de intentos ----------------------------------------------------------------------------------------
// Se cuenta por quien vende (no por el supervisor): un vendedor no puede probar contraseñas a ciegas, y los fallos de uno no bloquean a otro.
const claveIntentos = (userId: string) => `precio-auth:${userId}`;

async function exigirIntentosDisponibles(env: Entorno, userId: string): Promise<void> {
  const fila = await env.DB.prepare('SELECT count, lastRequest FROM rateLimit WHERE key = ?').bind(claveIntentos(userId)).first<{ count: number; lastRequest: number }>();
  if (fila && fila.count >= MAX_FALLOS && Date.now() - fila.lastRequest < VENTANA_FALLOS_MS) {
    throw new ErrorApi(429, 'Demasiados intentos fallidos. Espera unos minutos o pídele al encargado que lo haga él.', 'demasiados_intentos');
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

/**
 * La persona que autoriza, por su correo y contraseña. Toda falla (correo desconocido, clave mala, rol sin permiso) da el MISMO mensaje
 * y cuenta un intento de quien vende; tras 5 seguidos se bloquea. Un acierto borra los fallos.
 */
async function identificarSupervisor(env: Entorno, sesion: Sesion, email: string | undefined, clave: string, localId: string, soloGlobal = false, textoGlobal?: string): Promise<FilaSupervisor> {
  await exigirIntentosDisponibles(env, sesion.userId);
  const correo = (email ?? '').trim().toLowerCase();
  let supervisor: FilaSupervisor | null = null;

  if (correo) {
    // Con correo (clientes anteriores y pruebas): se busca a esa persona y se comprueba su contraseña
    const fila = await env.DB
      .prepare(
        `SELECT p.id, p.nombre, p.rol, p.local_id, p.status, a.password
           FROM perfiles p LEFT JOIN account a ON a.userId = p.id AND a.providerId = 'credential'
          WHERE lower(p.email) = ?`
      )
      .bind(correo)
      .first<FilaSupervisor>();
    // Sin cuenta se hace igual el cálculo del hash, para no delatar por el tiempo qué correos existen
    const claveCorrecta = fila?.password ? await verificarClave(clave, fila.password) : (await hashearClave(clave), false);
    if (fila && claveCorrecta && puedeAutorizar(fila, localId, soloGlobal)) supervisor = fila;
  } else {
    // Solo con la contraseña: la tiene que tener alguien que pueda autorizar en ESTE local (encargado de ese local, gerentes y
    // administradores activos: unas pocas personas). El tope de 5 fallos por quien vende sigue protegiendo contra adivinarla.
    const candidatos = await env.DB
      .prepare(
        `SELECT p.id, p.nombre, p.rol, p.local_id, p.status, a.password
           FROM perfiles p JOIN account a ON a.userId = p.id AND a.providerId = 'credential'
          WHERE p.status = 'active' AND (p.rol IN ('administrador', 'gerente') OR (? = 0 AND (p.rol = 'supervisor' OR (p.rol = 'encargado' AND p.local_id = ?))))
          ORDER BY p.id`
      )
      .bind(soloGlobal ? 1 : 0, localId)
      .all<FilaSupervisor>();
    for (const c of candidatos.results) {
      if (c.password && (await verificarClave(clave, c.password))) {
        supervisor = c;
        break;
      }
    }
    if (candidatos.results.length === 0) await hashearClave(clave);
  }

  if (!supervisor) {
    await anotarFallo(env, sesion.userId);
    throw credencialesInvalidas(soloGlobal, textoGlobal);
  }
  await borrarFallos(env, sesion.userId);
  return supervisor;
}

// --- Elegir a mano el código de una unidad (la etiqueta no se lee) --------------------------------------------
export interface AutorizacionCodigo {
  token: string;
  vence_en: number;
  autorizado_por: string;
}

/** Un supervisor autoriza que, de ESTE producto, quien vende elija a mano el código de las unidades (por 20 minutos). */
export async function autorizarCodigoManual(
  env: Entorno,
  sesion: Sesion,
  pedido: { email?: string; clave: string; local_id: string; producto_id: string }
): Promise<AutorizacionCodigo> {
  if (!(await localAccesible(env, sesion, pedido.local_id))) throw new ErrorApi(403, 'No tienes acceso a ese local.', 'sin_permiso');
  const producto = await env.DB.prepare('SELECT id FROM productos WHERE id = ?').bind(pedido.producto_id).first();
  if (!producto) throw new ErrorApi(400, 'El producto no existe en el catálogo.', 'datos_invalidos');
  const supervisor = await identificarSupervisor(env, sesion, pedido.email, pedido.clave, pedido.local_id);
  const vence = Date.now() + VIDA_AUTORIZACION_MS;
  const token = await firmarCarga(env, { v: 1, k: 'codigo', u: sesion.userId, a: supervisor.id, an: supervisor.nombre, l: pedido.local_id, pr: pedido.producto_id, exp: vence } satisfies CargaCodigoManual);
  return { token, vence_en: vence, autorizado_por: supervisor.nombre };
}

// --- Piezas defectuosas en una venta (productos por cantidad) -----------------------------------------------------
export { UMBRAL_CLAVE_DANADOS };

/** Autorización para botar `n` piezas defectuosas en una venta: atada a quien vende, el local y la cantidad. */
export interface CargaDanados {
  v: 1;
  k: 'danados';
  u: string;
  a: string;
  an: string;
  l: string;
  /** Cantidad máxima de piezas defectuosas de esa venta que cubre */
  n: number;
  exp: number;
}

export interface AutorizacionDanados {
  token: string;
  vence_en: number;
  autorizado_por: string;
}

/** Un gerente o administrador (solo su contraseña) autoriza botar `cantidad` piezas defectuosas en una venta (por 20 minutos). */
export async function autorizarDanados(
  env: Entorno,
  sesion: Sesion,
  pedido: { email?: string; clave: string; local_id: string; cantidad: number }
): Promise<AutorizacionDanados> {
  if (!(await localAccesible(env, sesion, pedido.local_id))) throw new ErrorApi(403, 'No tienes acceso a ese local.', 'sin_permiso');
  if (!Number.isInteger(pedido.cantidad) || pedido.cantidad < 1 || pedido.cantidad > 500) throw new ErrorApi(400, 'La cantidad de piezas defectuosas no es válida.', 'datos_invalidos');
  const supervisor = await identificarSupervisor(env, sesion, pedido.email, pedido.clave, pedido.local_id, true, 'Contraseña incorrecta: botar 3 o más piezas defectuosas en una venta lo autoriza un gerente o un administrador.');
  const vence = Date.now() + VIDA_AUTORIZACION_MS;
  const token = await firmarCarga(env, { v: 1, k: 'danados', u: sesion.userId, a: supervisor.id, an: supervisor.nombre, l: pedido.local_id, n: pedido.cantidad, exp: vence } satisfies CargaDanados);
  return { token, vence_en: vence, autorizado_por: supervisor.nombre };
}

const sinAutorizacionDanados = (detalle: string) => new ErrorApi(400, `Botar ${UMBRAL_CLAVE_DANADOS} o más piezas defectuosas en una venta necesita la clave de un gerente o administrador. ${detalle}`, 'danados_no_autorizados');

/** Comprueba la autorización de `cantidad` piezas defectuosas (de toda la venta). Devuelve quién la dio. */
export async function verificarDanados(env: Entorno, sesion: Sesion, localId: string, cantidad: number, token: string): Promise<{ autorizado_por: string; autorizado_nombre: string }> {
  if (!token) throw sinAutorizacionDanados('Pídela antes de cobrar.');
  const r = await leerCargaFirmada(env, token);
  if (!r.ok) throw sinAutorizacionDanados(r.motivo === 'vencida' ? 'Venció (dura 20 minutos). Vuelve a pedirla.' : 'No es válida. Vuelve a pedirla.');
  const c = r.carga as unknown as Partial<CargaDanados>;
  if (c.k !== 'danados' || typeof c.n !== 'number') throw sinAutorizacionDanados('No es válida. Vuelve a pedirla.');
  if (c.u !== sesion.userId || c.l !== localId || !c.a || !c.an) throw sinAutorizacionDanados('Es de otra venta o vendedor. Vuelve a pedirla.');
  if (c.n < cantidad) throw sinAutorizacionDanados(`Cubre ${c.n} pieza${c.n === 1 ? '' : 's'} y son ${cantidad}. Vuelve a pedirla.`);
  if (!(await supervisorSigueVigente(env, c.a, localId, true))) throw sinAutorizacionDanados('Quien la dio ya no puede hacerlo. Vuelve a pedirla.');
  return { autorizado_por: c.a, autorizado_nombre: c.an };
}

const sinAutorizacionCodigo = (detalle: string) => new ErrorApi(400, `La selección manual del código no está autorizada. ${detalle}`, 'codigo_no_autorizado');

/** Comprueba, al registrar la venta, la autorización de los códigos elegidos a mano de un producto. Devuelve quién la dio. */
export async function verificarCodigoManual(
  env: Entorno,
  sesion: Sesion,
  localId: string,
  productoId: string,
  token: string
): Promise<{ autorizado_por: string; autorizado_nombre: string }> {
  if (!token) throw sinAutorizacionCodigo('Pídela a un encargado, gerente o administrador.');
  const r = await leerCargaFirmada(env, token);
  if (!r.ok) throw sinAutorizacionCodigo(r.motivo === 'vencida' ? 'Venció (dura 20 minutos). Vuelve a pedirla.' : 'No es válida. Vuelve a pedirla.');
  const c = r.carga as unknown as Partial<CargaCodigoManual>;
  if (c.k !== 'codigo') throw sinAutorizacionCodigo('No es válida. Vuelve a pedirla.');
  if (c.u !== sesion.userId || c.l !== localId || c.pr !== productoId || !c.a || !c.an) throw sinAutorizacionCodigo('Es de otra venta, vendedor o producto. Vuelve a pedirla.');
  if (!(await supervisorSigueVigente(env, c.a, localId))) throw sinAutorizacionCodigo('Quien la dio ya no puede hacerlo. Vuelve a pedirla.');
  return { autorizado_por: c.a, autorizado_nombre: c.an };
}

// --- Pedir la autorización de precio --------------------------------------------------------------------------
export interface PedidoAutorizacion {
  /** Opcional: con solo la contraseña se identifica al supervisor entre quienes pueden autorizar en el local */
  email?: string;
  /** Contraseña del supervisor. NO hace falta en el precio de promotor con precios mayores al catálogo (quien vende lo anota solo) */
  clave?: string;
  local_id: string;
  promotor?: DatosPromotor | null;
  /** Por defecto "promotor". Con "local" no hay promotor ni comisión (cualquier dato de promotor enviado se ignora) */
  modo?: ModoPrecio;
  lineas: { producto_id: string; precio: number }[];
}

export async function autorizarPrecio(env: Entorno, sesion: Sesion, pedido: PedidoAutorizacion): Promise<AutorizacionPrecio> {
  if (!(await localAccesible(env, sesion, pedido.local_id))) throw new ErrorApi(403, 'No tienes acceso a ese local.', 'sin_permiso');

  // Primero lo que se pide (no cuenta como intento fallido): el promotor y los precios
  const modo: ModoPrecio = pedido.modo === 'local' ? 'local' : 'promotor';
  const promotor = promotorValido(modo === 'local' ? null : pedido.promotor);
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
  }
  // Un precio MENOR al del catálogo (descuento) solo lo autoriza un gerente o un administrador; uno mayor, también el encargado del local
  const hayDescuento = pedido.lineas.some((l) => l.precio < (lista.get(l.producto_id)?.precio_venta ?? 0) - TOLERANCIA);

  // Un precio MAYOR (precio de promotor o precio del local) no pide contraseña: quien vende lo anota solo. Solo un descuento la pide.
  // Si un cliente anterior sí manda una contraseña, se verifica como siempre y queda registrado quién autorizó.
  const sinClave = !hayDescuento && !(pedido.clave ?? '');
  if (!sinClave && !(pedido.clave ?? '')) {
    throw new ErrorApi(403, 'Un precio menor al del catálogo necesita la contraseña de un gerente o un administrador.', 'sin_permiso');
  }
  const supervisor = sinClave ? { id: sesion.userId, nombre: sesion.nombre } : await identificarSupervisor(env, sesion, pedido.email, pedido.clave ?? '', pedido.local_id, hayDescuento);

  const vence = Date.now() + VIDA_AUTORIZACION_MS;
  const token = await firmarAutorizacion(env, {
    v: 1,
    u: sesion.userId,
    a: supervisor.id,
    an: supervisor.nombre,
    ...(sinClave ? { s: 1 as const } : {}),
    l: pedido.local_id,
    p: promotor.clave,
    pn: promotor.nombre ?? '',
    ln: pedido.lineas.map((l) => [l.producto_id, redondear2(l.precio)]),
    ...(modo === 'local' ? { m: 'local' as const } : {}),
    exp: vence,
  });
  return { token, modo, vence_en: vence, autorizado_por: sinClave ? '' : supervisor.nombre, promotor: promotor.nombre ?? '' };
}

// --- Usar la autorización al registrar la venta --------------------------------------------------------------
export interface PrecioPromotorVerificado {
  /** Con qué modo se autorizó: en "local" no hay promotor ni comisión */
  modo: ModoPrecio;
  promotor_nombre: string | null;
  promotor_cedula: string | null;
  promotor_telefono: string | null;
  promotor_banco: string | null;
  /** Nombre y apellido por separado (para el directorio de promotores) */
  promotor_nombre_propio: string;
  promotor_apellido: string;
  /** Supervisor que autorizó; null si el precio de promotor lo anotó quien vende sin contraseña */
  autorizado_por: string | null;
  autorizado_nombre: string | null;
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
  datos: { local_id: string; promotor?: DatosPromotor | null; autorizacion_precio?: string | null },
  desviadas: [string, number][],
  hayDescuento = false
): Promise<PrecioPromotorVerificado> {
  const token = (datos.autorizacion_precio ?? '').trim();
  if (!token) throw sinAutorizacion();
  const r = await verificarAutorizacion(env, token);
  if (!r.ok) {
    throw r.motivo === 'vencida'
      ? sinAutorizacion('La autorización venció (dura 20 minutos). Vuelve a pedirla.')
      : sinAutorizacion('La autorización no es válida. Vuelve a pedirla.');
  }
  const c = r.carga;
  const modo: ModoPrecio = c.m === 'local' ? 'local' : 'promotor';
  // Sin contraseña solo valen los precios MAYORES (precio de promotor o del local); un descuento siempre la pide
  if (c.s && hayDescuento) throw sinAutorizacion('Un descuento necesita la contraseña de un gerente o un administrador.');
  // En modo local no hay promotor: lo que haya enviado el cliente se ignora (la autorización se firmó sin promotor)
  const promotor = promotorValido(modo === 'local' ? null : datos.promotor);
  if (c.u !== sesion.userId || c.l !== datos.local_id || c.p !== promotor.clave) {
    throw sinAutorizacion('Esa autorización es de otra venta, vendedor o promotor. Vuelve a pedirla.');
  }
  const autorizados = new Map(c.ln);
  for (const [productoId, cobrado] of desviadas) {
    const permitido = autorizados.get(productoId);
    if (permitido === undefined || Math.abs(permitido - cobrado) > TOLERANCIA) {
      throw sinAutorizacion('El precio cobrado no coincide con el autorizado. Vuelve a pedirla.');
    }
  }
  if (!c.s && !(await supervisorSigueVigente(env, c.a, datos.local_id, hayDescuento))) throw sinAutorizacion('Quien autorizó ya no puede hacerlo. Vuelve a pedirla.');
  return { modo, promotor_nombre: promotor.nombre, promotor_cedula: promotor.cedula, promotor_telefono: promotor.telefono, promotor_banco: promotor.banco, promotor_nombre_propio: promotor.nombrePropio, promotor_apellido: promotor.apellido, autorizado_por: c.s ? null : c.a, autorizado_nombre: c.s ? null : c.an };
}
