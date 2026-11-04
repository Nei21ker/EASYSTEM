// Consulta de versiones para la actualización en vivo. El cliente pregunta cada pocos segundos y solo
// recarga las pantallas de las tablas cuya versión cambió. Solo se revelan las versiones de lo que el rol
// puede leer (equivale al filtrado por RLS del Realtime de Supabase); el contenido nunca viaja aquí.
import { alcanceDe, alcanceNomina, esGerencia, type Alcance, type Sesion } from '../authz';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';

export interface VersionCambio {
  tabla: string;
  local_id: string | null;
  version: number;
}

// Tablas globales (local_id vacío): el catálogo y la tasa
const TABLAS_CATALOGO = ['productos', 'modelos_telefono', 'compatibilidades', 'tasas_cambio'];
// Tablas por local
const TABLAS_LOCAL = ['inventario_local', 'movimientos_inventario', 'unidades_producto', 'ventas', 'devoluciones', 'ordenes_servicio'];
const TABLAS_CUADRE = ['cuadres_caja'];
const TABLAS_NOMINA = ['empleados', 'nominas', 'nomina_reventas'];
// Los avisos de cuenta (suspensión, cierre de sesión, desactivación) los necesita todo el que tenga sesión
const TABLAS_CUENTA = ['locales', 'perfiles'];

async function intentar(obtener: () => Promise<Alcance>): Promise<Alcance | null> {
  try {
    return await obtener();
  } catch (err) {
    // Sin permiso, sin local o local suspendido: simplemente no se ve esa familia de tablas
    if (err instanceof ErrorApi && err.status === 403) return null;
    throw err;
  }
}

export async function versionesVisibles(env: Entorno, sesion: Sesion): Promise<VersionCambio[]> {
  const filas = (await env.DB.prepare('SELECT tabla, local_id, version FROM cambios').all<{ tabla: string; local_id: string; version: number }>()).results;

  const alcanceNegocio = await intentar(() => alcanceDe(env, sesion));
  const alcanceNom = await intentar(() => alcanceNomina(env, sesion));
  const permitido = (alcance: Alcance | null, tabla: string, local: string, tablas: string[]) =>
    alcance !== null && tablas.includes(tabla) && (alcance.tipo === 'todos' || alcance.ids.includes(local));

  return filas
    .filter((f) => {
      if (TABLAS_CUENTA.includes(f.tabla)) return f.local_id === '';
      if (TABLAS_CATALOGO.includes(f.tabla)) return alcanceNegocio !== null && f.local_id === '';
      if (TABLAS_LOCAL.includes(f.tabla)) return permitido(alcanceNegocio, f.tabla, f.local_id, TABLAS_LOCAL);
      if (TABLAS_CUADRE.includes(f.tabla)) return esGerencia(sesion.rol) && permitido(alcanceNegocio, f.tabla, f.local_id, TABLAS_CUADRE);
      if (TABLAS_NOMINA.includes(f.tabla)) {
        // `empleados` también se crea con local; `nominas` y `nomina_reventas` igual
        return permitido(alcanceNom, f.tabla, f.local_id, TABLAS_NOMINA);
      }
      return false;
    })
    .map((f) => ({ tabla: f.tabla, local_id: f.local_id === '' ? null : f.local_id, version: f.version }));
}
