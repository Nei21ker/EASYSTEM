// Cuadre de caja diario por local (migración 0034 de Postgres). Reglas: administrador, gerente y encargado (este solo
// de su local); un cuadre por local y día; ABIERTO (borrador) → CERRADO; cerrado no se modifica (solo se reabre, y eso lo
// hacen únicamente el administrador y el gerente). LO ESPERADO LO CALCULA EL SERVIDOR con las ventas y devoluciones de
// ese local y día del negocio: quien cuadra solo declara lo contado y sube las fotos.
import { esGerencia, esGlobal, localAccesible, alcanceDe, condicionAlcance, type Sesion } from '../authz';
import { sentenciasCambio } from '../cambios';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';
import { ahoraISO, nuevoId, rangoDelDiaUTC, redondear2 } from '../util';
import { esperadoDelDia, problemaParaCerrar, TIPOS_FOTO_CUADRE } from '../../utils/cuadre';
import { METODOS_PAGO } from '../../utils/pagos';
import type { ContadoCuadre, CuadreCaja, EsperadoCuadre, FotoCuadre } from '../../types/database.types';

const ZONA_POR_DEFECTO = 'America/Caracas';
const MAX_FOTOS = 40;

const analizar = <T>(texto: unknown, porDefecto: T): T => (typeof texto === 'string' ? (JSON.parse(texto) as T) : porDefecto);

function aCuadre(f: Record<string, unknown>): CuadreCaja {
  return {
    ...(f as unknown as CuadreCaja),
    esperado: analizar(f.esperado, []),
    contado: analizar(f.contado, []),
    fotos: analizar(f.fotos, []),
    notas: (f.notas as string | null) ?? null,
    registrado_nombre: (f.registrado_nombre as string | null) ?? null,
    cerrado_en: (f.cerrado_en as string | null) ?? null,
    cerrado_por: (f.cerrado_por as string | null) ?? null,
  };
}

function validarFecha(fecha: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(`${fecha}T00:00:00Z`)) || new Date(`${fecha}T00:00:00Z`).toISOString().slice(0, 10) !== fecha) {
    throw new ErrorApi(400, 'La fecha del cuadre no es válida.', 'fecha_invalida');
  }
}

/** Administrador, gerente o encargado con acceso a ese local (el contador, el vendedor y el técnico no). */
async function exigirAcceso(env: Entorno, sesion: Sesion, localId: string): Promise<void> {
  if (!esGerencia(sesion.rol)) throw new ErrorApi(403, 'Tu rol no tiene acceso al cuadre de caja.', 'sin_permiso');
  if (!(await localAccesible(env, sesion, localId))) throw new ErrorApi(403, 'Solo puedes hacer el cuadre de tu local.', 'sin_permiso');
}

/** Lo que el sistema esperaba cobrar ese día en ese local, por tipo de cobro (neto de vuelto y reembolsos). */
export async function calcularEsperadoCuadre(env: Entorno, sesion: Sesion, localId: string, fecha: string): Promise<EsperadoCuadre[]> {
  await exigirAcceso(env, sesion, localId);
  validarFecha(fecha);
  const { desde, hasta } = rangoDelDiaUTC(fecha, env.ZONA_HORARIA ?? ZONA_POR_DEFECTO);
  const [ventas, devoluciones] = await Promise.all([
    env.DB
      .prepare('SELECT pagos, vuelto, metodo_pago, total, total_bs FROM ventas WHERE local_id = ? AND fecha >= ? AND fecha < ?')
      .bind(localId, desde, hasta)
      .all<Record<string, unknown>>(),
    env.DB
      .prepare('SELECT pagos, vuelto, reembolso FROM devoluciones WHERE local_id = ? AND fecha >= ? AND fecha < ?')
      .bind(localId, desde, hasta)
      .all<Record<string, unknown>>(),
  ]);
  return esperadoDelDia(
    ventas.results.map((v) => ({
      pagos: analizar(v.pagos, null), vuelto: analizar(v.vuelto, null), metodo_pago: v.metodo_pago as never, total: v.total as number, total_bs: (v.total_bs as number | null) ?? null,
    })),
    devoluciones.results.map((d) => ({ pagos: analizar(d.pagos, null), vuelto: analizar(d.vuelto, null), reembolso: analizar(d.reembolso, null) }))
  );
}

