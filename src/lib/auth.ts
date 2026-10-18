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
import { LOCAL_ACCESORIOS_ID, LOCAL_SERVICIO_TECNICO_ID, LOCAL_VIDRIOS_ID } from './constantes-locales';

/**
 * administrador: acceso global (todos los locales). encargado: gerente de UN local. vendedor: cajero de un local.
 * tecnico: servicio técnico de un local. Todos menos el administrador solo ven y modifican datos de su local.
 */
export type Rol = 'administrador' | 'encargado' | 'vendedor' | 'tecnico';

export const ETIQUETAS_ROL: Record<Rol, string> = {
  administrador: 'Administrador',
  encargado: 'Encargado',
  vendedor: 'Vendedor (cajero)',
  tecnico: 'Técnico',
};

export const ROLES: Rol[] = ['administrador', 'encargado', 'vendedor', 'tecnico'];

export interface SesionUsuario {
  id: string;
  email: string;
  nombre: string;
  rol: Rol;
  /** Local asignado. El administrador tiene acceso a todos (su local_id es irrelevante); null = sin local asignado */
  local_id: string | null;
}

// --- Permisos por rol (la base de datos los vuelve a exigir con RLS; esto solo gobierna la interfaz) ---
export const esAdministrador = (rol?: Rol | null) => rol === 'administrador';
/** Registrar entradas de mercancía y devoluciones, y ver reportes de su local */
export const esGerencia = (rol?: Rol | null) => rol === 'administrador' || rol === 'encargado';

const LS_SESION = 'easystem:sesion';
const LS_USUARIOS = 'easystem:usuarios';

interface UsuarioLocal extends SesionUsuario {
  password: string;
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
  ];
}

/** Usuarios guardados antes del multi-local: sin local → Accesorios; y se agregan las cuentas demo que falten. */
function migrarUsuariosLocales(usuarios: UsuarioLocal[]): { usuarios: UsuarioLocal[]; cambio: boolean } {
  let cambio = false;
  for (const u of usuarios) {
    if (u.local_id === undefined) {
      u.local_id = u.rol === 'administrador' ? null : LOCAL_ACCESORIOS_ID;
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

    return { id: data.user.id, email: perfil.email, nombre: perfil.nombre, rol: perfil.rol, local_id: perfil.local_id ?? null };
  }

  const usuario = leerUsuariosLocales().find((u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password);
  if (!usuario) throw new Error('Correo o contraseña incorrectos.');

  const { password: _sinUsar, ...sesion } = usuario;
  localStorage.setItem(LS_SESION, JSON.stringify(sesion));
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

    return { id: data.session.user.id, email: perfil.email, nombre: perfil.nombre, rol: perfil.rol, local_id: perfil.local_id ?? null };
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
  /** Local asignado (obligatorio salvo para un administrador) */
  local_id?: string | null;
}): Promise<{ requiereConfirmacion: boolean }> {
  const sesion = await obtenerSesionActual();
  if (sesion?.rol !== 'administrador') {
    throw new Error('Solo un administrador puede crear usuarios.');
  }

  const rol = input.rol ?? 'vendedor';
  const email = input.email.trim().toLowerCase();
  const nombre = input.nombre.trim();
  if (!nombre) throw new Error('El nombre es obligatorio.');
  const local_id = rol === 'administrador' ? null : (input.local_id ?? null);
  if (rol !== 'administrador' && !local_id) throw new Error('Elige el local al que pertenece el empleado.');
  if (input.password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');

  if (supabaseConfigurado) {
    // Paso 1: autorizar el correo. Se borran autorizaciones viejas del mismo
    // correo para no acumular filas.
    await supabase.from('usuarios_autorizados').delete().eq('email', email);
    const { error: errorAutorizar } = await supabase.from('usuarios_autorizados').insert({ email });
    if (errorAutorizar) {
      throw new Error(
        'No se pudo autorizar el correo (¿aplicaste la migración 0004 en Supabase?): ' + errorAutorizar.message
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
    return (data ?? []).map((p: any) => ({ id: p.id, email: p.email, nombre: p.nombre, rol: p.rol, local_id: p.local_id ?? null }));
  }

  return leerUsuariosLocales().map(({ password: _sinUsar, ...resto }) => resto);
}

/** Cambia el rol y/o el local de un empleado (solo administrador; la base de datos lo exige con RLS). */
export async function actualizarAccesoUsuario(id: string, cambios: { rol?: Rol; local_id?: string | null }): Promise<void> {
  const rolFinal = cambios.rol;
  const parche: { rol?: Rol; local_id?: string | null } = { ...cambios };
  if (rolFinal === 'administrador') parche.local_id = null; // el administrador es global

  if (supabaseConfigurado) {
    const { error } = await supabase.from('perfiles').update(parche).eq('id', id);
    if (error) throw error;
    return;
  }

  const usuarios = leerUsuariosLocales();
  const usuario = usuarios.find((u) => u.id === id);
  if (!usuario) throw new Error('Usuario no encontrado.');
  Object.assign(usuario, parche);
  guardarUsuariosLocales(usuarios);
}

/**
 * Guard de ruta para páginas protegidas: llamarlo al inicio del <script> de
 * cada página (vía DashboardLayout). Redirige a /login si no hay sesión, o a
 * "/" si la página exige un rol (lista `roles`) que el usuario no tiene.
 */
export async function protegerPagina(opciones?: { roles?: Rol[] }): Promise<SesionUsuario> {
  const sesion = await obtenerSesionActual();

  if (!sesion) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new Error('EASYSTEM_REDIRECT');
  }

  if (opciones?.roles && opciones.roles.length > 0 && !opciones.roles.includes(sesion.rol)) {
    window.location.href = '/';
    throw new Error('EASYSTEM_REDIRECT');
  }

  return sesion;
}
