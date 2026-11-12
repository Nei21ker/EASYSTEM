// Reglas puras del alta de un local, compartidas por el servidor y el modo demo.
import type { TipoLocal } from '../types/database.types';

export const TIPOS_LOCAL: { valor: TipoLocal; etiqueta: string }[] = [
  { valor: 'accesorios', etiqueta: 'Accesorios' },
  { valor: 'vidrios', etiqueta: 'Vidrios' },
  { valor: 'servicio_tecnico', etiqueta: 'Servicio técnico' },
  { valor: 'controles', etiqueta: 'Controles' },
];

export interface DatosLocal {
  nombre: string;
  tipo: TipoLocal;
  /** Centro comercial o zona donde está (p. ej. «Cosmos», «Barquicenter») */
  sede?: string | null;
  direccion?: string | null;
  telefono?: string | null;
}

export interface LocalNormalizado {
  nombre: string;
  tipo: TipoLocal;
  sede: string | null;
  direccion: string | null;
  telefono: string | null;
}

const limpiar = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim();

/** Devuelve el local limpio o el texto del error (en español). */
export function normalizarLocalNuevo(d: DatosLocal): LocalNormalizado | string {
  const nombre = limpiar(d.nombre);
  if (nombre.length < 3 || nombre.length > 60) return 'El nombre del local debe tener entre 3 y 60 caracteres.';
  if (!TIPOS_LOCAL.some((t) => t.valor === d.tipo)) return 'Elige el tipo de local.';
  const sede = limpiar(d.sede);
  if (sede && (sede.length < 2 || sede.length > 40)) return 'La sede debe tener entre 2 y 40 caracteres (p. ej. Barquicenter).';
  const direccion = limpiar(d.direccion);
  if (direccion.length > 120) return 'La dirección es demasiado larga (máximo 120 caracteres).';
  const telefono = limpiar(d.telefono);
  if (telefono.length > 30) return 'El teléfono es demasiado largo.';
  return { nombre, tipo: d.tipo, sede: sede || null, direccion: direccion || null, telefono: telefono || null };
}

/** Etiqueta para listas: «Local Vidrios · Barquicenter» (sin sede, solo el nombre). */
export const nombreConSede = (l: { nombre: string; sede?: string | null }) => (l.sede ? `${l.nombre} · ${l.sede}` : l.nombre);
