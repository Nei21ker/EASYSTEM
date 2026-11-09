// Mermas: piezas botadas de productos "por cantidad" (mercancía de $1 a $3 sin etiqueta por pieza, ver migración 0017).
//   · Al vender: una pieza viene defectuosa (o se daña al colocarla) y NO se le cobra al cliente; sale del stock como BAJA junto con la
//     venta, en UN solo lote atómico (nunca queda la venta sin la baja ni al revés). Lo hace el encargado, el gerente o el administrador;
//     con 3 o más piezas defectuosas en la misma venta hace falta la clave de un gerente o administrador (`autorizarDanados`).
//   · Desde Mercancía → Descargo: se botan piezas por cantidad sin que haya una venta.
// Cada baja queda en `movimientos_inventario` (tipo BAJA) y en `mermas` (quién, por qué, con qué autorización).
import { alcanceDe, condicionAlcance, esGerencia, localAccesible, type Sesion } from '../authz';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';
import { MOTIVOS_MERMA, type Merma, type MotivoMerma } from '../../types/database.types';
import { limiteSeguro } from '../util';
import { UMBRAL_CLAVE_DANADOS, verificarDanados } from './autorizaciones';
import { registrarMovimientos, type DatosMerma, type ResultadoMovimiento } from './movimientos';

export { MOTIVOS_MERMA };
export type { Merma, MotivoMerma };

const entero = (n: unknown, mensaje: string, maximo = 500): number => {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > maximo) throw new ErrorApi(400, mensaje, 'datos_invalidos');
  return n;
};

function limpiarMerma(motivo: unknown, nota: unknown): { motivo: MotivoMerma | null; nota: string | null } {
  if (motivo !== undefined && motivo !== null && !MOTIVOS_MERMA.some((m) => m.id === motivo)) throw new ErrorApi(400, 'El motivo de la pérdida no es válido.', 'datos_invalidos');
  const texto = typeof nota === 'string' ? nota.trim().replace(/\s+/g, ' ') : '';
  if (texto.length > 300) throw new ErrorApi(400, 'La nota es muy larga (máximo 300 caracteres).', 'datos_invalidos');
  return { motivo: (motivo as MotivoMerma | null | undefined) ?? null, nota: texto || null };
}

const textoMotivo = (motivo: MotivoMerma | null) => MOTIVOS_MERMA.find((m) => m.id === motivo)?.nombre;

export interface DatosSalidaConMerma {
  productoId: string;
  localId: string;
  /** Piezas que se cobran (salen como venta); mínimo 1 */
  cantidad: number;
  /** Piezas defectuosas o dañadas que NO se cobran (salen como baja) */
  danados: number;
  /** Total de piezas defectuosas de TODA la venta (todas las líneas): decide si hace falta clave. Por defecto, las de esta línea. */
  danadosVenta?: number;
  motivo?: MotivoMerma | null;
  nota?: string | null;
  /** Autorización firmada (`autorizarDanados`): obligatoria si las defectuosas de la venta son 3 o más */
  autorizacion?: string;
}

/** La salida por venta y la baja de las piezas defectuosas, en un solo lote atómico. */
export async function registrarSalidaConMerma(env: Entorno, sesion: Sesion, datos: DatosSalidaConMerma): Promise<{ salida: ResultadoMovimiento; baja: ResultadoMovimiento }> {
  if (!esGerencia(sesion.rol)) throw new ErrorApi(403, 'Solo el encargado, el gerente o el administrador pueden marcar piezas defectuosas.', 'sin_permiso');
  const cantidad = entero(datos.cantidad, 'Se debe cobrar al menos una pieza (la que sí sirvió).');
  const danados = entero(datos.danados, 'La cantidad de piezas defectuosas debe ser un entero mayor a 0.');
  const totalVenta = Math.max(danados, datos.danadosVenta ?? danados);
  if (!(await localAccesible(env, sesion, datos.localId))) throw new ErrorApi(403, 'No tienes acceso a ese local.', 'sin_permiso');
  const { motivo, nota } = limpiarMerma(datos.motivo, datos.nota);

  const aut = totalVenta >= UMBRAL_CLAVE_DANADOS ? await verificarDanados(env, sesion, datos.localId, totalVenta, datos.autorizacion ?? '') : null;
  const merma: DatosMerma = { origen: 'VENTA', motivo, nota, autorizadoPor: aut?.autorizado_por ?? null, autorizadoNombre: aut?.autorizado_nombre ?? null };
  const [salida, baja] = await registrarMovimientos(env, sesion, [
    { productoId: datos.productoId, tipo: 'SALIDA', cantidad, localId: datos.localId, motivo: 'Venta POS' },
    {
      productoId: datos.productoId,
      tipo: 'BAJA',
      cantidad: danados,
      localId: datos.localId,
      motivo: `Pieza defectuosa en una venta${textoMotivo(motivo) ? ` (${textoMotivo(motivo)})` : ''}${nota ? `: ${nota}` : ''}`,
      merma,
    },
  ]);
  return { salida, baja };
}

