// Órdenes de servicio técnico. Quien trabaja en el local (encargado, vendedor, gerencia) las ve, las crea, las actualiza y las COBRA;
// el trigger de la base exige que el local sea de servicio técnico y sella las fechas (listo_en, entregada_en, actualizada_en).
// El técnico (usuario con rol «tecnico») solo ve las órdenes que tiene asignadas: anota el diagnóstico y avanza a «listo», nada más.
// Una orden Entregada es final y SOLO se entrega cobrándola (cobrarOrden): de lo cobrado se descuentan los repuestos (se los queda la
// tienda) y de la ganancia la tienda toma un porcentaje; el resto es del técnico, a quien se le paga después (pagarTecnicos).
import { alcanceDe, condicionAlcance, esGerencia, exigirRol, localAccesible, type Sesion } from '../authz';
import { sentenciasCambio } from '../cambios';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';
import { ahoraISO, limiteSeguro, nuevoId, redondear2 } from '../util';
import { cantidadesPorCantidad, piezasVendidas, reponerCantidades, reponerPiezas } from './ventas';
import { errorDeCobro, repartoDeCobro, repuestosDeOrdenUsd, validarPagosCobro } from '../../utils/servicioTecnico';
import type { CobroOrdenServicio, EstadoOrdenServicio, NuevaOrdenServicio, OrdenServicio, RepuestoOrden, ResultadoPagoTecnico, ResultadoReseteoServicio, TecnicoDeLocal } from '../../types/database.types';

const ESTADOS: EstadoOrdenServicio[] = ['pendiente', 'en_reparacion', 'listo', 'entregado'];

function aOrden(f: Record<string, unknown>): OrdenServicio {
  return {
    ...(f as unknown as OrdenServicio),
    repuestos: typeof f.repuestos === 'string' ? (JSON.parse(f.repuestos) as RepuestoOrden[]) : [],
    pagos: typeof f.pagos === 'string' ? (JSON.parse(f.pagos) as OrdenServicio['pagos']) : null,
    vuelto: typeof f.vuelto === 'string' ? (JSON.parse(f.vuelto) as OrdenServicio['vuelto']) : null,
  };
}

const totalDeOrden = (repuestos: RepuestoOrden[], manoDeObra: number): number =>
  redondear2(repuestos.reduce((suma, r) => suma + r.precio_unitario * r.cantidad, 0) + manoDeObra);

export async function listarOrdenes(env: Entorno, sesion: Sesion, opciones: { limite?: number; localId?: string }): Promise<OrdenServicio[]> {
  const alcance = await alcanceDe(env, sesion, opciones.localId);
  const { sql, valores } = condicionAlcance(alcance, 'local_id');
  const limite = limiteSeguro(opciones.limite, 500, 2000);
  const soloMias = sesion.rol === 'tecnico' ? ' AND tecnico_id = ?' : '';
  const filas = await env.DB
    .prepare(`SELECT * FROM ordenes_servicio WHERE ${sql}${soloMias} ORDER BY recibida_en DESC, rowid DESC LIMIT ?`)
    .bind(...valores, ...(soloMias ? [sesion.userId] : []), limite)
    .all<Record<string, unknown>>();
  return filas.results.map(aOrden);
}

/** La orden, o null si no existe o es de un local al que no se accede. */
export async function obtenerOrden(env: Entorno, sesion: Sesion, id: string): Promise<OrdenServicio | null> {
  const alcance = await alcanceDe(env, sesion);
  const { sql, valores } = condicionAlcance(alcance, 'local_id');
  const soloMias = sesion.rol === 'tecnico' ? ' AND tecnico_id = ?' : '';
  const fila = await env.DB
    .prepare(`SELECT * FROM ordenes_servicio WHERE id = ? AND ${sql}${soloMias}`)
    .bind(id, ...valores, ...(soloMias ? [sesion.userId] : []))
    .first<Record<string, unknown>>();
  return fila ? aOrden(fila) : null;
}

