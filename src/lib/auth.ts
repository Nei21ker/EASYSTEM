// Servicio de autenticación y roles, con el mismo patrón dual que
// inventoryService.ts: Supabase Auth cuando hay credenciales (.env), o un
// simulador de usuarios en LocalStorage cuando no las hay.
//
// AVISO DE SEGURIDAD: el modo LocalStorage guarda las "contraseñas" en texto
// plano en el navegador. Es intencional y está bien para probar la UI de
// login/roles sin backend, pero NUNCA debe tratarse como autenticación real.
// La autenticación real (hashing, tokens, RLS) la provee Supabase Auth
// cuando está configurado.
import { createClient } from '@supabase/supabase-js';
import { supabase, supabaseConfigurado, supabaseUrl, supabaseAnonKey } from './supabase';
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
  if (rol === 'gerente') return ['encargado', 'vendedor', 'tecnico'];
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
}

/** Por qué una cuenta no tiene acceso a los datos (ver estado_cuenta() en la migración 0021). */
export type MotivoBloqueo = 'ok' | 'local_suspendido' | 'usuario_inactivo' | 'sesion_cerrada' | 'sin_perfil';

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
const LS_USUARIOS = 'easystem:usuarios';
// Simulador de suscripciones y cierres forzados (solo modo LocalStorage; con Supabase viven en la base de datos)
const LS_SUSCRIPCIONES = 'easystem:suscripciones';
const LS_CIERRES_FORZADOS = 'easystem:cierres-forzados';

interface UsuarioLocal extends SesionUsuario {
  password: string;
}

