// Servicio de autenticación y roles, con el mismo patrón dual que inventoryService.ts: el servidor de EASYSTEM
// (Cloudflare Worker + D1 + Better-Auth, cookie de sesión) cuando hay modo servidor, o un simulador de usuarios en
// LocalStorage cuando no (modo demo).
//
// AVISO DE SEGURIDAD: el modo LocalStorage guarda las "contraseñas" en texto plano en el navegador. Es intencional y
// está bien para probar la UI de login/roles sin backend, pero NUNCA debe tratarse como autenticación real. La
// autenticación real (hash PBKDF2, sesiones en D1, permisos por rol en cada ruta de la API) la provee el servidor.
import { api, ErrorDeApi } from './api';
import { modoServidor } from './modo';
import { alCambiarDatos, iniciarTiempoReal } from './realtime';
import { avisarSalida, iniciarLatidos, leerPresenciaLocal } from './presencia';
import { calcularEstado, type EstadoPresencia, type ListaPresencia, type UsuarioPresencia } from '../utils/presencia';
import { LOCAL_ACCESORIOS_ID, LOCAL_SERVICIO_TECNICO_ID, LOCAL_VIDRIOS_ID, localVigente, localesPorDefecto } from './constantes-locales';
import type { EstadoSuscripcion, Local, TipoLocal } from '../types/database.types';

/**
 * Jerarquía: administrador > gerente > encargado > vendedor/técnico.
 * administrador: dueño del servicio SaaS; acceso total, crea y elimina usuarios de cualquier rol, suspende
 *   locales y cierra sesiones. Nunca queda bloqueado por una suscripción.
 * gerente: dueño del negocio cliente; acceso global (todos los locales vigentes); en usuarios solo crea,
 *   edita y elimina encargados, vendedores y técnicos.
 * contador: solo ve el módulo de Nómina, de todos los locales; no ve ventas, stock ni catálogo. Lo gestiona el administrador.
 * encargado: gerente de UN local. vendedor: cajero de un local. tecnico: servicio técnico de un local.
 * Los tres últimos solo ven y modifican datos de su local y no gestionan usuarios.
 */
export type Rol = 'administrador' | 'gerente' | 'contador' | 'encargado' | 'vendedor' | 'tecnico';

export const ETIQUETAS_ROL: Record<Rol, string> = {
  administrador: 'Administrador',
  gerente: 'Gerente',
  contador: 'Contador',
  encargado: 'Encargado',
  vendedor: 'Vendedor (cajero)',
  tecnico: 'Técnico',
};

export const ROLES: Rol[] = ['administrador', 'gerente', 'contador', 'encargado', 'vendedor', 'tecnico'];

/** Roles que cada quien puede asignar al crear o editar usuarios. */
export function rolesAsignables(rol?: Rol | null): Rol[] {
  if (rol === 'administrador') return ROLES;
  if (rol === 'gerente') return ['encargado', 'vendedor', 'tecnico', 'contador'];
  return [];
}

/** ¿Este usuario (actor) puede editar o eliminar a otro con el rol `objetivo`? Nadie se gestiona a sí mismo. */
export function puedeGestionarUsuario(actor?: Rol | null, objetivo?: Rol | null): boolean {
  if (!actor || !objetivo) return false;
  return rolesAsignables(actor).includes(objetivo);
}

export interface SesionUsuario {
  id: string;
  email: string;
  nombre: string;
  rol: Rol;
  /** Local asignado. Administrador y gerente tienen acceso a todos (su local_id es irrelevante); null = sin local asignado */
  local_id: string | null;
  /** inactive = el usuario no puede operar (migración 0021). Si falta se asume active */
  status?: 'active' | 'inactive';
  /** La clave actual es temporal (la puso otra persona): hay que cambiarla antes de usar el sistema. */
  debe_cambiar_clave?: boolean;
  /** Cuándo empezó esta sesión y cuándo se creó la cuenta (ISO): se muestran en el perfil. */
  sesion_iniciada_en?: string | null;
  creado_en?: string | null;
}

/** Por qué una cuenta no tiene acceso a los datos (ver estado_cuenta() en la migración 0021). */
export type MotivoBloqueo = 'ok' | 'local_suspendido' | 'usuario_inactivo' | 'sesion_cerrada' | 'sin_perfil' | 'sesion_expirada';

export interface EstadoCuenta {
  acceso: boolean;
  motivo: MotivoBloqueo;
  local_nombre?: string | null;
  subscription_status?: EstadoSuscripcion | null;
  subscription_expires_at?: string | null;
}

/** Fila del panel del administrador: un local con su suscripción. */
export interface SuscripcionLocal {
  id: string;
  nombre: string;
  tipo: TipoLocal;
  subscription_status: EstadoSuscripcion;
  subscription_expires_at: string | null;
  /** true = sus empleados pueden operar ahora (ACTIVE y sin vencer) */
  vigente: boolean;
}

/** Fila de la tabla de usuarios del administrador. */
export interface UsuarioSistema {
  id: string;
  email: string;
  nombre: string;
  rol: Rol;
  status: 'active' | 'inactive';
  local_id: string | null;
  local_nombre: string | null;
  subscription_status: EstadoSuscripcion | null;
  last_sign_in_at: string | null;
  last_force_logout_at: string | null;
}

