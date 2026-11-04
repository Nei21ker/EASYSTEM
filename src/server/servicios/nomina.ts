// Nómina: empleados fijos (pago quincenal) y trabajadores independientes (pago diario por reventa).
// Acceso (nomina_accesible de Postgres): administrador siempre; gerente y contador mientras el local tenga la suscripción
// vigente; encargado, vendedor y técnico, nada. Un pago PAGADO ya no se modifica ni se borra (trigger de la base de datos).
// guardarPagoIndependiente reemplaza la función guardar_pago_independiente: valida, calcula la ganancia y guarda el día,
// la lista y (si se pide) el pago, todo en UN lote atómico.
import { alcanceNomina, condicionAlcance, exigirRol, type Alcance, type Sesion } from '../authz';
import { sentenciasCambio } from '../cambios';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';
import { ahoraISO, nuevoId, redondear2 } from '../util';
import { pagoBaseQuincenal, quincenaDe, totalPago, validarAjustes } from '../../utils/nomina';
import type { Empleado, LineaReventa, NuevoEmpleado, Nomina, ProductoReventa } from '../../types/database.types';

const TRAMO = 90;
const MAX_LINEAS = 200;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
const tramos = <T>(lista: T[]): T[][] => Array.from({ length: Math.ceil(lista.length / TRAMO) }, (_, i) => lista.slice(i * TRAMO, (i + 1) * TRAMO));
const marcas = (n: number) => Array.from({ length: n }, () => '?').join(', ');
const enAlcance = (alcance: Alcance, localId: string) => alcance.tipo === 'todos' || alcance.ids.includes(localId);

function fechaReal(f: string): boolean {
  return FECHA.test(f) && new Date(`${f}T00:00:00Z`).toISOString().slice(0, 10) === f;
}

// --- Empleados -------------------------------------------------------------------------------------------------
function validarEmpleado(d: Partial<NuevoEmpleado>, completo: boolean): void {
  if ((completo || d.nombre !== undefined) && !texto(d.nombre)) throw new ErrorApi(400, 'El nombre es obligatorio.', 'datos_invalidos');
  if ((completo || d.apellido !== undefined) && !texto(d.apellido)) throw new ErrorApi(400, 'El apellido es obligatorio.', 'datos_invalidos');
  if ((completo || d.cedula !== undefined) && texto(d.cedula).length < 5) throw new ErrorApi(400, 'La cédula debe tener al menos 5 caracteres.', 'datos_invalidos');
  if ((completo || d.cargo !== undefined) && !texto(d.cargo)) throw new ErrorApi(400, 'El cargo es obligatorio.', 'datos_invalidos');
  if ((completo || d.salario_base !== undefined) && !(Number(d.salario_base) >= 0)) throw new ErrorApi(400, 'El salario debe ser un monto mayor o igual a 0.', 'datos_invalidos');
  if (completo && !d.local_id) throw new ErrorApi(400, 'Elige el local del empleado.', 'datos_invalidos');
}

export async function listarEmpleados(env: Entorno, sesion: Sesion): Promise<Empleado[]> {
  const { sql, valores } = condicionAlcance(await alcanceNomina(env, sesion), 'local_id');
  const filas = await env.DB.prepare(`SELECT * FROM empleados WHERE ${sql} ORDER BY apellido, nombre`).bind(...valores).all<Empleado>();
  return filas.results;
}