export async function listarCuadresDelDia(env: Entorno, sesion: Sesion, fecha: string): Promise<CuadreCaja[]> {
  if (!esGerencia(sesion.rol)) throw new ErrorApi(403, 'Tu rol no tiene acceso al cuadre de caja.', 'sin_permiso');
  validarFecha(fecha);
  const { sql, valores } = condicionAlcance(await alcanceDe(env, sesion), 'local_id');
  const filas = await env.DB.prepare(`SELECT * FROM cuadres_caja WHERE fecha = ? AND ${sql} ORDER BY local_id`).bind(fecha, ...valores).all<Record<string, unknown>>();
  return filas.results.map(aCuadre);
}

export async function obtenerCuadre(env: Entorno, sesion: Sesion, localId: string, fecha: string): Promise<CuadreCaja | null> {
  await exigirAcceso(env, sesion, localId);
  validarFecha(fecha);
  const fila = await env.DB.prepare('SELECT * FROM cuadres_caja WHERE local_id = ? AND fecha = ?').bind(localId, fecha).first<Record<string, unknown>>();
  return fila ? aCuadre(fila) : null;
}

export interface DatosCuadre {
  localId: string;
  /** "aaaa-mm-dd" del negocio */
  fecha: string;
  /** Lo contado por tipo de cobro (en la moneda de cada uno); los que no se escribieron no se incluyen */
  contado: ContadoCuadre[];
  /** Fotos de respaldo ya subidas a R2 (rutas de cuadres-caja/<local>/<fecha>/…) */
  fotos: FotoCuadre[];
  notas: string | null;
  /** true = cerrar el cuadre (se valida que esté completo); false = guardar borrador */
  cerrar: boolean;
}