// --- Permisos por rol (la base de datos los vuelve a exigir con RLS; esto solo gobierna la interfaz) ---
/** Solo el dueño del servicio: suscripciones, sesiones y gestión de cualquier usuario */
export const esAdministrador = (rol?: Rol | null) => rol === 'administrador';
/** Administrador o gerente: acceso a TODOS los locales, catálogo y usuarios (los permisos de usuarios los acota `rolesAsignables`) */
export const esGlobal = (rol?: Rol | null) => rol === 'administrador' || rol === 'gerente';
/** Sin local asignado: ven varios locales (administrador y gerente) o ninguno de operación (contador). */
export const esSinLocal = (rol?: Rol | null) => esGlobal(rol) || rol === 'contador';
/** Nómina y personal: administrador, gerente y contador (de todos los locales). */
export const puedeNomina = (rol?: Rol | null) => rol === 'administrador' || rol === 'gerente' || rol === 'contador';
/** Registrar entradas de mercancía y devoluciones, y ver reportes de su local */
export const esGerencia = (rol?: Rol | null) => rol === 'administrador' || rol === 'gerente' || rol === 'encargado';

const LS_SESION = 'easystem:sesion';
// Última sesión conocida en modo servidor (para abrir el sistema sin conexión)
const LS_SESION_CACHE = 'easystem:sesion-servidor';
const LS_USUARIOS = 'easystem:usuarios';
// Simulador de suscripciones y cierres forzados (solo modo LocalStorage; con el servidor viven en la base de datos)
const LS_SUSCRIPCIONES = 'easystem:suscripciones';
const LS_CIERRES_FORZADOS = 'easystem:cierres-forzados';

interface UsuarioLocal extends SesionUsuario {
  password: string;
}

function sesionDesdePerfil(id: string, perfil: any): SesionUsuario {
  return {
    id, email: perfil.email, nombre: perfil.nombre, rol: perfil.rol, local_id: perfil.local_id ?? null, status: perfil.status ?? 'active',
    debe_cambiar_clave: perfil.debe_cambiar_clave === true,
    sesion_iniciada_en: perfil.sesion_iniciada_en ?? null,
    creado_en: perfil.creado_en ?? null,
  };
}