function sesionDesdePerfil(id: string, perfil: any): SesionUsuario {
  return { id, email: perfil.email, nombre: perfil.nombre, rol: perfil.rol, local_id: perfil.local_id ?? null, status: perfil.status ?? 'active' };
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
// la misma carga de página para no repetir la consulta a Supabase/localStorage.
let sesionEnCache: Promise<SesionUsuario | null> | null = null;

function invalidarCacheSesion() {
  sesionEnCache = null;
}

/** Traduce los mensajes de error de Supabase Auth a algo accionable para el usuario. */
function traducirErrorAuth(mensaje: string): string {
  const m = mensaje.toLowerCase();
  if (m.includes('email not confirmed')) {
    return 'Tu correo aún no está confirmado. Abre el enlace que te enviamos por correo (revisa también spam) y vuelve a iniciar sesión.';
  }
  if (m.includes('invalid login credentials')) return 'Correo o contraseña incorrectos.';
  if (m.includes('user already registered')) return 'Ya existe una cuenta con ese correo.';
  if (m.includes('password should be at least')) return 'La contraseña debe tener al menos 6 caracteres.';
  if (m.includes('email logins are disabled') || m.includes('email_provider_disabled')) {
    return 'El inicio de sesión con correo está desactivado en Supabase. Actívalo en Authentication → Sign In / Providers → Email → "Enable Email provider".';
  }
  if (m.includes('registro_no_autorizado') || m.includes('database error saving new user')) {
    return 'No se pudo crear la cuenta: el correo no está autorizado o falta aplicar las migraciones 0002–0004 de Supabase.';
  }
  if (m.includes('signups not allowed')) return 'El registro de cuentas nuevas está deshabilitado en Supabase.';
  if (m.includes('rate limit')) return 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';
  return mensaje;
}

export async function iniciarSesion(email: string, password: string): Promise<SesionUsuario> {
  if (supabaseConfigurado) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(traducirErrorAuth(error.message));
    if (!data.user) throw new Error('Correo o contraseña incorrectos.');

    const { data: perfil, error: errorPerfil } = await supabase
      .from('perfiles')
      .select('*')
      .eq('id', data.user.id)
      .maybeSingle();
    if (errorPerfil || !perfil) {
      throw new Error('Tu cuenta no tiene un perfil asociado todavía. Contacta a un administrador.');
    }

    return sesionDesdePerfil(data.user.id, perfil);
  }

  const usuario = leerUsuariosLocales().find((u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password);
  if (!usuario) throw new Error('Correo o contraseña incorrectos.');

  const { password: _sinUsar, ...sesion } = usuario;
  // emitida_en equivale al "iat" del token: un cierre forzado posterior la invalida
  localStorage.setItem(LS_SESION, JSON.stringify({ ...sesion, emitida_en: new Date().toISOString() }));
  invalidarCacheSesion();
  return sesion;
}

export async function cerrarSesion(): Promise<void> {
  invalidarCacheSesion();
  if (supabaseConfigurado) {
    await supabase.auth.signOut();
    return;
  }
  localStorage.removeItem(LS_SESION);
}

export async function obtenerSesionActual(): Promise<SesionUsuario | null> {
  if (!sesionEnCache) sesionEnCache = cargarSesionActual();
  return sesionEnCache;
}

async function cargarSesionActual(): Promise<SesionUsuario | null> {
  if (supabaseConfigurado) {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.user) return null;

    const { data: perfil } = await supabase.from('perfiles').select('*').eq('id', data.session.user.id).maybeSingle();
    if (!perfil) return null;

    return sesionDesdePerfil(data.session.user.id, perfil);
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
 * En modo Supabase el alta es de dos pasos, porque la base de datos rechaza
 * cualquier registro cuyo correo no haya sido autorizado antes por un admin
 * (trigger `verificar_registro_autorizado`, migración 0004):
 *   1. el administrador autoriza el correo (tabla usuarios_autorizados, RLS);
 *   2. se crea la cuenta con un cliente aislado (persistSession: false) para que
 *      el signUp no reemplace la sesión del administrador.
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
  if (input.password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');

  if (supabaseConfigurado) {
    // Paso 1: autorizar el correo. Se borran autorizaciones viejas del mismo
    // correo para no acumular filas.
    await supabase.from('usuarios_autorizados').delete().eq('email', email);
    const { error: errorAutorizar } = await supabase.from('usuarios_autorizados').insert({ email });
    if (errorAutorizar) {
      const sinPermiso = /row-level security|permission denied/i.test(errorAutorizar.message);
      throw new Error(
        sinPermiso
          ? 'Tu cuenta no tiene permiso para crear usuarios. Revisa que tu rol sea administrador o gerente y que las migraciones 0022 y 0023 estén aplicadas en Supabase (detalle: ' + errorAutorizar.message + ')'
          : 'No se pudo autorizar el correo (¿aplicaste la migración 0004 en Supabase?): ' + errorAutorizar.message
      );
    }

    // Paso 2: crear la cuenta. El rol NO viaja en el metadata: el trigger de
    // perfiles siempre crea 'vendedor' y el ascenso lo hace el admin abajo.
    const clienteAislado = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await clienteAislado.auth.signUp({
      email,
      password: input.password,
      options: { data: { nombre } },
    });

    if (error || !data.user || data.user.identities?.length === 0) {
      // No dejar la autorización abierta si el alta falló (si ya se consumió,
      // este delete simplemente no encuentra filas).
      await supabase.from('usuarios_autorizados').delete().eq('email', email);
      if (error) throw new Error(traducirErrorAuth(error.message));
      throw new Error('Ya existe una cuenta con ese correo.');
    }

    // El perfil nace como 'vendedor' sin local; el administrador asigna el rol y el local
    const { error: errorRol } = await supabase.from('perfiles').update({ rol, local_id }).eq('id', data.user.id);
    if (errorRol) throw new Error('La cuenta se creó, pero no se pudo asignar el rol y el local: ' + errorRol.message);

    return { requiereConfirmacion: !data.session };
  }

  const usuarios = leerUsuariosLocales();
  if (usuarios.some((u) => u.email.toLowerCase() === email)) {
    throw new Error('Ya existe un usuario con ese correo.');
  }
  usuarios.push({ id: generarId(), email, password: input.password, nombre, rol, local_id });
  guardarUsuariosLocales(usuarios);
  return { requiereConfirmacion: false };
}

export async function listarUsuarios(): Promise<SesionUsuario[]> {
  if (supabaseConfigurado) {
    const { data, error } = await supabase.from('perfiles').select('*').order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((p: any) => sesionDesdePerfil(p.id, p));
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

  if (supabaseConfigurado) {
    const { error } = await supabase.from('perfiles').update(parche).eq('id', id);
    if (error) throw error;
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

  if (supabaseConfigurado) {
    const { error } = await supabase.rpc('eliminar_usuario', { p_usuario: id });
    if (error) throw new Error(error.message);
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
  if (clave.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');

  if (supabaseConfigurado) {
    const { error } = await supabase.rpc('cambiar_clave_usuario', { p_usuario: id, p_clave: clave });
    if (error) throw new Error(error.message);
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
  guardarUsuariosLocales(usuarios);
  if (actor?.id !== id) {
    const cierres = leerJsonLS<Record<string, string>>(LS_CIERRES_FORZADOS, {});
    cierres[id] = new Date().toISOString();
    localStorage.setItem(LS_CIERRES_FORZADOS, JSON.stringify(cierres));
  }
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

/** Estado de la cuenta del usuario con sesión: sin consultar caché (se llama al entrar a cada página y cada minuto). */
export async function obtenerEstadoCuenta(): Promise<EstadoCuenta> {
  const sesion = await obtenerSesionActual();
  if (!sesion) return { acceso: false, motivo: 'sin_perfil' };

  if (supabaseConfigurado) {
    // Si la consulta falla (sin conexión, o la migración 0021 aún no se aplicó) NO se bloquea: el sistema
    // sigue funcionando sin conexión, y la base de datos es quien realmente niega los datos.
    try {
      const { data, error } = await supabase.rpc('estado_cuenta');
      if (error || !data) return { acceso: true, motivo: 'ok' };
      return data as EstadoCuenta;
    } catch {
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
    if (window.location.pathname !== '/subscription-suspended') window.location.href = '/subscription-suspended';
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

  const estado = await obtenerEstadoCuenta();
  if (!estado.acceso) {
    await redirigirPorBloqueo(estado.motivo);
    throw new Error('EASYSTEM_REDIRECT');
  }

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
  if (supabaseConfigurado) {
    const { data, error } = await supabase.from('locales').select('*').order('created_at', { ascending: true });
    if (error) throw error;
    locales = (data ?? []) as Local[];
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

  if (supabaseConfigurado) {
    const { error } = await supabase.rpc('cambiar_suscripcion_local', {
      p_local: localId,
      p_estado: estado,
      p_vence: cambiarVencimiento ? vencimiento : null,
      p_cambiar_vencimiento: cambiarVencimiento,
    });
    if (error) throw new Error(error.message);
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

  if (supabaseConfigurado) {
    const { data, error } = await supabase.rpc('usuarios_sistema');
    if (error) throw new Error(error.message);
    return (data ?? []) as UsuarioSistema[];
  }

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

/** Cierra a la fuerza todas las sesiones de un usuario: el próximo chequeo (como máximo 1 minuto) lo saca al login. */
export async function cerrarSesionForzada(usuarioId: string): Promise<void> {
  await exigirAdministrador();

  if (supabaseConfigurado) {
    const { error } = await supabase.rpc('cerrar_sesion_forzada', { p_usuario: usuarioId });
    if (error) throw new Error(error.message);
    return;
  }

  const cierres = leerJsonLS<Record<string, string>>(LS_CIERRES_FORZADOS, {});
  cierres[usuarioId] = new Date().toISOString();
  localStorage.setItem(LS_CIERRES_FORZADOS, JSON.stringify(cierres));
}

/** Cierra a la fuerza las sesiones de todos los empleados de un local. Devuelve cuántos usuarios afectó. */
export async function cerrarSesionesLocal(localId: string): Promise<number> {
  await exigirAdministrador();

  if (supabaseConfigurado) {
    const { data, error } = await supabase.rpc('cerrar_sesiones_local', { p_local: localId });
    if (error) throw new Error(error.message);
    return Number(data ?? 0);
  }

  const afectados = leerUsuariosLocales().filter((u) => u.local_id === localId && u.rol !== 'administrador');
  const cierres = leerJsonLS<Record<string, string>>(LS_CIERRES_FORZADOS, {});
  const ahora = new Date().toISOString();
  for (const u of afectados) cierres[u.id] = ahora;
  localStorage.setItem(LS_CIERRES_FORZADOS, JSON.stringify(cierres));
  return afectados.length;
}
