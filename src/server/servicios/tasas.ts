// Tasa del dólar (bolívares por $1): historial de solo agregar; la vigente es la última registrada.
import { alcanceDe, type Sesion } from '../authz';
import { avisarCambio } from '../cambios';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';
import { ahoraISO, nuevoId } from '../util';
import { usdDesdeBs } from '../../utils/precioBs';
import type { TasaCambio } from '../../types/database.types';

/** Bolívares por $1 de la última tasa registrada (null si todavía no hay ninguna). Sin comprobar permisos: quien llama ya los comprobó. */
export async function tasaVigente(env: Entorno): Promise<number | null> {
  const fila = await env.DB.prepare('SELECT tasa FROM tasas_cambio ORDER BY created_at DESC, rowid DESC LIMIT 1').first<{ tasa: number }>();
  return fila && fila.tasa > 0 ? fila.tasa : null;
}

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
  // Los productos con precio FIJO en bolívares cambian su equivalente en dólares con la tasa nueva (en el mismo lote que la tasa)
  const resultados = await env.DB.batch([
    env.DB
      .prepare('INSERT INTO tasas_cambio (id, fecha, tasa, created_at, registrado_por, registrado_nombre) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(fila.id, fila.fecha, fila.tasa, fila.created_at, fila.registrado_por, fila.registrado_nombre),
    env.DB
      .prepare("UPDATE productos SET precio_venta = round(precio_bs / ?, 6) WHERE moneda_precio = 'BS' AND precio_bs > 0")
      .bind(fila.tasa),
  ]);
  const productosAjustados = (resultados[1].meta.changes ?? 0) > 0;
  await avisarCambio(env.DB, productosAjustados ? ['tasas_cambio', 'productos'] : ['tasas_cambio']);
  const { registrado_por: _quien, ...tasa } = fila;
  return tasa;
}