function generarId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`;
}

function seedUsuariosLocales(): UsuarioLocal[] {
  return [
    { id: generarId(), email: 'admin@edwardaccesorios.com', password: 'admin123', nombre: 'Administrador', rol: 'administrador', local_id: null },
    { id: generarId(), email: 'vendedor@edwardaccesorios.com', password: 'vendedor123', nombre: 'Vendedor Mostrador', rol: 'vendedor', local_id: LOCAL_ACCESORIOS_ID },
    { id: generarId(), email: 'encargado@edwardaccesorios.com', password: 'encargado123', nombre: 'Encargado Vidrios', rol: 'encargado', local_id: LOCAL_VIDRIOS_ID },
    { id: generarId(), email: 'tecnico@edwardaccesorios.com', password: 'tecnico123', nombre: 'Técnico de Servicio', rol: 'tecnico', local_id: LOCAL_SERVICIO_TECNICO_ID },
    { id: generarId(), email: 'gerente@edwardaccesorios.com', password: 'gerente123', nombre: 'Gerente', rol: 'gerente', local_id: null },
    { id: generarId(), email: 'contador@edwardaccesorios.com', password: 'contador123', nombre: 'Contador', rol: 'contador', local_id: null },
  ];
}

/** Usuarios guardados antes del multi-local: sin local → Accesorios; y se agregan las cuentas demo que falten. */
function migrarUsuariosLocales(usuarios: UsuarioLocal[]): { usuarios: UsuarioLocal[]; cambio: boolean } {
  let cambio = false;
  // Cuentas de un modelo anterior (rol super_admin, ya retirado): su poder pasó al administrador
  for (const u of usuarios) {
    if ((u.rol as string) === 'super_admin') {
      u.rol = 'administrador';
      cambio = true;
    }
  }
  for (const u of usuarios) {
    if (u.local_id === undefined) {
      u.local_id = esSinLocal(u.rol) ? null : LOCAL_ACCESORIOS_ID;
      cambio = true;
    }
  }
  for (const demo of seedUsuariosLocales()) {
    if (!usuarios.some((u) => u.email.toLowerCase() === demo.email)) {
      usuarios.push(demo);
      cambio = true;
    }
  }
  return { usuarios, cambio };
}

function leerUsuariosLocales(): UsuarioLocal[] {
  try {
    const raw = localStorage.getItem(LS_USUARIOS);
    if (raw) {
      const { usuarios, cambio } = migrarUsuariosLocales(JSON.parse(raw) as UsuarioLocal[]);
      if (cambio) localStorage.setItem(LS_USUARIOS, JSON.stringify(usuarios));
      return usuarios;
    }
  } catch (err) {
    console.error('[EASYSTEM] No se pudo leer usuarios de LocalStorage.', err);
  }
  const inicial = seedUsuariosLocales();
  localStorage.setItem(LS_USUARIOS, JSON.stringify(inicial));
  return inicial;
}

function guardarUsuariosLocales(usuarios: UsuarioLocal[]) {
  localStorage.setItem(LS_USUARIOS, JSON.stringify(usuarios));
}

// Varios componentes por página (Sidebar, DashboardLayout, la propia página)
// llaman a obtenerSesionActual() de forma independiente; se memoiza dentro de
// la misma carga de página para no repetir la consulta al servidor/localStorage.
let sesionEnCache: Promise<SesionUsuario | null> | null = null;
// El mismo /api/cuenta/estado que trae la sesión trae también el estado de la cuenta: se guarda para que protegerPagina no lo
// pida otra vez justo después (una petición menos antes de que la página se vea). Se usa una sola vez.
let estadoDeLaCarga: EstadoCuenta | null = null;

function invalidarCacheSesion() {
  sesionEnCache = null;
  estadoDeLaCarga = null;
}

/** Traduce los errores de Better-Auth (por código) a algo accionable para el usuario. */
function traducirErrorAuth(err: unknown): string {
  if (err instanceof ErrorDeApi) {
    if (err.codigo === 'INVALID_EMAIL_OR_PASSWORD' || err.codigo === 'USER_NOT_FOUND' || err.codigo === 'CREDENTIAL_ACCOUNT_NOT_FOUND') return 'Correo o contraseña incorrectos.';
    if (err.status === 429) return 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';
    if (err.status === 403 && /origin/i.test(err.message)) return 'No se pudo iniciar sesión desde esta dirección. Abre el sistema desde su dirección oficial.';
  }
  return err instanceof Error ? err.message : String(err);
}

/** Mínimo de la contraseña: el servidor exige 8; el modo demo sigue aceptando 6. */
export const MIN_CLAVE = modoServidor ? 8 : 6;

/**
 * Solo modo demo (LocalStorage): ¿este correo y contraseña son de alguien que puede autorizar precios en ese local (encargado de ese
 * local, gerente o administrador)? Con el servidor lo decide el servidor (`POST /api/ventas/autorizar-precio`). No cambia la sesión.
 */
export function verificarSupervisorDemo(email: string | undefined, clave: string, localId: string, soloGlobal = false): { id: string; nombre: string } | null {
  const correo = (email ?? '').trim().toLowerCase();
  // Sin correo basta la contraseña: la de cualquiera que pueda autorizar en este local
  const puedeAutorizar = (u: { rol: string; local_id?: string | null; status?: string }) =>
    (u.status ?? 'active') === 'active' && (u.rol === 'administrador' || u.rol === 'gerente' || (!soloGlobal && u.rol === 'encargado' && u.local_id === localId));
  const u = leerUsuariosLocales().find((x) => (!correo || x.email.toLowerCase() === correo) && x.password === clave && puedeAutorizar(x));
  return u ? { id: u.id, nombre: u.nombre } : null;
}

export async function iniciarSesion(email: string, password: string): Promise<SesionUsuario> {
  if (modoServidor) {
    try {
      await api.post('/api/auth/sign-in/email', { email: email.trim(), password });
    } catch (err) {
      throw new Error(traducirErrorAuth(err));
    }
    invalidarCacheSesion();
    const sesion = await obtenerSesionActual();
    if (!sesion) throw new Error('Tu cuenta no tiene un perfil asociado todavía. Contacta a un administrador.');
    return sesion;
  }

  const usuario = leerUsuariosLocales().find((u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password);
  if (!usuario) throw new Error('Correo o contraseña incorrectos.');

  const { password: _sinUsar, ...sesion } = usuario;
  // emitida_en equivale al "iat" del token: un cierre forzado posterior la invalida
  const ahora = new Date().toISOString();
  localStorage.setItem(LS_SESION, JSON.stringify({ ...sesion, emitida_en: ahora, sesion_iniciada_en: ahora }));
  invalidarCacheSesion();
  return sesion;
}

/**
 * Las copias locales de ventas, productos, etc. (para trabajar sin conexión) traen datos de clientes y costos: al cerrar
 * sesión se borran para que quien use el equipo después no las lea. Lo pendiente de sincronizar (colas) NO se toca.
 */
function borrarCachesDeDatos() {
  try {
    const claves: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const clave = localStorage.key(i);
      if (clave?.startsWith('easystem:cache:')) claves.push(clave);
    }
    for (const clave of claves) localStorage.removeItem(clave);
  } catch {
    // sin acceso al almacenamiento: nada que borrar
  }
}

export async function cerrarSesion(): Promise<void> {
  await avisarSalida(); // antes de cerrar: después ya no habría sesión con la que avisar
  invalidarCacheSesion();
  if (modoServidor) {
    localStorage.removeItem(LS_SESION_CACHE);
    borrarCachesDeDatos();
    try {
      await api.post('/api/auth/sign-out');
    } catch {
      // Sin conexión o sesión ya cerrada: de todos modos se sigue al login
    }
    return;
  }
  localStorage.removeItem(LS_SESION);
}

export async function obtenerSesionActual(): Promise<SesionUsuario | null> {
  if (!sesionEnCache) sesionEnCache = cargarSesionActual();
  return sesionEnCache;
}

/** Estado de cuenta tal como lo responde el servidor (incluye los datos del usuario). */
interface RespuestaEstado extends EstadoCuenta {
  usuario?: {
    id: string; email: string; nombre: string; rol: Rol; local_id: string | null; status: 'active' | 'inactive';
    debe_cambiar_clave?: boolean; sesion_iniciada_en?: string; creado_en?: string;
  };
}

async function cargarSesionActual(): Promise<SesionUsuario | null> {
  if (modoServidor) {
    try {
      const { usuario, ...estadoCuenta } = await api.get<RespuestaEstado>('/api/cuenta/estado');
      const estado = { usuario };
      if (!estado.usuario) {
        localStorage.removeItem(LS_SESION_CACHE);
        return null;
      }
      estadoDeLaCarga = estadoCuenta;
      const sesion = sesionDesdePerfil(estado.usuario.id, estado.usuario);
      // Sin conexión no se obliga a cambiar la clave (el servidor lo exige igual): la copia guardada no lleva la marca
      localStorage.setItem(LS_SESION_CACHE, JSON.stringify({ ...sesion, debe_cambiar_clave: false }));
      return sesion;
    } catch (err) {
      // 401 = no hay sesión (o expiró): al login. Sin conexión o con un error del servidor: se sigue con la última sesión conocida para poder vender
      if (err instanceof ErrorDeApi && err.status === 401) {
        localStorage.removeItem(LS_SESION_CACHE);
        return null;
      }
      // Sin conexión o error del servidor: última sesión conocida (el servidor niega los datos si no corresponde)
      return leerJsonLS<SesionUsuario | null>(LS_SESION_CACHE, null);
    }
  }

  try {
    const raw = localStorage.getItem(LS_SESION);
    if (!raw) return null;
    const sesion = JSON.parse(raw) as SesionUsuario;
    // Sesiones guardadas antes del multi-local no traen local_id: se toma del usuario
    if (sesion.local_id === undefined) sesion.local_id = leerUsuariosLocales().find((u) => u.id === sesion.id)?.local_id ?? null;
    return sesion;
  } catch {
    return null;
  }
}

/**
 * Crea una cuenta de empleado. SOLO un administrador con sesión puede hacerlo:
 * EASYSTEM es de uso interno y no existe registro público.
 *
 * En modo servidor el alta la hace POST /api/usuarios (crea cuenta, perfil, rol y local en un solo paso atómico).
 */
export async function registrarUsuario(input: {
  email: string;
  password: string;
  nombre: string;
  rol?: Rol;
  /** Local asignado (obligatorio salvo para administrador y gerente, que son globales) */
  local_id?: string | null;
}): Promise<{ requiereConfirmacion: boolean }> {
  const sesion = await obtenerSesionActual();
  if (!esGlobal(sesion?.rol)) {
    throw new Error('Solo un administrador o gerente puede crear usuarios.');
  }

  const rol = input.rol ?? 'vendedor';
  if (!rolesAsignables(sesion?.rol).includes(rol)) {
    throw new Error(sesion?.rol === 'gerente' ? 'Un gerente solo puede crear encargados, vendedores y técnicos.' : 'No puedes crear usuarios con ese rol.');
  }
  const email = input.email.trim().toLowerCase();
  const nombre = input.nombre.trim();
  if (!nombre) throw new Error('El nombre es obligatorio.');
  const local_id = esSinLocal(rol) ? null : (input.local_id ?? null);
  if (!esSinLocal(rol) && !local_id) throw new Error('Elige el local al que pertenece el empleado.');
  if (input.password.length < MIN_CLAVE) throw new Error(`La contraseña debe tener al menos ${MIN_CLAVE} caracteres.`);

  if (modoServidor) {
    await api.post('/api/usuarios', { email, nombre, clave: input.password, rol, localId: local_id });
    return { requiereConfirmacion: false };
  }

  const usuarios = leerUsuariosLocales();
  if (usuarios.some((u) => u.email.toLowerCase() === email)) {
    throw new Error('Ya existe un usuario con ese correo.');
  }
  // La clave la elige quien crea la cuenta: es temporal y la persona debe cambiarla al entrar
  usuarios.push({ id: generarId(), email, password: input.password, nombre, rol, local_id, debe_cambiar_clave: true, creado_en: new Date().toISOString() });
  guardarUsuariosLocales(usuarios);
  return { requiereConfirmacion: false };
}

export async function listarUsuarios(): Promise<SesionUsuario[]> {
  if (modoServidor) {
    const perfiles = await api.get<any[]>('/api/usuarios');
    return perfiles.map((p) => sesionDesdePerfil(p.id, p));
  }

  // Un gerente no ve a los administradores (igual que la política de la tabla perfiles)
  const actor = (await obtenerSesionActual())?.rol;
  return leerUsuariosLocales()
    .filter((u) => actor === 'administrador' || u.rol !== 'administrador')
    .map(({ password: _sinUsar, ...resto }) => resto);
}

/**
 * Cambia el rol, el local y/o el estado (activo/inactivo) de un empleado. El administrador puede con cualquiera;
 * el gerente solo con encargados, vendedores y técnicos (y solo puede dejarlos con uno de esos roles). La base de datos
 * lo exige con RLS + el trigger proteger_perfil.
 */
export async function actualizarAccesoUsuario(
  id: string,
  cambios: { rol?: Rol; local_id?: string | null; status?: 'active' | 'inactive' }
): Promise<void> {
  const parche: { rol?: Rol; local_id?: string | null; status?: 'active' | 'inactive' } = { ...cambios };
  if (cambios.rol && esSinLocal(cambios.rol)) parche.local_id = null; // administrador, gerente y contador no tienen local

  if (modoServidor) {
    await api.patch(`/api/usuarios/${id}`, { rol: parche.rol, localId: parche.local_id, status: parche.status });
    return;
  }

  const actor = await obtenerSesionActual();
  if (actor?.id === id && (cambios.rol || cambios.status)) throw new Error('No puedes cambiar tu propio rol ni tu propio estado.');
  const usuarios = leerUsuariosLocales();
  const usuario = usuarios.find((u) => u.id === id);
  if (!usuario) throw new Error('Usuario no encontrado.');
  if (!puedeGestionarUsuario(actor?.rol, usuario.rol)) throw new Error('No tienes permiso para modificar a este usuario.');
  if (cambios.rol && !rolesAsignables(actor?.rol).includes(cambios.rol)) throw new Error('No puedes asignar ese rol.');
  Object.assign(usuario, parche);
  guardarUsuariosLocales(usuarios);
}

/**
 * Elimina un usuario (cuenta y perfil). El administrador puede con cualquiera menos consigo mismo; el gerente solo
 * con encargados, vendedores y técnicos. Las ventas y órdenes que registró se conservan con su nombre.
 */
export async function eliminarUsuario(id: string): Promise<void> {
  const actor = await obtenerSesionActual();
  if (actor?.id === id) throw new Error('No puedes eliminar tu propio usuario.');

  if (modoServidor) {
    await api.delete(`/api/usuarios/${id}`);
    return;
  }

  const usuarios = leerUsuariosLocales();
  const usuario = usuarios.find((u) => u.id === id);
  if (!usuario) throw new Error('Usuario no encontrado.');
  if (!puedeGestionarUsuario(actor?.rol, usuario.rol)) throw new Error('No tienes permiso para eliminar a este usuario.');
  guardarUsuariosLocales(usuarios.filter((u) => u.id !== id));
}

/**
 * Fija una contraseña nueva. El administrador puede con cualquiera (incluida la suya); el gerente con encargados,
 * vendedores, técnicos y consigo mismo (migración 0024). La contraseña queda cifrada y NO se puede volver a leer.
 * A otro usuario se le cierran las sesiones abiertas: tiene que entrar con la nueva.
 */
export async function cambiarClaveUsuario(id: string, clave: string): Promise<void> {
  if (clave.length < MIN_CLAVE) throw new Error(`La contraseña debe tener al menos ${MIN_CLAVE} caracteres.`);

  if (modoServidor) {
    await api.post(`/api/usuarios/${id}/clave`, { clave });
    return;
  }

  const actor = await obtenerSesionActual();
  const usuarios = leerUsuariosLocales();
  const usuario = usuarios.find((u) => u.id === id);
  if (!usuario) throw new Error('Usuario no encontrado.');
  const propio = actor?.id === id && esGlobal(actor.rol);
  if (!propio && !(actor?.rol === 'administrador' || puedeGestionarUsuario(actor?.rol, usuario.rol))) {
    throw new Error('No tienes permiso para cambiar la contraseña de este usuario.');
  }
  usuario.password = clave;
  // La clave que fija otra persona es temporal; la que uno se pone a sí mismo ya es la suya
  usuario.debe_cambiar_clave = actor?.id !== id;
  guardarUsuariosLocales(usuarios);
  if (actor?.id !== id) {
    const cierres = leerJsonLS<Record<string, string>>(LS_CIERRES_FORZADOS, {});
    cierres[id] = new Date().toISOString();
    localStorage.setItem(LS_CIERRES_FORZADOS, JSON.stringify(cierres));
  }
}

/**
 * Cambia la contraseña de quien tiene la sesión, sea cual sea su rol. Pide la actual; con el servidor además cierra las demás
 * sesiones de la cuenta y quita la marca de "clave temporal". Los mensajes de error ya vienen en español.
 */
export async function cambiarMiClave(actual: string, nueva: string): Promise<void> {
  if (nueva.length < MIN_CLAVE) throw new Error(`La contraseña nueva debe tener al menos ${MIN_CLAVE} caracteres.`);
  if (nueva === actual) throw new Error('La contraseña nueva debe ser distinta de la actual.');

  if (modoServidor) {
    await api.post('/api/cuenta/clave', { actual, nueva });
    invalidarCacheSesion();
    return;
  }

  const sesion = await obtenerSesionActual();
  const usuarios = leerUsuariosLocales();
  const usuario = usuarios.find((u) => u.id === sesion?.id);
  if (!sesion || !usuario) throw new Error('Tu sesión expiró. Inicia sesión de nuevo.');
  if (usuario.password !== actual) throw new Error('La contraseña actual no es correcta.');
  usuario.password = nueva;
  usuario.debe_cambiar_clave = false;
  guardarUsuariosLocales(usuarios);
  try {
    const raw = localStorage.getItem(LS_SESION);
    if (raw) localStorage.setItem(LS_SESION, JSON.stringify({ ...JSON.parse(raw), debe_cambiar_clave: false }));
  } catch {
    // sin acceso al almacenamiento: la sesión se renueva sola al entrar de nuevo
  }
  invalidarCacheSesion();
}

// ----------------------------------------------------------------------------
// Estado de cuenta (suscripción por local) y guard de rutas
// ----------------------------------------------------------------------------
// La protección REAL está en la base de datos (migración 0021): con el local suspendido/vencido, el usuario
// inactivo o la sesión cerrada a la fuerza, las políticas RLS devuelven vacío y rechazan escrituras. Esto es
// el "middleware" de la interfaz: el sitio es estático (sin servidor), así que el guard corre en el cliente
// y lleva al usuario a /subscription-suspended (o al login) en vez de mostrarle pantallas vacías.

function leerJsonLS<T>(clave: string, porDefecto: T): T {
  try {
    const raw = localStorage.getItem(clave);
    return raw ? (JSON.parse(raw) as T) : porDefecto;
  } catch {
    return porDefecto;
  }
}

type SuscripcionesLS = Record<string, { subscription_status: EstadoSuscripcion; subscription_expires_at: string | null }>;

/** Suscripciones simuladas del modo LocalStorage (la lee inventoryService.listarLocales para mezclarlas con los locales). */
export function leerSuscripcionesLocales(): SuscripcionesLS {
  return leerJsonLS<SuscripcionesLS>(LS_SUSCRIPCIONES, {});
}

/**
 * Estado de la cuenta al ENTRAR a una página: reutiliza la respuesta que ya trajo la sesión (una sola vez) y, si no la hay (modo
 * demo, o ya se usó), consulta como obtenerEstadoCuenta.
 */
export async function estadoDeEntrada(): Promise<EstadoCuenta> {
  await obtenerSesionActual();
  const guardado = estadoDeLaCarga;
  estadoDeLaCarga = null;
  return guardado ?? obtenerEstadoCuenta();
}

/** Estado de la cuenta del usuario con sesión: sin consultar caché (se llama al entrar a cada página y cada minuto). */
export async function obtenerEstadoCuenta(): Promise<EstadoCuenta> {
  const sesion = await obtenerSesionActual();
  if (!sesion) return { acceso: false, motivo: 'sin_perfil' };

  if (modoServidor) {
    // Si la consulta falla por conexión o por un error del servidor NO se bloquea: el sistema sigue funcionando
    // sin conexión, y el servidor es quien realmente niega los datos.
    try {
      const { usuario: _usuario, ...estado } = await api.get<RespuestaEstado>('/api/cuenta/estado');
      return estado;
    } catch (err) {
      if (err instanceof ErrorDeApi && err.status === 401) return { acceso: false, motivo: 'sesion_expirada' };
      return { acceso: true, motivo: 'ok' };
    }
  }

  // Simulador LocalStorage: mismas reglas que estado_cuenta()
  const usuario = leerUsuariosLocales().find((u) => u.id === sesion.id);
  if (!usuario) return { acceso: false, motivo: 'sin_perfil' };

  const locales: Local[] = localesPorDefecto().map((l) => ({ ...l, ...leerSuscripcionesLocales()[l.id] }));
  const local = locales.find((l) => l.id === usuario.local_id) ?? null;
  const base = { local_nombre: local?.nombre ?? null, subscription_status: local?.subscription_status ?? null, subscription_expires_at: local?.subscription_expires_at ?? null };

  if ((usuario.status ?? 'active') !== 'active') return { acceso: false, motivo: 'usuario_inactivo', ...base };

  const cierre = leerJsonLS<Record<string, string>>(LS_CIERRES_FORZADOS, {})[usuario.id];
  const emitida = leerJsonLS<{ emitida_en?: string }>(LS_SESION, {}).emitida_en;
  if (cierre && (!emitida || new Date(emitida).getTime() < new Date(cierre).getTime())) {
    return { acceso: false, motivo: 'sesion_cerrada', ...base };
  }

  if (usuario.rol === 'administrador') return { acceso: true, motivo: 'ok', ...base }; // nunca se bloquea por suscripción
  if (usuario.rol === 'gerente' || usuario.rol === 'contador') {
    return locales.some(localVigente) ? { acceso: true, motivo: 'ok', ...base } : { acceso: false, motivo: 'local_suspendido', ...base };
  }
  return local && localVigente(local) ? { acceso: true, motivo: 'ok', ...base } : { acceso: false, motivo: 'local_suspendido', ...base };
}

/** Lleva al usuario a donde corresponde según por qué se quedó sin acceso. */
async function redirigirPorBloqueo(motivo: MotivoBloqueo): Promise<void> {
  if (motivo === 'local_suspendido') {
    if (!window.location.pathname.startsWith('/subscription-suspended')) window.location.href = '/subscription-suspended';
    return;
  }
  try {
    await cerrarSesion();
  } catch {
    // La sesión pudo haber sido cerrada ya en el servidor; da igual, se sigue al login.
  }
  window.location.href = `/login?motivo=${motivo}`;
}

let vigilanciaActiva = false;

/** Revisa la cuenta cada minuto, al volver a la pestaña y al recuperar la conexión: un cierre forzado o una suspensión se notan sin recargar. */
function iniciarVigilanciaCuenta() {
  if (vigilanciaActiva) return;
  vigilanciaActiva = true;

  let revisando = false;
  const revisar = async () => {
    if (revisando) return;
    revisando = true;
    try {
      const estado = await obtenerEstadoCuenta();
      if (!estado.acceso) await redirigirPorBloqueo(estado.motivo);
    } finally {
      revisando = false;
    }
  };

  setInterval(revisar, 60_000);
  // Con la actualización en vivo, un cambio en los locales (suspensión) o en los perfiles (cierre forzado, usuario
  // desactivado) se nota al instante en vez de esperar al siguiente chequeo
  alCambiarDatos(['locales', 'perfiles'], revisar, 300);
  window.addEventListener('online', revisar);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') revisar();
  });
}

/**
 * Guard de ruta para páginas protegidas: llamarlo al inicio del <script> de
 * cada página (vía DashboardLayout). Redirige a /login si no hay sesión, a
 * /subscription-suspended si el local del usuario está suspendido, o a "/" si la
 * página exige un rol (lista `roles`) que el usuario no tiene. El contador solo entra a las páginas que lo listan
 * en `roles` (la nómina): al iniciar sesión cae directo en /payroll.
 */
export async function protegerPagina(opciones?: { roles?: Rol[] }): Promise<SesionUsuario> {
  const sesion = await obtenerSesionActual();

  if (!sesion) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new Error('EASYSTEM_REDIRECT');
  }

  const estado = await estadoDeEntrada();
  if (!estado.acceso) {
    await redirigirPorBloqueo(estado.motivo);
    throw new Error('EASYSTEM_REDIRECT');
  }

  // Clave temporal: antes de usar nada hay que cambiarla. La ventana del perfil (PerfilUsuario.astro) se abre sola al ver la marca;
  // aquí se detiene la carga para que no se vea ni se pida nada de la página (el servidor además rechaza el resto de la API).
  if (sesion.debe_cambiar_clave) throw new Error('EASYSTEM_REDIRECT');

  const roles = opciones?.roles;
  // El contador solo trabaja en la nómina: cualquier otra página lo lleva allí
  if (sesion.rol === 'contador' && !roles?.includes('contador')) {
    window.location.href = '/payroll';
    throw new Error('EASYSTEM_REDIRECT');
  }

  if (roles && roles.length > 0 && !roles.includes(sesion.rol)) {
    window.location.href = '/';
    throw new Error('EASYSTEM_REDIRECT');
  }

  iniciarVigilanciaCuenta();
  iniciarTiempoReal();
  iniciarLatidos();
  return sesion;
}

// ----------------------------------------------------------------------------
// Panel del administrador: suscripciones y sesiones
// ----------------------------------------------------------------------------
async function exigirAdministrador(): Promise<SesionUsuario> {
  const sesion = await obtenerSesionActual();
  if (sesion?.rol !== 'administrador') throw new Error('Solo el administrador puede hacer esto.');
  return sesion;
}

/** Locales con el estado de su suscripción (todos). */
export async function listarSuscripciones(): Promise<SuscripcionLocal[]> {
  await exigirAdministrador();

  let locales: Local[];
  if (modoServidor) {
    locales = await api.get<Local[]>('/api/locales');
  } else {
    locales = localesPorDefecto().map((l) => ({ ...l, ...leerSuscripcionesLocales()[l.id] }));
  }

  return locales.map((l) => ({
    id: l.id,
    nombre: l.nombre,
    tipo: l.tipo,
    subscription_status: l.subscription_status ?? 'ACTIVE',
    subscription_expires_at: l.subscription_expires_at ?? null,
    vigente: localVigente(l),
  }));
}

/**
 * Activa o suspende un local (o lo marca en mora). `vencimiento`: undefined = no tocar la fecha de vencimiento;
 * null = quitarla; texto ISO = fijarla.
 */
export async function cambiarSuscripcionLocal(localId: string, estado: EstadoSuscripcion, vencimiento?: string | null): Promise<void> {
  await exigirAdministrador();
  const cambiarVencimiento = vencimiento !== undefined;

  if (modoServidor) {
    await api.post(`/api/suscripciones/${localId}`, { estado, vence: cambiarVencimiento ? vencimiento : null, cambiarVencimiento });
    return;
  }

  const todas = leerSuscripcionesLocales();
  const actual = todas[localId] ?? { subscription_status: 'ACTIVE' as EstadoSuscripcion, subscription_expires_at: null };
  todas[localId] = {
    subscription_status: estado,
    subscription_expires_at: cambiarVencimiento ? vencimiento : actual.subscription_expires_at,
  };
  localStorage.setItem(LS_SUSCRIPCIONES, JSON.stringify(todas));
}

/** Todos los usuarios con su local y su última actividad. */
export async function listarUsuariosSistema(): Promise<UsuarioSistema[]> {
  await exigirAdministrador();

  if (modoServidor) return api.get<UsuarioSistema[]>('/api/suscripciones/usuarios');

  const locales = localesPorDefecto().map((l) => ({ ...l, ...leerSuscripcionesLocales()[l.id] }));
  const cierres = leerJsonLS<Record<string, string>>(LS_CIERRES_FORZADOS, {});
  const sesionLS = leerJsonLS<{ id?: string; emitida_en?: string }>(LS_SESION, {});
  return leerUsuariosLocales().map((u) => {
    const local = locales.find((l) => l.id === u.local_id);
    return {
      id: u.id,
      email: u.email,
      nombre: u.nombre,
      rol: u.rol,
      status: u.status ?? 'active',
      local_id: u.local_id,
      local_nombre: local?.nombre ?? null,
      subscription_status: local?.subscription_status ?? null,
      last_sign_in_at: sesionLS.id === u.id ? (sesionLS.emitida_en ?? null) : null,
      last_force_logout_at: cierres[u.id] ?? null,
    };
  });
}

/**
 * "Tiempo real": quién está conectado ahora (solo administrador). En modo demo se ven las pestañas del mismo navegador
 * (la presencia vive en LocalStorage); con servidor, GET /api/admin/active-users.
 */
export async function listarUsuariosActivos(): Promise<ListaPresencia> {
  await exigirAdministrador();
  if (modoServidor) return api.get<ListaPresencia>('/api/admin/active-users');

  const ahora = Date.now();
  const usuarios = leerUsuariosLocales();
  const locales = localesPorDefecto();
  const lista: UsuarioPresencia[] = [];
  for (const [id, p] of Object.entries(leerPresenciaLocal())) {
    const u = usuarios.find((x) => x.id === id);
    if (!u || ahora - p.last_seen_at > 24 * 3_600_000) continue;
    const segundos = Math.max(0, Math.floor((ahora - p.last_seen_at) / 1000));
    const sinLocal = u.rol === 'administrador' || u.rol === 'gerente' || u.rol === 'contador';
    const localId = sinLocal ? p.local_id : u.local_id;
    lista.push({
      id,
      nombre: u.nombre,
      email: u.email,
      rol: u.rol,
      status: u.status ?? 'active',
      local_id: localId,
      local_nombre: localId ? (locales.find((l) => l.id === localId)?.nombre ?? null) : sinLocal ? 'Todos los locales' : null,
      ip: 'este navegador (demo)',
      dispositivo: 'Demo',
      ruta: p.ruta,
      ultimo_latido: new Date(p.last_seen_at).toISOString(),
      segundos,
      estado: calcularEstado(segundos, p.salio_en === null ? null : Math.max(0, Math.floor((ahora - p.salio_en) / 1000))),
    });
  }
  const orden: Record<EstadoPresencia, number> = { en_linea: 0, inactivo: 1, desconectado: 2 };
  lista.sort((a, b) => orden[a.estado] - orden[b.estado] || a.segundos - b.segundos);
  const resumen: Record<EstadoPresencia, number> = { en_linea: 0, inactivo: 0, desconectado: 0 };
  for (const u of lista) resumen[u.estado] += 1;
  return { ahora: new Date(ahora).toISOString(), usuarios_activos: resumen.en_linea, resumen, usuarios: lista };
}

/** Cierra a la fuerza todas las sesiones de un usuario: el próximo chequeo (como máximo 1 minuto) lo saca al login. */
export async function cerrarSesionForzada(usuarioId: string): Promise<void> {
  await exigirAdministrador();

  if (modoServidor) {
    await api.post(`/api/usuarios/${usuarioId}/cerrar-sesion`);
    return;
  }

  const cierres = leerJsonLS<Record<string, string>>(LS_CIERRES_FORZADOS, {});
  cierres[usuarioId] = new Date().toISOString();
  localStorage.setItem(LS_CIERRES_FORZADOS, JSON.stringify(cierres));
}

/** Cierra a la fuerza las sesiones de todos los empleados de un local. Devuelve cuántos usuarios afectó. */
export async function cerrarSesionesLocal(localId: string): Promise<number> {
  await exigirAdministrador();

  if (modoServidor) {
    const { cerradas } = await api.post<{ cerradas: number }>(`/api/suscripciones/${localId}/cerrar-sesiones`);
    return Number(cerradas ?? 0);
  }

  const afectados = leerUsuariosLocales().filter((u) => u.local_id === localId && u.rol !== 'administrador');
  const cierres = leerJsonLS<Record<string, string>>(LS_CIERRES_FORZADOS, {});
  const ahora = new Date().toISOString();
  for (const u of afectados) cierres[u.id] = ahora;
  localStorage.setItem(LS_CIERRES_FORZADOS, JSON.stringify(cierres));
  return afectados.length;
}