export async function crearEmpleado(env: Entorno, sesion: Sesion, datos: NuevoEmpleado): Promise<Empleado> {
  const alcance = await alcanceNomina(env, sesion);
  validarEmpleado(datos, true);
  if (!enAlcance(alcance, datos.local_id)) throw new ErrorApi(403, 'No tienes permiso para registrar personal en este local.', 'sin_permiso');
  const independiente = datos.tipo === 'INDEPENDIENTE';
  const fila: Empleado = {
    id: nuevoId(),
    local_id: datos.local_id,
    nombre: texto(datos.nombre),
    apellido: texto(datos.apellido),
    cedula: texto(datos.cedula).toUpperCase(),
    cargo: texto(datos.cargo),
    // Un trabajador independiente no tiene salario ni quincena: se le paga por día
    salario_base: independiente ? 0 : redondear2(Number(datos.salario_base)),
    tipo: independiente ? 'INDEPENDIENTE' : 'FIJO',
    frecuencia_pago: independiente ? 'DIARIO' : 'QUINCENAL',
    estado: datos.estado ?? 'ACTIVO',
    fecha_ingreso: datos.fecha_ingreso && fechaReal(datos.fecha_ingreso) ? datos.fecha_ingreso : ahoraISO().slice(0, 10),
    created_at: ahoraISO(),
  };
  try {
    await env.DB
      .prepare('INSERT INTO empleados (id, local_id, nombre, apellido, cedula, cargo, salario_base, tipo, frecuencia_pago, estado, fecha_ingreso, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(fila.id, fila.local_id, fila.nombre, fila.apellido, fila.cedula, fila.cargo, fila.salario_base, fila.tipo, fila.frecuencia_pago, fila.estado, fila.fecha_ingreso, fila.created_at)
      .run();
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed: empleados\.cedula/.test(err.message)) {
      throw new ErrorApi(409, `Ya existe un empleado con la cédula ${fila.cedula}.`, 'cedula_repetida');
    }
    throw err;
  }
  await env.DB.batch(sentenciasCambio(env.DB, ['empleados'], fila.local_id));
  return fila;
}

async function obtenerEmpleado(env: Entorno, id: string): Promise<Empleado> {
  const e = await env.DB.prepare('SELECT * FROM empleados WHERE id = ?').bind(id).first<Empleado>();
  if (!e) throw new ErrorApi(404, 'El trabajador no existe', 'no_existe');
  return e;
}

