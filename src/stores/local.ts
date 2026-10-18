// Contexto de local compartido por toda la interfaz (equivalente al "Store Context" del multi-local).
// Lo llena inventoryService.obtenerContextoLocal() al cargar cada página; los componentes lo leen con
// $contextoLocal.get() / .listen() o con la propia función del servicio, y el selector del encabezado
// cambia de local con inventoryService.cambiarLocalActivo() (que recarga la vista).
import { atom } from 'nanostores';
import type { SesionUsuario } from '../lib/auth';
import type { Local } from '../types/database.types';

export interface ContextoLocal {
  sesion: SesionUsuario;
  /** Locales que el usuario puede ver: todos para el administrador; solo el suyo para el resto */
  locales: Local[];
  /** 'todos' (solo administrador), el id del local activo, o null si el usuario no tiene local asignado */
  alcance: string | null;
  /** El local concreto del alcance (null en "todos" o sin local asignado) */
  local: Local | null;
}

/** null mientras se carga la sesión (o si no hay sesión) */
export const $contextoLocal = atom<ContextoLocal | null>(null);
