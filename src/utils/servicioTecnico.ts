// Reglas puras del Servicio técnico: cómo se reparte lo que se cobra por una reparación y los resúmenes del técnico.
// Modelo del negocio: la encargada cobra al cliente; de lo cobrado se descuenta el costo de los repuestos que salieron del
// inventario (a precio de catálogo, se los queda la tienda) y de la GANANCIA que queda la tienda toma un porcentaje (varía por
// trabajo) por usar sus instalaciones; el resto es del técnico, que se le paga después. Si el técnico usó una pieza suya no hay
// repuestos del inventario y el porcentaje se calcula sobre todo lo cobrado.
import type { DineroEntregado, OrdenServicio, PagoVenta, RepuestoOrden } from '../types/database.types';
import { esMetodoBolivares, METODOS_PAGO, METODOS_VUELTO, redondeoValido } from './pagos';

/** Porcentaje de la ganancia que se propone para la tienda (se puede cambiar en cada cobro). */
export const PORCENTAJE_LOCAL_PREDETERMINADO = 30;

const centavos = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Costo de los repuestos de la orden a precio de catálogo (cantidad × precio del momento). */
export function repuestosDeOrdenUsd(repuestos: Pick<RepuestoOrden, 'cantidad' | 'precio_unitario'>[]): number {
  return centavos(repuestos.reduce((suma, r) => suma + r.cantidad * r.precio_unitario, 0));
}

export interface EntradaCobro {
  totalCobrado: number;
  repuestosUsd: number;
  porcentaje: number;
}

/** Texto del problema si el cobro no es válido (null si está bien). */
export function errorDeCobro({ totalCobrado, repuestosUsd, porcentaje }: EntradaCobro): string | null {
  if (!Number.isFinite(totalCobrado) || totalCobrado < 0) return 'El total que se cobra debe ser un número mayor o igual a 0.';
  if (!Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 100) return 'El porcentaje de la tienda debe estar entre 0 y 100.';
  if (centavos(totalCobrado) < centavos(repuestosUsd)) return 'El total no puede ser menor que el costo de los repuestos.';
  return null;
}

export interface RepartoCobro {
  /** Lo que queda después de los repuestos (lo que se reparte entre la tienda y el técnico) */
  ganancia: number;
  comision_local_usd: number;
  pago_tecnico_usd: number;
}

/** Reparto del cobro. Comisión redondeada a centavos y el técnico se queda con lo que resta, así la suma siempre cuadra. */
export function repartoDeCobro({ totalCobrado, repuestosUsd, porcentaje }: EntradaCobro): RepartoCobro {
  const ganancia = centavos(Math.max(0, totalCobrado - repuestosUsd));
  const comision = centavos((ganancia * porcentaje) / 100);
  return { ganancia, comision_local_usd: comision, pago_tecnico_usd: centavos(ganancia - comision) };
}

export interface ResumenTecnico {
  /** Trabajos ya cobrados */
  trabajos: number;
  /** Total que le corresponde por esos trabajos */
  ganado: number;
  /** De eso, lo que ya se le pagó */
  pagado: number;
  /** Lo que todavía se le debe */
  pendiente: number;
  /** Trabajos que tiene en manos (aún no entregados) */
  enCurso: number;
}

/** Una orden cuenta como trabajo hecho cuando ya se cobró con el reparto (`cobrado_en`). */
const esTrabajoCobrado = (o: OrdenServicio) => !!o.cobrado_en && o.pago_tecnico_usd != null;

/** El historial del técnico: cuántos trabajos hizo y cuánto ganó (opcionalmente desde una fecha ISO). */
export function resumirTecnico(ordenes: OrdenServicio[], tecnicoId: string, desdeISO?: string): ResumenTecnico {
  const r: ResumenTecnico = { trabajos: 0, ganado: 0, pagado: 0, pendiente: 0, enCurso: 0 };
  for (const o of ordenes) {
    if (o.tecnico_id !== tecnicoId) continue;
    if (o.estado !== 'entregado') {
      r.enCurso++;
      continue;
    }
    if (!esTrabajoCobrado(o) || (desdeISO && o.cobrado_en! < desdeISO)) continue;
    r.trabajos++;
    const monto = o.pago_tecnico_usd!;
    r.ganado = centavos(r.ganado + monto);
    if (o.tecnico_pagado_en) r.pagado = centavos(r.pagado + monto);
    else r.pendiente = centavos(r.pendiente + monto);
  }
  return r;
}

export interface ResumenDeUnTecnico extends Omit<ResumenTecnico, 'enCurso'> {
  tecnico_id: string;
  tecnico_nombre: string;
  /** Ids de las órdenes cobradas cuya parte todavía no se le pagó (las que se liquidan juntas) */
  idsPendientes: string[];
}

/** Por técnico: trabajos cobrados, lo ganado y lo que se le debe (primero a quien más se le debe). */
export function resumenPorTecnico(ordenes: OrdenServicio[]): ResumenDeUnTecnico[] {
  const porTecnico = new Map<string, ResumenDeUnTecnico>();
  for (const o of ordenes) {
    if (!o.tecnico_id || !esTrabajoCobrado(o)) continue;
    const t =
      porTecnico.get(o.tecnico_id) ??
      { tecnico_id: o.tecnico_id, tecnico_nombre: o.tecnico_nombre ?? 'Técnico', trabajos: 0, ganado: 0, pagado: 0, pendiente: 0, idsPendientes: [] };
    porTecnico.set(o.tecnico_id, t);
    t.trabajos++;
    const monto = o.pago_tecnico_usd!;
    t.ganado = centavos(t.ganado + monto);
    if (o.tecnico_pagado_en) t.pagado = centavos(t.pagado + monto);
    else {
      t.pendiente = centavos(t.pendiente + monto);
      t.idsPendientes.push(o.id);
    }
  }
  return [...porTecnico.values()].sort((a, b) => b.pendiente - a.pendiente || a.tecnico_nombre.localeCompare(b.tecnico_nombre));
}