export interface DatosBajaPorCantidad {
  productoId: string;
  localId: string;
  cantidad: number;
  motivo?: MotivoMerma | null;
  nota?: string | null;
}

/** Bota piezas de un producto por cantidad sin que haya una venta (Mercancía → Descargo). Administrador, gerente y encargado de ese local. */
export async function darDeBajaPorCantidad(env: Entorno, sesion: Sesion, datos: DatosBajaPorCantidad): Promise<ResultadoMovimiento> {
  if (!esGerencia(sesion.rol)) throw new ErrorApi(403, 'Solo el administrador, el gerente o el encargado pueden dar de baja mercancía.', 'sin_permiso');
  const cantidad = entero(datos.cantidad, 'La cantidad debe ser un entero mayor a 0.', 5000);
  if (!(await localAccesible(env, sesion, datos.localId))) throw new ErrorApi(403, 'Solo puedes dar de baja mercancía de tu propio local.', 'sin_permiso');
  const { motivo, nota } = limpiarMerma(datos.motivo, datos.nota);
  const [baja] = await registrarMovimientos(env, sesion, [
    {
      productoId: datos.productoId,
      tipo: 'BAJA',
      cantidad,
      localId: datos.localId,
      motivo: `Baja por cantidad${textoMotivo(motivo) ? ` (${textoMotivo(motivo)})` : ''}${nota ? `: ${nota}` : ''}`,
      merma: { origen: 'DESCARGO', motivo, nota },
    },
  ]);
  return baja;
}

/** Las pérdidas registradas (más recientes primero) dentro del alcance del usuario. Solo administrador, gerente y encargado. */
export async function listarMermas(env: Entorno, sesion: Sesion, opciones: { desde?: string; hasta?: string; localId?: string; limite?: number } = {}): Promise<Merma[]> {
  if (!esGerencia(sesion.rol)) throw new ErrorApi(403, 'Solo el administrador, el gerente o el encargado ven las pérdidas.', 'sin_permiso');
  const alcance = await alcanceDe(env, sesion, opciones.localId);
  const { sql, valores } = condicionAlcance(alcance, 'm.local_id');
  const condiciones = [sql];
  const params: unknown[] = [...valores];
  if (opciones.desde) {
    condiciones.push('m.fecha >= ?');
    params.push(opciones.desde);
  }
  if (opciones.hasta) {
    condiciones.push('m.fecha <= ?');
    params.push(opciones.hasta);
  }
  const filas = await env.DB
    .prepare(
      `SELECT m.id, m.movimiento_id, m.producto_id, p.nombre AS producto_nombre, m.local_id, m.cantidad, m.origen, m.motivo, m.nota, m.por_id, m.por_nombre, m.autorizado_nombre, m.fecha
       FROM mermas m LEFT JOIN productos p ON p.id = m.producto_id
       WHERE ${condiciones.join(' AND ')}
       ORDER BY m.fecha DESC, m.rowid DESC LIMIT ?`
    )
    .bind(...params, limiteSeguro(opciones.limite, 200, 2000))
    .all<Merma>();
  return filas.results;
}
