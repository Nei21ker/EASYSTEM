// Los 4 locales del negocio y sus ids fijos (los tres primeros, los mismos que siembra la migración 0016 de Postgres;
// el Local de controles es nuevo y lo siembra migrations/0002_seed.sql de Cloudflare D1).
// Archivo sin dependencias: lo usan el modo LocalStorage, los datos de ejemplo y el servicio.
import type { Local } from '../types/database.types';

export const LOCAL_ACCESORIOS_ID = '00000000-0000-4000-8000-000000000001';
export const LOCAL_VIDRIOS_ID = '00000000-0000-4000-8000-000000000002';
export const LOCAL_SERVICIO_TECNICO_ID = '00000000-0000-4000-8000-000000000003';
export const LOCAL_CONTROLES_ID = '00000000-0000-4000-8000-000000000004';

/** Valor del selector de local que significa "todos los locales" (solo administrador). */
export const ALCANCE_TODOS = 'todos';

/** ¿La suscripción del local está vigente? (ACTIVE y sin vencer). Es lo mismo que exige la función SQL local_vigente(). */
export function localVigente(local: Pick<Local, 'activo' | 'subscription_status' | 'subscription_expires_at'>): boolean {
  if (!local.activo) return false;
  if ((local.subscription_status ?? 'ACTIVE') !== 'ACTIVE') return false;
  return !local.subscription_expires_at || new Date(local.subscription_expires_at).getTime() > Date.now();
}

export function localesPorDefecto(): Local[] {
  const creado = '2026-01-01T00:00:00.000Z';
  return [
    { id: LOCAL_ACCESORIOS_ID, nombre: 'Local Accesorios', tipo: 'accesorios', sede: 'Cosmos', activo: true, created_at: creado },
    { id: LOCAL_VIDRIOS_ID, nombre: 'Local Vidrios', tipo: 'vidrios', sede: 'Cosmos', activo: true, created_at: creado },
    { id: LOCAL_SERVICIO_TECNICO_ID, nombre: 'Local Servicio Técnico', tipo: 'servicio_tecnico', sede: 'Cosmos', activo: true, created_at: creado },
    { id: LOCAL_CONTROLES_ID, nombre: 'Local de controles', tipo: 'controles', sede: 'Cosmos', activo: true, created_at: creado },
  ];
}

/** Agrega los locales por defecto que falten (por id) en una lista guardada antes de que existieran (modo demo). */
export function agregarLocalesFaltantes(guardados: Local[]): { locales: Local[]; cambio: boolean } {
  const faltantes = localesPorDefecto().filter((d) => !guardados.some((g) => g.id === d.id));
  return faltantes.length === 0 ? { locales: guardados, cambio: false } : { locales: [...guardados, ...faltantes], cambio: true };
}
