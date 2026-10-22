// Reglas puras del cuadre de caja diario: qué se esperaba, qué se contó, qué fotos hacen falta.
// Sin acceso a datos: lo usan inventoryService (valida al cerrar) y la ventana del cuadre (muestra diferencias).
import type { ContadoCuadre, Devolucion, EsperadoCuadre, FotoCuadre, MetodoPago, TipoFotoCuadre, Venta } from '../types/database.types';
import { esMetodoBolivares, METODOS_PAGO } from './pagos';
import { resumirPorMetodo } from './ventasResumen';

/** Diferencias menores a esto (un centavo) se consideran "cuadra". */
export const TOLERANCIA_CUADRE = 0.01;

export interface TipoFoto {
  tipo: TipoFotoCuadre;
  titulo: string;
  ayuda: string;
  /** Tipos de cobro que esa foto respalda: si el sistema esperaba dinero en alguno, la foto es obligatoria al cerrar */
  metodos: MetodoPago[];
}

export const TIPOS_FOTO_CUADRE: TipoFoto[] = [
  { tipo: 'PAGO_MOVIL', titulo: 'Capturas de pagos móviles', ayuda: 'Una captura por cada pago móvil recibido en el día.', metodos: ['BS_PAGO_MOVIL'] },
  { tipo: 'BINANCE', titulo: 'Pagos por Binance USDT', ayuda: 'Captura de cada pago recibido por Binance.', metodos: ['BINANCE_USDT'] },
  { tipo: 'EFECTIVO', titulo: 'Efectivo', ayuda: 'Foto del efectivo contado (bolívares y dólares).', metodos: ['BS_EFECTIVO', 'USD_EFECTIVO'] },
  { tipo: 'CIERRE_PUNTO', titulo: 'Cierre del punto de venta', ayuda: 'Foto del comprobante de cierre (lote) del punto.', metodos: ['BS_PUNTO_VENTA'] },
];

export function tipoFoto(tipo: string): TipoFoto | undefined {
  return TIPOS_FOTO_CUADRE.find((t) => t.tipo === tipo);
}

const centavos = (n: number) => Math.round(n * 100) / 100;

/** Lo esperado por tipo de cobro (neto de vuelto y reembolsos) con las ventas y devoluciones de UN local y día. */
export function esperadoDelDia(
  ventas: Pick<Venta, 'pagos' | 'vuelto' | 'metodo_pago' | 'total' | 'total_bs'>[],
  devoluciones: Pick<Devolucion, 'pagos' | 'vuelto' | 'reembolso'>[]
): EsperadoCuadre[] {
  return resumirPorMetodo(ventas, devoluciones).map((r) => ({
    metodo: r.metodo,
    ventas: r.cantidad,
    usd: centavos(r.totalUsd),
    bs: centavos(r.totalBs),
  }));
}

/** El monto esperado en la moneda en que se cuenta ese tipo de cobro (Bs en los BS_*, $ en los demás). */
export function montoEsperado(e: Pick<EsperadoCuadre, 'metodo' | 'usd' | 'bs'>): number {
  return esMetodoBolivares(e.metodo) ? e.bs : e.usd;
}

export interface FilaCuadre {
  metodo: MetodoPago;
  etiqueta: string;
  enBs: boolean;
  ventas: number;
  esperado: number;
  /** null = todavía no se escribió nada */
  contado: number | null;
  /** contado − esperado (null mientras no hay contado): positivo sobra, negativo falta */
  diferencia: number | null;
}

/** Una fila por tipo de cobro con lo esperado, lo contado y la diferencia. */
export function filasDelCuadre(esperado: EsperadoCuadre[], contado: ContadoCuadre[]): FilaCuadre[] {
  return METODOS_PAGO.map((m) => {
    const e = esperado.find((x) => x.metodo === m.valor) ?? { metodo: m.valor, ventas: 0, usd: 0, bs: 0 };
    const esp = centavos(montoEsperado(e));
    const c = contado.find((x) => x.metodo === m.valor);
    return {
      metodo: m.valor,
      etiqueta: m.etiqueta,
      enBs: esMetodoBolivares(m.valor),
      ventas: e.ventas,
      esperado: esp,
      contado: c ? centavos(c.monto) : null,
      diferencia: c ? centavos(c.monto - esp) : null,
    };
  });
}

/** ¿Hay movimiento esperado en alguno de los tipos de cobro que respalda esta foto? */
export function fotoObligatoria(tipo: TipoFotoCuadre, esperado: EsperadoCuadre[]): boolean {
  const t = tipoFoto(tipo);
  if (!t) return false;
  return esperado.some((e) => t.metodos.includes(e.metodo) && Math.abs(montoEsperado(e)) > TOLERANCIA_CUADRE / 2);
}

/** Motivo por el que todavía no se puede cerrar el cuadre, o null si está completo. */
export function problemaParaCerrar(esperado: EsperadoCuadre[], contado: ContadoCuadre[], fotos: FotoCuadre[]): string | null {
  for (const fila of filasDelCuadre(esperado, contado)) {
    if (fila.contado === null && Math.abs(fila.esperado) > TOLERANCIA_CUADRE / 2) {
      return `Escribe cuánto hay en "${fila.etiqueta}" (el sistema esperaba ${fila.enBs ? 'Bs. ' : '$'}${fila.esperado.toFixed(2)}).`;
    }
    if (fila.contado !== null && fila.contado < 0) return `El monto de "${fila.etiqueta}" no puede ser negativo.`;
  }
  for (const t of TIPOS_FOTO_CUADRE) {
    if (fotoObligatoria(t.tipo, esperado) && !fotos.some((f) => f.tipo === t.tipo)) {
      return `Falta al menos una foto en "${t.titulo}".`;
    }
  }
  return null;
}

/** Inicio y fin (hora local) de un día "aaaa-mm-dd". */
export function rangoDelDia(fecha: string): { desde: Date; hasta: Date } {
  const [a, m, d] = fecha.split('-').map(Number);
  return { desde: new Date(a, m - 1, d, 0, 0, 0, 0), hasta: new Date(a, m - 1, d, 23, 59, 59, 999) };
}