/** Guarda el borrador o cierra el cuadre del día. */
export async function guardarCuadre(env: Entorno, sesion: Sesion, datos: DatosCuadre): Promise<CuadreCaja> {
  await exigirAcceso(env, sesion, datos.localId);
  validarFecha(datos.fecha);

  const contado = datos.contado.map((c) => {
    if (!METODOS_PAGO.some((m) => m.valor === c.metodo)) throw new ErrorApi(400, 'Tipo de cobro inválido.', 'datos_invalidos');
    if (!Number.isFinite(c.monto)) throw new ErrorApi(400, 'Los montos contados deben ser números.', 'datos_invalidos');
    if (c.monto < 0) throw new ErrorApi(400, 'Los montos contados no pueden ser negativos.', 'datos_invalidos');
    return { metodo: c.metodo, monto: redondear2(c.monto) };
  });
  const notas = datos.notas?.trim() || null;
  if (notas && notas.length > 1000) throw new ErrorApi(400, 'Las observaciones admiten hasta 1000 caracteres.', 'datos_invalidos');

  if (datos.fotos.length > MAX_FOTOS) throw new ErrorApi(400, `Se admiten hasta ${MAX_FOTOS} fotos por cuadre.`, 'datos_invalidos');
  const prefijo = `cuadres-caja/${datos.localId}/${datos.fecha}/`;
  const tipos = TIPOS_FOTO_CUADRE.map((t) => t.tipo as string);
  for (const f of datos.fotos) {
    if (!tipos.includes(f.tipo)) throw new ErrorApi(400, 'Tipo de foto inválido.', 'datos_invalidos');
    if (!f.path.startsWith(prefijo) || f.path.slice(prefijo.length).includes('/') || f.path.includes('..')) {
      throw new ErrorApi(400, 'Alguna de las fotos no pertenece a este cuadre.', 'datos_invalidos');
    }
  }

  const existente = await env.DB.prepare('SELECT id, estado, registrado_nombre FROM cuadres_caja WHERE local_id = ? AND fecha = ?').bind(datos.localId, datos.fecha).first<{ id: string; estado: string; registrado_nombre: string | null }>();
  if (existente?.estado === 'CERRADO') throw new ErrorApi(409, 'Este cuadre ya está cerrado y no se puede modificar.', 'cuadre_cerrado');

  const esperado = await calcularEsperadoCuadre(env, sesion, datos.localId, datos.fecha);
  if (datos.cerrar) {
    const problema = problemaParaCerrar(esperado, contado, datos.fotos);
    if (problema) throw new ErrorApi(400, problema, 'cuadre_incompleto');
  }

  const ahora = ahoraISO();
  const estado = datos.cerrar ? 'CERRADO' : 'ABIERTO';
  const cerradoEn = datos.cerrar ? ahora : null;
  const cerradoPor = datos.cerrar ? sesion.nombre : null;
  const id = existente?.id ?? nuevoId();
  const db = env.DB;
  try {
    await db.batch([
      existente
        ? db
            .prepare('UPDATE cuadres_caja SET esperado = ?, contado = ?, fotos = ?, notas = ?, estado = ?, cerrado_en = ?, cerrado_por = ?, updated_at = ? WHERE id = ?')
            .bind(JSON.stringify(esperado), JSON.stringify(contado), JSON.stringify(datos.fotos), notas, estado, cerradoEn, cerradoPor, ahora, id)
        : db
            .prepare(
              'INSERT INTO cuadres_caja (id, local_id, fecha, estado, esperado, contado, fotos, notas, registrado_por, registrado_nombre, cerrado_en, cerrado_por, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )
            .bind(id, datos.localId, datos.fecha, estado, JSON.stringify(esperado), JSON.stringify(contado), JSON.stringify(datos.fotos), notas, sesion.userId, sesion.nombre, cerradoEn, cerradoPor, ahora, ahora),
      ...sentenciasCambio(db, ['cuadres_caja'], datos.localId),
    ]);
  } catch (err) {
    if (err instanceof Error && /día futuro/.test(err.message)) throw new ErrorApi(400, 'No se puede hacer el cuadre de un día futuro.', 'fecha_invalida');
    if (err instanceof Error && /ya está cerrado/.test(err.message)) throw new ErrorApi(409, 'Este cuadre ya está cerrado y no se puede modificar.', 'cuadre_cerrado');
    throw err;
  }
  return aCuadre((await db.prepare('SELECT * FROM cuadres_caja WHERE id = ?').bind(id).first<Record<string, unknown>>())!);
}

/** Reabre un cuadre cerrado para corregirlo (solo administrador y gerente). */
export async function reabrirCuadre(env: Entorno, sesion: Sesion, localId: string, fecha: string): Promise<CuadreCaja> {
  if (!esGlobal(sesion.rol)) throw new ErrorApi(403, 'Solo el administrador o el gerente pueden reabrir un cuadre cerrado.', 'sin_permiso');
  const actual = await obtenerCuadre(env, sesion, localId, fecha);
  if (!actual) throw new ErrorApi(404, 'Ese cuadre no existe.', 'no_existe');
  if (actual.estado !== 'CERRADO') throw new ErrorApi(409, 'Ese cuadre no está cerrado.', 'cuadre_abierto');
  await env.DB.batch([
    env.DB.prepare("UPDATE cuadres_caja SET estado = 'ABIERTO', cerrado_en = NULL, cerrado_por = NULL, updated_at = ? WHERE id = ?").bind(ahoraISO(), actual.id),
    ...sentenciasCambio(env.DB, ['cuadres_caja'], localId),
  ]);
  return (await obtenerCuadre(env, sesion, localId, fecha))!;
}
