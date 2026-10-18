// Los 3 locales del negocio y sus ids fijos (los mismos que siembra la migración 0016).
// Archivo sin dependencias: lo usan el modo LocalStorage, los datos de ejemplo y el servicio.
import type { Local } from '../types/database.types';

export const LOCAL_ACCESORIOS_ID = '00000000-0000-4000-8000-000000000001';
export const LOCAL_VIDRIOS_ID = '00000000-0000-4000-8000-000000000002';
export const LOCAL_SERVICIO_TECNICO_ID = '00000000-0000-4000-8000-000000000003';

/** Valor del selector de local que significa "todos los locales" (solo administrador). */
export const ALCANCE_TODOS = 'todos';

export function localesPorDefecto(): Local[] {
  const creado = '2026-01-01T00:00:00.000Z';
  return [
    { id: LOCAL_ACCESORIOS_ID, nombre: 'Local Accesorios', tipo: 'accesorios', activo: true, created_at: creado },
    { id: LOCAL_VIDRIOS_ID, nombre: 'Local Vidrios', tipo: 'vidrios', activo: true, created_at: creado },
    { id: LOCAL_SERVICIO_TECNICO_ID, nombre: 'Local Servicio Técnico', tipo: 'servicio_tecnico', activo: true, created_at: creado },
  ];
}