export async function crearOrden(env: Entorno, sesion: Sesion, datos: NuevaOrdenServicio): Promise<OrdenServicio> {
  if (sesion.rol === 'tecnico') throw new ErrorApi(403, 'Los equipos los registra la encargada del local.', 'sin_permiso');
  if (!(await localAccesible(env, sesion, datos.local_id))) throw new ErrorApi(403, 'No tienes acceso a ese local.', 'sin_permiso');

  const texto = (v: string | null | undefined) => (v ?? '').trim().replace(/\s+/g, ' ');
  const cliente = { cedula: texto(datos.cliente_cedula), nombre: texto(datos.cliente_nombre), telefono: texto(datos.cliente_telefono) };
  if (!cliente.cedula || !cliente.nombre || !cliente.telefono) throw new ErrorApi(400, 'Faltan datos del cliente (cédula, nombre y teléfono).', 'datos_invalidos');
  const marca = texto(datos.equipo_marca);
  const modelo = texto(datos.equipo_modelo);
  if (!marca || !modelo) throw new ErrorApi(400, 'Indica la marca y el modelo del equipo.', 'datos_invalidos');
  const falla = texto(datos.falla_reportada);
  if (falla.length < 3) throw new ErrorApi(400, 'Describe la falla que reporta el cliente.', 'datos_invalidos');

  const id = nuevoId();
  const ahora = ahoraISO();
  const db = env.DB;
  try {
    const lote = await db.batch<{ valor: number }>([
      db.prepare("INSERT INTO contadores (nombre, valor) VALUES ('ordenes_servicio', 1) ON CONFLICT (nombre) DO UPDATE SET valor = valor + 1 RETURNING valor"),
      db
        .prepare(
          `INSERT INTO ordenes_servicio (id, folio, local_id, cliente_cedula, cliente_nombre, cliente_telefono, equipo_marca, equipo_modelo, equipo_imei, accesorios_recibidos, falla_reportada, recibida_en, actualizada_en, registrado_por, registrado_nombre)
           VALUES (?, (SELECT valor FROM contadores WHERE nombre = 'ordenes_servicio'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id, datos.local_id, cliente.cedula, cliente.nombre, cliente.telefono, marca, modelo, texto(datos.equipo_imei) || null,
          texto(datos.accesorios_recibidos) || null, falla, ahora, ahora, sesion.userId, datos.registrado_nombre ?? sesion.nombre
        ),
      ...sentenciasCambio(db, ['ordenes_servicio'], datos.local_id),
    ]);
    const fila = await db.prepare('SELECT * FROM ordenes_servicio WHERE id = ?').bind(id).first<Record<string, unknown>>();
    return { ...aOrden(fila!), folio: lote[0].results[0].valor };
  } catch (err) {
    if (err instanceof Error && /solo se registran en un local de servicio técnico/.test(err.message)) {
      throw new ErrorApi(400, 'Las órdenes de servicio solo se registran en un local de servicio técnico', 'local_invalido');
    }
    throw err;
  }
}

export type CambiosOrden = Partial<Pick<OrdenServicio, 'diagnostico' | 'estado' | 'tecnico_id' | 'tecnico_nombre' | 'repuestos' | 'mano_de_obra_usd'>> & { total_usd?: number };

const ESTADOS_DEL_TECNICO: EstadoOrdenServicio[] = ['en_reparacion', 'listo'];

/** El técnico activo de ESE local (el nombre sale de su perfil), o null si no corresponde. */
async function tecnicoDelLocal(env: Entorno, tecnicoId: string, localId: string): Promise<{ id: string; nombre: string } | null> {
  return env.DB
    .prepare("SELECT id, nombre FROM perfiles WHERE id = ? AND rol = 'tecnico' AND status = 'active' AND local_id = ?")
    .bind(tecnicoId, localId)
    .first<{ id: string; nombre: string }>();
}

/** Técnicos activos a quienes se les puede asignar un trabajo (de un local, o de los locales a los que se accede). */
export async function listarTecnicosDeLocal(env: Entorno, sesion: Sesion, localId?: string): Promise<TecnicoDeLocal[]> {
  exigirRol(sesion, ['administrador', 'gerente', 'supervisor', 'encargado', 'vendedor']);
  const alcance = await alcanceDe(env, sesion, localId);
  const { sql, valores } = condicionAlcance(alcance, 'local_id');
  const filas = await env.DB
    .prepare(`SELECT id, nombre, local_id FROM perfiles WHERE rol = 'tecnico' AND status = 'active' AND ${sql} ORDER BY nombre COLLATE NOCASE, id`)
    .bind(...valores)
    .all<TecnicoDeLocal>();
  return filas.results;
}

/**
 * Cambia estado, diagnóstico, técnico, repuestos o mano de obra. El total se recalcula SIEMPRE aquí. Una orden entregada es final y la
 * entrega solo ocurre al cobrarla (cobrarOrden). El técnico solo toca sus trabajos: diagnóstico y estado «en reparación» / «listo».
 */
export async function actualizarOrden(env: Entorno, sesion: Sesion, id: string, cambios: CambiosOrden): Promise<OrdenServicio> {
  await alcanceDe(env, sesion); // 403 si no tiene acceso a ningún local (p. ej. contador)
  const actual = await obtenerOrden(env, sesion, id);
  if (!actual) throw new ErrorApi(404, 'La orden no existe.', 'no_existe');
  if (actual.estado === 'entregado') throw new ErrorApi(409, 'Esa orden ya fue entregada y no se puede modificar.', 'orden_entregada');

  if (sesion.rol === 'tecnico') {
    if (cambios.repuestos !== undefined || cambios.mano_de_obra_usd !== undefined || cambios.tecnico_id !== undefined || cambios.tecnico_nombre !== undefined) {
      throw new ErrorApi(403, 'El técnico solo puede anotar el diagnóstico y marcar el trabajo como listo.', 'sin_permiso');
    }
    if (cambios.estado !== undefined && !ESTADOS_DEL_TECNICO.includes(cambios.estado)) {
      throw new ErrorApi(403, 'El técnico solo puede marcar el trabajo «en reparación» o «listo»; la entrega la hace la encargada al cobrar.', 'sin_permiso');
    }
  }
  if (cambios.estado !== undefined && !ESTADOS.includes(cambios.estado)) throw new ErrorApi(400, 'Estado de orden inválido.', 'datos_invalidos');
  if (cambios.estado === 'entregado') throw new ErrorApi(409, 'Para entregar el equipo hay que cobrar la reparación.', 'requiere_cobro');
  if (cambios.mano_de_obra_usd !== undefined && !(Number.isFinite(cambios.mano_de_obra_usd) && cambios.mano_de_obra_usd >= 0)) {
    throw new ErrorApi(400, 'La mano de obra debe ser un número mayor o igual a 0.', 'datos_invalidos');
  }
  let tecnicoId = actual.tecnico_id ?? null;
  let tecnicoNombre = actual.tecnico_nombre ?? null;
  if (cambios.tecnico_id !== undefined) {
    if (cambios.tecnico_id === null) {
      tecnicoId = null;
      tecnicoNombre = null;
    } else {
      const tecnico = await tecnicoDelLocal(env, cambios.tecnico_id, actual.local_id);
      if (!tecnico) throw new ErrorApi(400, 'Elige un técnico activo de este local.', 'tecnico_invalido');
      tecnicoId = tecnico.id;
      tecnicoNombre = tecnico.nombre;
    }
  }
  const repuestos = cambios.repuestos ?? actual.repuestos;
  const manoDeObra = redondear2(cambios.mano_de_obra_usd ?? actual.mano_de_obra_usd);
  const diagnostico = cambios.diagnostico !== undefined ? (cambios.diagnostico ?? '').trim().slice(0, 1000) || null : actual.diagnostico;

  const lote = await env.DB.batch([
    env.DB
      .prepare("UPDATE ordenes_servicio SET estado = ?, diagnostico = ?, tecnico_id = ?, tecnico_nombre = ?, repuestos = ?, mano_de_obra_usd = ?, total_usd = ? WHERE id = ? AND estado <> 'entregado' AND json(repuestos) = json(?)")
      .bind(cambios.estado ?? actual.estado, diagnostico, tecnicoId, tecnicoNombre, JSON.stringify(repuestos), manoDeObra, totalDeOrden(repuestos, manoDeObra), id, JSON.stringify(actual.repuestos)),
    ...sentenciasCambio(env.DB, ['ordenes_servicio'], actual.local_id),
  ]);
  if (!lote[0].meta.changes) throw new ErrorApi(409, 'La orden cambió. Vuelve a abrirla.', 'orden_modificada');
  return (await obtenerOrden(env, sesion, id))!;
}

/**
 * Cobra la reparación (la encargada recibe el dinero): fija el total que pagó el cliente, calcula el reparto y entrega la orden.
 * ganancia = total − repuestos (los repuestos se los queda la tienda); la tienda toma `porcentaje_local` de la ganancia y el resto es
 * del técnico, que se paga después con pagarTecnicos. Si el técnico usó una pieza suya no hay repuestos y todo lo cobrado es ganancia.
 */
export async function cobrarOrden(env: Entorno, sesion: Sesion, id: string, cobro: CobroOrdenServicio): Promise<OrdenServicio> {
  exigirRol(sesion, ['administrador', 'gerente', 'supervisor', 'encargado', 'vendedor']);
  await alcanceDe(env, sesion);
  const actual = await obtenerOrden(env, sesion, id);
  if (!actual) throw new ErrorApi(404, 'La orden no existe.', 'no_existe');
  if (actual.estado === 'entregado') throw new ErrorApi(409, 'Esa orden ya fue entregada y cobrada.', 'orden_entregada');
  if (!actual.tecnico_id) throw new ErrorApi(409, 'Elige qué técnico hizo el trabajo antes de cobrarlo.', 'sin_tecnico');
  if (actual.estado === 'pendiente') throw new ErrorApi(409, 'Todavía no se empezó la reparación: pasa la orden a «en reparación» antes de cobrar.', 'estado_invalido');

  const total = redondear2(cobro.total_usd);
  const repuestosUsd = repuestosDeOrdenUsd(actual.repuestos);
  const problema = errorDeCobro({ totalCobrado: cobro.total_usd, repuestosUsd, porcentaje: cobro.porcentaje_local });
  if (problema) throw new ErrorApi(400, problema, 'datos_invalidos');
  const pagosValidos = validarPagosCobro({ pagos: cobro.pagos, vuelto: cobro.vuelto, tasa: cobro.tasa_cambio, total });
  if ('error' in pagosValidos) throw new ErrorApi(400, pagosValidos.error, 'datos_invalidos');
  const totalBs = pagosValidos.totalBs;
  const reparto = repartoDeCobro({ totalCobrado: total, repuestosUsd, porcentaje: cobro.porcentaje_local });
  const ahora = ahoraISO();

  const lote = await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE ordenes_servicio SET estado = 'entregado', total_usd = ?, mano_de_obra_usd = ?, porcentaje_local = ?, comision_local_usd = ?, pago_tecnico_usd = ?,
           pagos = ?, vuelto = ?, tasa_cambio = ?, total_bs = ?, cobrado_en = ?, cobrado_por = ?, cobrado_nombre = ?
         WHERE id = ? AND estado <> 'entregado' AND json(repuestos) = json(?)`
      )
      .bind(
        total, reparto.ganancia, cobro.porcentaje_local, reparto.comision_local_usd, reparto.pago_tecnico_usd, JSON.stringify(cobro.pagos),
        cobro.vuelto ? JSON.stringify(cobro.vuelto) : null, cobro.tasa_cambio ?? null, totalBs, ahora, sesion.userId, sesion.nombre, id, JSON.stringify(actual.repuestos)
      ),
    ...sentenciasCambio(env.DB, ['ordenes_servicio'], actual.local_id),
  ]);
  if (!lote[0].meta.changes) throw new ErrorApi(409, 'La orden cambió. Vuelve a abrirla antes de cobrar.', 'orden_modificada');
  return (await obtenerOrden(env, sesion, id))!;
}

const MAX_ORDENES_POR_PAGO = 200;

/** Marca como pagada la parte del técnico de las órdenes indicadas (solo cobradas y aún por pagar, dentro del alcance de quien paga). */
export async function pagarTecnicos(env: Entorno, sesion: Sesion, ids: string[]): Promise<ResultadoPagoTecnico> {
  if (!esGerencia(sesion.rol)) throw new ErrorApi(403, 'Tu rol no tiene permiso para pagarle a los técnicos.', 'sin_permiso');
  const unicos = [...new Set(ids)];
  if (unicos.length === 0 || unicos.length > MAX_ORDENES_POR_PAGO) throw new ErrorApi(400, `Indica entre 1 y ${MAX_ORDENES_POR_PAGO} órdenes.`, 'datos_invalidos');
  const alcance = await alcanceDe(env, sesion);
  const { sql, valores } = condicionAlcance(alcance, 'local_id');

  const pendientes: { id: string; local_id: string; pago: number }[] = [];
  for (let i = 0; i < unicos.length; i += 80) {
    const trozo = unicos.slice(i, i + 80);
    const filas = await env.DB
      .prepare(
        `SELECT id, local_id, pago_tecnico_usd AS pago FROM ordenes_servicio
         WHERE id IN (${trozo.map(() => '?').join(', ')}) AND ${sql} AND cobrado_en IS NOT NULL AND pago_tecnico_usd IS NOT NULL AND tecnico_pagado_en IS NULL`
      )
      .bind(...trozo, ...valores)
      .all<{ id: string; local_id: string; pago: number }>();
    pendientes.push(...filas.results);
  }
  if (pendientes.length === 0) throw new ErrorApi(409, 'No hay pagos por pagar en esas órdenes (ya se pagaron o todavía no se cobraron).', 'nada_por_pagar');

  const ahora = ahoraISO();
  const db = env.DB;
  const locales = [...new Set(pendientes.map((p) => p.local_id))];
  await db.batch([
    ...pendientes.map((p) =>
      db
        .prepare('UPDATE ordenes_servicio SET tecnico_pagado_en = ?, tecnico_pagado_por = ?, tecnico_pagado_nombre = ? WHERE id = ? AND tecnico_pagado_en IS NULL')
        .bind(ahora, sesion.userId, sesion.nombre, p.id)
    ),
    ...locales.flatMap((l) => sentenciasCambio(db, ['ordenes_servicio'], l)),
  ]);
  return { pagadas: pendientes.length, total_usd: redondear2(pendientes.reduce((s, p) => s + p.pago, 0)) };
}

// --- Resetear el servicio técnico de UN local (solo el administrador) --------------------------------------------------

const MOTIVO_RESETEO_SERVICIO = 'Reseteo de servicio técnico (restaura el stock)';

/**
 * Borra TODAS las órdenes de servicio de UN local (las de prueba, o para empezar de cero) y devuelve al inventario los repuestos que esas
 * órdenes sacaron: las piezas con código vuelven con LOS MISMOS códigos (una ENTRADA «Reseteo de servicio técnico» por producto, que las
 * reactiva) y los productos por cantidad por la cantidad usada. Los repuestos que ya se quitaron de una orden ya volvieron al stock y no se
 * cuentan dos veces. Los demás locales no se tocan. Los movimientos de stock siguen en Movimientos (y en Reportes: «Resetear reportes»
 * los limpia aparte); el cobro de las órdenes y lo pagado a los técnicos desaparecen con ellas (el cuadre de un día ya cerrado conserva su foto).
 *
 * Primero repone el stock y al final borra las órdenes, así que si algo falla a medias volver a ejecutarlo termina el trabajo: solo repone lo
 * que sigue vendido. Con `simular` solo cuenta. No se puede deshacer: respalda antes (`npm run backup`).
 */
export async function resetearServicioTecnico(env: Entorno, sesion: Sesion, opciones: { localId: string; simular?: boolean }): Promise<ResultadoReseteoServicio> {
  if (sesion.rol !== 'administrador') throw new ErrorApi(403, 'Solo el administrador puede resetear el servicio técnico.', 'sin_permiso');
  const db = env.DB;
  const localId = (opciones.localId ?? '').trim();
  if (!localId) throw new ErrorApi(400, 'Elige el local cuyo servicio técnico quieres resetear.', 'datos_invalidos');
  const local = await db.prepare('SELECT tipo FROM locales WHERE id = ?').bind(localId).first<{ tipo: string }>();
  if (!local) throw new ErrorApi(404, 'Ese local no existe.', 'no_encontrado');
  if (local.tipo !== 'servicio_tecnico') throw new ErrorApi(400, 'Ese local no tiene servicio técnico.', 'solo_servicio_tecnico');

  const ordenes = (await db.prepare('SELECT local_id, repuestos, cobrado_en FROM ordenes_servicio WHERE local_id = ?').bind(localId).all<{ local_id: string; repuestos: string; cobrado_en: string | null }>()).results;
  const codigos = new Set<string>();
  for (const o of ordenes) for (const r of JSON.parse(o.repuestos || '[]') as RepuestoOrden[]) for (const c of r.unidades ?? []) codigos.add(c);
  const { grupos: porPieza, piezas: piezasConCodigo } = await piezasVendidas(db, codigos);
  const lineas = ordenes.flatMap((o) => (JSON.parse(o.repuestos || '[]') as RepuestoOrden[])
    .map((r) => ({ local_id: r.origen_local_id ?? o.local_id, items: JSON.stringify([r]) })));
  const { grupos: porCantidad } = await cantidadesPorCantidad(db, lineas, []);
  const piezas = piezasConCodigo + [...porCantidad.values()].reduce((s, g) => s + g.cantidad, 0);

  const resultado: ResultadoReseteoServicio = { ordenes: ordenes.length, cobradas: ordenes.filter((o) => o.cobrado_en).length, piezas, simulado: !!opciones.simular };
  if (opciones.simular || (ordenes.length === 0 && piezas === 0)) return resultado;

  await reponerPiezas(env, sesion, porPieza, MOTIVO_RESETEO_SERVICIO);
  await reponerCantidades(env, sesion, porCantidad, MOTIVO_RESETEO_SERVICIO);
  await db.batch([db.prepare('DELETE FROM ordenes_servicio WHERE local_id = ?').bind(localId), ...sentenciasCambio(db, ['ordenes_servicio'], localId)]);
  return resultado;
}