export async function actualizarEmpleado(env: Entorno, sesion: Sesion, id: string, cambiosCrudos: Partial<NuevoEmpleado>): Promise<Empleado> {
  const alcance = await alcanceNomina(env, sesion);
  // El tipo (fijo / independiente) se elige al registrar al trabajador y no se cambia después
  const { tipo: _tipo, frecuencia_pago: _frecuencia, ...cambios } = cambiosCrudos;
  validarEmpleado(cambios, false);
  const actual = await obtenerEmpleado(env, id);
  if (!enAlcance(alcance, actual.local_id)) throw new ErrorApi(404, 'El trabajador no existe', 'no_existe');
  if (cambios.local_id && cambios.local_id !== actual.local_id && !enAlcance(alcance, cambios.local_id)) {
    throw new ErrorApi(403, 'No tienes permiso para mover personal a ese local.', 'sin_permiso');
  }

  const valores: Record<string, unknown> = {};
  if (cambios.nombre !== undefined) valores.nombre = texto(cambios.nombre);
  if (cambios.apellido !== undefined) valores.apellido = texto(cambios.apellido);
  if (cambios.cedula !== undefined) valores.cedula = texto(cambios.cedula).toUpperCase();
  if (cambios.cargo !== undefined) valores.cargo = texto(cambios.cargo);
  if (cambios.salario_base !== undefined && actual.tipo === 'FIJO') valores.salario_base = redondear2(Number(cambios.salario_base));
  if (cambios.estado !== undefined) valores.estado = cambios.estado === 'INACTIVO' ? 'INACTIVO' : 'ACTIVO';
  if (cambios.local_id !== undefined) valores.local_id = cambios.local_id;
  if (cambios.fecha_ingreso !== undefined && fechaReal(cambios.fecha_ingreso)) valores.fecha_ingreso = cambios.fecha_ingreso;

  const columnas = Object.keys(valores);
  if (columnas.length > 0) {
    try {
      await env.DB.prepare(`UPDATE empleados SET ${columnas.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).bind(...Object.values(valores), id).run();
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint failed: empleados\.cedula/.test(err.message)) {
        throw new ErrorApi(409, `Ya existe otro empleado con la cédula ${valores.cedula}.`, 'cedula_repetida');
      }
      throw err;
    }
    await env.DB.batch(sentenciasCambio(env.DB, ['empleados'], actual.local_id));
  }
  return (await obtenerEmpleado(env, id));
}

// --- Pagos quincenales ----------------------------------------------------------------------------------------------
function validarQuincena(periodo: { inicio: string; fin: string }): void {
  if (!fechaReal(periodo.inicio) || !fechaReal(periodo.fin)) throw new ErrorApi(400, 'El período del pago no es válido.', 'datos_invalidos');
  const q = quincenaDe(periodo.inicio);
  if (q.inicio !== periodo.inicio || q.fin !== periodo.fin) {
    throw new ErrorApi(400, 'El período debe ser una quincena (del 1 al 15 o del 16 al fin de mes).', 'datos_invalidos');
  }
}

export async function listarNominas(env: Entorno, sesion: Sesion, periodoInicio: string, periodoFin: string): Promise<Nomina[]> {
  const { sql, valores } = condicionAlcance(await alcanceNomina(env, sesion), 'local_id');
  const filas = await env.DB
    .prepare(`SELECT * FROM nominas WHERE periodo_inicio >= ? AND periodo_fin <= ? AND ${sql} ORDER BY periodo_inicio, created_at`)
    .bind(periodoInicio, periodoFin, ...valores)
    .all<Nomina>();
  return filas.results;
}

export async function obtenerNomina(env: Entorno, sesion: Sesion, id: string): Promise<Nomina> {
  const alcance = await alcanceNomina(env, sesion);
  const n = await env.DB.prepare('SELECT * FROM nominas WHERE id = ?').bind(id).first<Nomina>();
  if (!n || !enAlcance(alcance, n.local_id)) throw new ErrorApi(404, 'El pago no existe.', 'no_existe');
  return n;
}

function validarRutaComprobante(ruta: string | null | undefined, localId: string): string | null {
  const r = ruta?.trim();
  if (!r) return null;
  if (!r.startsWith(`comprobantes-nomina/${localId}/`) || r.includes('..')) throw new ErrorApi(400, 'La captura del pago no corresponde a este local.', 'datos_invalidos');
  return r;
}

export interface DatosPagoQuincenal {
  empleadoId: string;
  periodo: { inicio: string; fin: string };
  bonos: number;
  deducciones: number;
  notas?: string | null;
  /** Ruta de la captura ya subida a R2 (comprobantes-nomina/<local>/…) */
  comprobantePath?: string | null;
  quitarComprobante?: boolean;
  pagar: boolean;
}

export async function guardarPagoQuincenal(env: Entorno, sesion: Sesion, datos: DatosPagoQuincenal): Promise<Nomina> {
  const alcance = await alcanceNomina(env, sesion);
  const empleado = await env.DB.prepare('SELECT * FROM empleados WHERE id = ?').bind(datos.empleadoId).first<Empleado>();
  if (!empleado) throw new ErrorApi(404, 'El empleado no existe.', 'no_existe');
  if (!enAlcance(alcance, empleado.local_id)) throw new ErrorApi(403, 'No tienes permiso para registrar pagos en este local.', 'sin_permiso');
  if (empleado.tipo === 'INDEPENDIENTE') throw new ErrorApi(400, 'Un trabajador independiente se paga por día: usa su lista del día.', 'datos_invalidos');
  validarQuincena(datos.periodo);

  const existente = await env.DB
    .prepare('SELECT * FROM nominas WHERE empleado_id = ? AND periodo_inicio = ? AND periodo_fin = ?')
    .bind(empleado.id, datos.periodo.inicio, datos.periodo.fin)
    .first<Nomina>();
  if (existente?.estado_pago === 'PAGADO') throw new ErrorApi(409, 'Ese pago ya está registrado como PAGADO y no se puede modificar.', 'pago_pagado');

  const bonos = redondear2(Number(datos.bonos || 0));
  const deducciones = redondear2(Number(datos.deducciones || 0));
  const pagoBase = pagoBaseQuincenal(empleado.salario_base);
  const errorAjustes = validarAjustes(pagoBase, bonos, deducciones);
  if (errorAjustes) throw new ErrorApi(400, errorAjustes, 'datos_invalidos');
  const notas = texto(datos.notas) || null;
  if (notas && notas.length > 500) throw new ErrorApi(400, 'Las notas admiten hasta 500 caracteres.', 'datos_invalidos');
  const rutaNueva = validarRutaComprobante(datos.comprobantePath, empleado.local_id);
  const comprobante = rutaNueva ?? (datos.quitarComprobante ? null : (existente?.comprobante_path ?? null));
  const estado = datos.pagar ? 'PAGADO' : 'PENDIENTE';
  const pagadoEn = datos.pagar ? ahoraISO() : null;
  const total = totalPago(pagoBase, bonos, deducciones);
  const id = existente?.id ?? nuevoId();

  await env.DB.batch([
    existente
      ? env.DB
          .prepare('UPDATE nominas SET pago_base = ?, bonos = ?, deducciones = ?, total_pagado = ?, estado_pago = ?, pagado_en = ?, notas = ?, comprobante_path = ? WHERE id = ?')
          .bind(pagoBase, bonos, deducciones, total, estado, pagadoEn, notas, comprobante, id)
      : env.DB
          .prepare('INSERT INTO nominas (id, empleado_id, local_id, periodo_inicio, periodo_fin, pago_base, bonos, deducciones, total_pagado, estado_pago, pagado_en, notas, comprobante_path, registrado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(id, empleado.id, empleado.local_id, datos.periodo.inicio, datos.periodo.fin, pagoBase, bonos, deducciones, total, estado, pagadoEn, notas, comprobante, sesion.userId),
    ...sentenciasCambio(env.DB, ['nominas'], empleado.local_id),
  ]);
  return (await env.DB.prepare('SELECT * FROM nominas WHERE id = ?').bind(id).first<Nomina>())!;
}

/** Crea el pago PENDIENTE de la quincena de cada empleado fijo activo que todavía no lo tiene. Devuelve cuántos creó. */
export async function generarPagosPendientes(env: Entorno, sesion: Sesion, periodo: { inicio: string; fin: string }, localId?: string): Promise<{ creados: number }> {
  const alcance = await alcanceNomina(env, sesion, localId);
  validarQuincena(periodo);
  const { sql, valores } = condicionAlcance(alcance, 'local_id');
  const empleados = await env.DB
    .prepare(`SELECT id, local_id, salario_base FROM empleados WHERE estado = 'ACTIVO' AND tipo = 'FIJO' AND ${sql}`)
    .bind(...valores)
    .all<{ id: string; local_id: string; salario_base: number }>();
  const conPago = new Set(
    (await env.DB.prepare('SELECT empleado_id FROM nominas WHERE periodo_inicio = ? AND periodo_fin = ?').bind(periodo.inicio, periodo.fin).all<{ empleado_id: string }>()).results.map((r) => r.empleado_id)
  );
  const faltan = empleados.results.filter((e) => !conPago.has(e.id));
  if (faltan.length > 200) throw new ErrorApi(400, 'Son demasiados empleados para generar de una sola vez.', 'lote_grande');
  if (faltan.length === 0) return { creados: 0 };

  const locales = [...new Set(faltan.map((e) => e.local_id))];
  await env.DB.batch([
    ...faltan.map((e) => {
      const base = pagoBaseQuincenal(e.salario_base);
      return env.DB
        .prepare("INSERT INTO nominas (id, empleado_id, local_id, periodo_inicio, periodo_fin, pago_base, bonos, deducciones, total_pagado, estado_pago, registrado_por) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, 'PENDIENTE', ?)")
        .bind(nuevoId(), e.id, e.local_id, periodo.inicio, periodo.fin, base, base, sesion.userId);
    }),
    ...locales.flatMap((l) => sentenciasCambio(env.DB, ['nominas'], l)),
  ]);
  return { creados: faltan.length };
}

export async function eliminarPagoPendiente(env: Entorno, sesion: Sesion, id: string): Promise<void> {
  const pago = await obtenerNomina(env, sesion, id);
  if (pago.estado_pago === 'PAGADO') throw new ErrorApi(409, 'Un pago ya registrado como PAGADO no se puede borrar.', 'pago_pagado');
  await env.DB.batch([env.DB.prepare('DELETE FROM nominas WHERE id = ?').bind(id), ...sentenciasCambio(env.DB, ['nominas', 'nomina_reventas'], pago.local_id)]);
}

// --- Trabajadores independientes: pago diario por reventa --------------------------------------------------------------------
export interface DatosPagoIndependiente {
  empleadoId: string;
  dia: string;
  lineas: LineaReventa[];
  bonos: number;
  deducciones: number;
  notas: string | null;
  comprobantePath?: string | null;
  quitarComprobante?: boolean;
  pagar: boolean;
}

const dolares = (n: number) => `$${n.toFixed(2)}`;

/** Guarda el día de un trabajador independiente: valida la lista, calcula el pago y (si se pide) lo marca PAGADO. Devuelve el id del pago. */
export async function guardarPagoIndependiente(env: Entorno, sesion: Sesion, datos: DatosPagoIndependiente): Promise<string> {
  const alcance = await alcanceNomina(env, sesion);
  const empleado = await obtenerEmpleado(env, datos.empleadoId);
  if (!enAlcance(alcance, empleado.local_id)) throw new ErrorApi(403, 'No tienes permiso para registrar pagos en este local', 'sin_permiso');
  if (empleado.tipo !== 'INDEPENDIENTE') throw new ErrorApi(400, 'Este trabajador es fijo: su pago es quincenal', 'datos_invalidos');
  if (!fechaReal(datos.dia)) throw new ErrorApi(400, 'El día del pago no es válido.', 'datos_invalidos');
  if (!Array.isArray(datos.lineas)) throw new ErrorApi(400, 'La lista de productos no es válida', 'datos_invalidos');
  if (datos.lineas.length > MAX_LINEAS) throw new ErrorApi(400, `La lista admite hasta ${MAX_LINEAS} productos.`, 'lote_grande');
  const bonos = redondear2(Number(datos.bonos || 0));
  const deducciones = redondear2(Number(datos.deducciones || 0));
  if (bonos < 0 || deducciones < 0) throw new ErrorApi(400, 'Los bonos y las deducciones no pueden ser negativos', 'datos_invalidos');

  const existente = await env.DB
    .prepare('SELECT * FROM nominas WHERE empleado_id = ? AND periodo_inicio = ? AND periodo_fin = ?')
    .bind(empleado.id, datos.dia, datos.dia)
    .first<Nomina>();
  if (existente?.estado_pago === 'PAGADO') throw new ErrorApi(409, 'El pago de ese día ya está registrado como PAGADO y no se puede modificar', 'pago_pagado');
  if (!existente && empleado.estado !== 'ACTIVO') throw new ErrorApi(400, 'El trabajador está inactivo', 'datos_invalidos');

  // Validar la lista y calcular la ganancia (Σ cantidad × (vendido − lista))
  let base = 0;
  const lineas = datos.lineas.map((l) => {
    const nombre = texto(l.producto_nombre);
    if (!nombre) throw new ErrorApi(400, 'Cada línea debe tener el nombre del producto', 'datos_invalidos');
    const cantidad = Number(l.cantidad);
    const lista = redondear2(Number(l.precio_lista));
    const vendido = redondear2(Number(l.precio_vendido));
    if (!Number.isInteger(cantidad) || cantidad <= 0) throw new ErrorApi(400, `La cantidad de "${nombre}" debe ser mayor a 0`, 'datos_invalidos');
    if (!Number.isFinite(lista) || lista < 0 || !Number.isFinite(vendido)) throw new ErrorApi(400, `Los precios de "${nombre}" no son válidos`, 'datos_invalidos');
    if (vendido < lista) throw new ErrorApi(400, `"${nombre}" no puede venderse por debajo de su precio (${dolares(vendido)} < ${dolares(lista)})`, 'datos_invalidos');
    base += cantidad * (vendido - lista);
    return { producto_id: l.producto_id || null, nombre, codigo: texto(l.producto_codigo) || null, cantidad, lista, vendido };
  });
  base = redondear2(base);
  const total = redondear2(base + bonos - deducciones);
  if (total < 0) throw new ErrorApi(400, 'Las deducciones no pueden superar la ganancia más los bonos', 'datos_invalidos');
  if (datos.pagar && lineas.length === 0) throw new ErrorApi(400, 'Agrega al menos un producto a la lista antes de registrar el pago', 'datos_invalidos');
  const notas = texto(datos.notas) || null;
  if (notas && notas.length > 500) throw new ErrorApi(400, 'Las notas admiten hasta 500 caracteres.', 'datos_invalidos');
  const rutaNueva = validarRutaComprobante(datos.comprobantePath, empleado.local_id);
  const comprobante = rutaNueva ?? (datos.quitarComprobante ? null : (existente?.comprobante_path ?? null));

  // Solo se enlazan los productos que existen (el catálogo puede haber cambiado)
  const existentes = new Set<string>();
  for (const tramo of tramos([...new Set(lineas.map((l) => l.producto_id).filter((id): id is string => !!id))])) {
    const filas = await env.DB.prepare(`SELECT id FROM productos WHERE id IN (${marcas(tramo.length)})`).bind(...tramo).all<{ id: string }>();
    for (const f of filas.results) existentes.add(f.id);
  }

  const id = existente?.id ?? nuevoId();
  const db = env.DB;
  await db.batch([
    existente
      ? db
          .prepare('UPDATE nominas SET pago_base = ?, bonos = ?, deducciones = ?, total_pagado = ?, notas = ?, comprobante_path = ? WHERE id = ?')
          .bind(base, bonos, deducciones, total, notas, comprobante, id)
      : db
          .prepare("INSERT INTO nominas (id, empleado_id, local_id, periodo_inicio, periodo_fin, pago_base, bonos, deducciones, total_pagado, estado_pago, notas, comprobante_path, registrado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', ?, ?, ?)")
          .bind(id, empleado.id, empleado.local_id, datos.dia, datos.dia, base, bonos, deducciones, total, notas, comprobante, sesion.userId),
    // Un día PENDIENTE se puede rehacer cuantas veces haga falta: se reemplaza la lista
    db.prepare('DELETE FROM nomina_reventas WHERE nomina_id = ?').bind(id),
    ...lineas.map((l) =>
      db
        .prepare('INSERT INTO nomina_reventas (id, nomina_id, local_id, producto_id, producto_nombre, producto_codigo, cantidad, precio_lista, precio_vendido) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(nuevoId(), id, empleado.local_id, l.producto_id && existentes.has(l.producto_id) ? l.producto_id : null, l.nombre, l.codigo, l.cantidad, l.lista, l.vendido)
    ),
    // Por último, si se pidió, se marca como pagado (a partir de aquí ya no se modifica)
    ...(datos.pagar ? [db.prepare("UPDATE nominas SET estado_pago = 'PAGADO', pagado_en = ? WHERE id = ?").bind(ahoraISO(), id)] : []),
    ...sentenciasCambio(db, ['nominas', 'nomina_reventas'], empleado.local_id),
  ]);
  return id;
}

/** Listas de reventa de varios días de pago, agrupadas por id de pago. */
export async function listarReventas(env: Entorno, sesion: Sesion, nominaIds: string[]): Promise<Record<string, LineaReventa[]>> {
  const { sql, valores } = condicionAlcance(await alcanceNomina(env, sesion), 'local_id');
  const porNomina: Record<string, LineaReventa[]> = {};
  for (const tramo of tramos([...new Set(nominaIds)])) {
    const filas = await env.DB
      .prepare(
        `SELECT nomina_id, producto_id, producto_nombre, producto_codigo, cantidad, precio_lista, precio_vendido FROM nomina_reventas
         WHERE nomina_id IN (${marcas(tramo.length)}) AND ${sql} ORDER BY created_at, rowid`
      )
      .bind(...tramo, ...valores)
      .all<LineaReventa & { nomina_id: string }>();
    for (const { nomina_id, ...linea } of filas.results) (porNomina[nomina_id] ??= []).push(linea);
  }
  return porNomina;
}

/** Productos para armar la lista. Sirve también al contador, que no lee el catálogo: solo devuelve datos mínimos (nunca costos ni stock). */
export async function catalogoReventa(env: Entorno, sesion: Sesion, busqueda: string, limite = 30): Promise<ProductoReventa[]> {
  exigirRol(sesion, ['administrador', 'gerente', 'contador']);
  const buscado = busqueda.trim();
  if (!buscado) return [];
  const patron = `%${buscado.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const tope = Math.max(1, Math.min(Math.floor(limite) || 30, 60));
  const filas = await env.DB
    .prepare(
      `SELECT id, codigo_barras, nombre, categoria, precio_venta FROM productos
       WHERE nombre LIKE ? ESCAPE '\\' OR codigo_barras LIKE ? ESCAPE '\\' OR categoria LIKE ? ESCAPE '\\'
       ORDER BY (codigo_barras = ?) DESC, nombre LIMIT ?`
    )
    .bind(patron, patron, patron, buscado, tope)
    .all<ProductoReventa>();
  return filas.results;
}
