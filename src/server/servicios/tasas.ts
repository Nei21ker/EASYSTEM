// Tasa del dólar (bolívares por $1): historial de solo agregar; la vigente es la última registrada.
import { alcanceDe, type Sesion } from '../authz';
import { avisarCambio } from '../cambios';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';
import { ahoraISO, nuevoId } from '../util';
import type { TasaCambio } from '../../types/database.types';

export async function obtenerUltimaTasa(env: Entorno, sesion: Sesion): Promise<TasaCambio | null> {
  await alcanceDe(env, sesion); // acceso al catálogo (el contador no lo tiene)
  return env.DB.prepare('SELECT * FROM tasas_cambio ORDER BY created_at DESC, rowid DESC LIMIT 1').first<TasaCambio>();
}

/** Cualquier usuario con acceso la registra (así nadie espera al administrador). */
export async function registrarTasa(
  env: Entorno,
  sesion: Sesion,
  datos: { fecha: string; tasa: number; registrado_nombre?: string | null }
): Promise<TasaCambio> {
  await alcanceDe(env, sesion);
  if (!(datos.tasa > 0) || datos.tasa >= 10_000_000) throw new ErrorApi(400, 'La tasa debe ser un número mayor a 0.', 'tasa_invalida');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha)) throw new ErrorApi(400, 'La fecha de la tasa no es válida.', 'fecha_invalida');

  const fila: TasaCambio & { registrado_por: string } = {
    id: nuevoId(),
    fecha: datos.fecha,
    tasa: datos.tasa,
    created_at: ahoraISO(),
    registrado_nombre: datos.registrado_nombre ?? sesion.nombre,
    registrado_por: sesion.userId,
  };
  await env.DB
    .prepare('INSERT INTO tasas_cambio (id, fecha, tasa, created_at, registrado_por, registrado_nombre) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(fila.id, fila.fecha, fila.tasa, fila.created_at, fila.registrado_por, fila.registrado_nombre)
    .run();
  await avisarCambio(env.DB, ['tasas_cambio']);
  const { registrado_por: _quien, ...tasa } = fila;
  return tasa;
}