export interface EntradaPagosCobro {
  pagos: PagoVenta[];
  vuelto?: DineroEntregado | null;
  tasa?: number | null;
  /** Total que paga el cliente, en dólares y ya redondeado a centavos */
  total: number;
}

/**
 * Revisa los pagos de un cobro (tipos válidos, bolívares con tasa, pagos − vuelto = total). Devuelve el texto del problema o los
 * bolívares realmente cobrados (suma de lo recibido en Bs − el vuelto en Bs; null si no se cobró nada en Bs).
 */
export function validarPagosCobro({ pagos, vuelto, tasa, total }: EntradaPagosCobro): { error: string } | { totalBs: number | null } {
  if (!Array.isArray(pagos) || (pagos.length === 0 && total > 0)) return { error: 'Anota los pagos del cliente: con qué pagó y cuánto.' };
  const tasaDelDia = tasa ?? 0;
  let recibido = 0;
  let bs = 0;
  let hayBs = false;
  for (const p of pagos) {
    if (!METODOS_PAGO.some((m) => m.valor === p.metodo)) return { error: 'Tipo de cobro inválido.' };
    if (!Number.isFinite(p.monto_usd) || p.monto_usd <= 0) return { error: 'Cada pago debe ser un monto mayor a 0.' };
    if (esMetodoBolivares(p.metodo)) {
      if (!(tasaDelDia > 0)) return { error: 'Para cobrar en bolívares hace falta la tasa del día.' };
      if (p.monto_bs == null || !Number.isFinite(p.monto_bs) || p.monto_bs <= 0) return { error: 'Anota cuántos bolívares pagó el cliente.' };
      if (!redondeoValido(p, tasaDelDia)) return { error: 'El redondeo de un pago en bolívares no es válido.' };
      hayBs = true;
      bs += p.monto_bs;
    } else if (p.monto_bs != null) {
      return { error: 'Un pago en dólares no lleva monto en bolívares.' };
    }
    recibido += p.monto_usd;
  }
  let entregado = 0;
  if (vuelto) {
    if (!METODOS_VUELTO.includes(vuelto.metodo) || !Number.isFinite(vuelto.monto_usd) || vuelto.monto_usd <= 0) return { error: 'El vuelto no es válido.' };
    if (esMetodoBolivares(vuelto.metodo)) {
      if (vuelto.monto_bs == null || !(vuelto.monto_bs > 0)) return { error: 'El vuelto en bolívares no es válido.' };
      bs -= vuelto.monto_bs;
      hayBs = true;
    }
    entregado = vuelto.monto_usd;
  }
  if (Math.abs(centavos(recibido - entregado) - total) > 0.011) return { error: 'Los pagos (menos el vuelto) no suman el total de la reparación.' };
  return { totalBs: hayBs ? centavos(bs) : null };
}

export type PeriodoResumen = 'hoy' | 'semana' | 'mes' | 'todo';

/** Inicio (ISO) del período contado desde ahora en la hora local: hoy, semana (desde el lunes), mes; `todo` = sin límite. */
export function inicioDelPeriodo(periodo: PeriodoResumen, ahora: Date = new Date()): string | undefined {
  if (periodo === 'todo') return undefined;
  const inicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  if (periodo === 'semana') inicio.setDate(inicio.getDate() - ((inicio.getDay() + 6) % 7));
  if (periodo === 'mes') inicio.setDate(1);
  return inicio.toISOString();
}

export interface ResumenTienda {
  trabajos: number;
  /** Total que pagaron los clientes por reparaciones */
  cobrado: number;
  /** Lo que se queda la tienda por usar sus instalaciones (el costo de los repuestos va aparte: ya era de la tienda) */
  comision: number;
  /** Lo que corresponde a los técnicos (pagado o por pagar) */
  paraTecnicos: number;
}

/** Lo cobrado por reparaciones y cómo se repartió, desde una fecha ISO (opcional). */
export function resumirTienda(ordenes: OrdenServicio[], desdeISO?: string): ResumenTienda {
  const r: ResumenTienda = { trabajos: 0, cobrado: 0, comision: 0, paraTecnicos: 0 };
  for (const o of ordenes) {
    if (!esTrabajoCobrado(o) || (desdeISO && o.cobrado_en! < desdeISO)) continue;
    r.trabajos++;
    r.cobrado = centavos(r.cobrado + o.total_usd);
    r.comision = centavos(r.comision + (o.comision_local_usd ?? 0));
    r.paraTecnicos = centavos(r.paraTecnicos + (o.pago_tecnico_usd ?? 0));
  }
  return r;
}

/** Mensaje de WhatsApp para avisarle al cliente que su equipo ya está reparado y puede pasar a retirarlo. */
export function mensajeEquipoListo(datos: { cliente: string; marca: string; modelo: string; folio: number; local?: string | null }): string {
  const primerNombre = datos.cliente.trim().split(/\s+/)[0] || 'cliente';
  const equipo = `${datos.marca} ${datos.modelo}`.trim();
  const donde = datos.local ? ` en ${datos.local}` : '';
  return `Hola ${primerNombre}, te escribimos de Edward Accesorios. Tu ${equipo} (orden #${String(datos.folio).padStart(4, '0')}) ya está listo. Puedes pasar a retirarlo${donde}. ¡Gracias por confiar en nosotros!`;
}
