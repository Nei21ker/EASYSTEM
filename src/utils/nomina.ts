// Cálculos de la nómina quincenal (funciones puras, sin acceso a datos).
//
// Cada mes tiene dos quincenas: del 1 al 15 y del 16 al último día. El pago de una quincena es la MITAD del
// salario mensual del empleado, más bonos, menos deducciones. Las fechas viajan como texto "aaaa-mm-dd"
// (sin hora) para que la zona horaria nunca corra un día el período.

export interface Quincena {
  /** "aaaa-mm-dd" */
  inicio: string;
  fin: string;
  /** Ej.: "16–31 oct 2026" */
  etiqueta: string;
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const dos = (n: number) => String(n).padStart(2, '0');
const ultimoDiaDelMes = (anio: number, mes: number) => new Date(anio, mes, 0).getDate(); // mes 1–12

function construir(anio: number, mes: number, segunda: boolean): Quincena {
  const diaInicio = segunda ? 16 : 1;
  const diaFin = segunda ? ultimoDiaDelMes(anio, mes) : 15;
  return {
    inicio: `${anio}-${dos(mes)}-${dos(diaInicio)}`,
    fin: `${anio}-${dos(mes)}-${dos(diaFin)}`,
    etiqueta: `${diaInicio}–${diaFin} ${MESES_CORTOS[mes - 1]} ${anio}`,
  };
}

/** Fecha local de hoy como "aaaa-mm-dd". */
export function hoyISO(ahora = new Date()): string {
  return `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}`;
}

/** La quincena que contiene una fecha ("aaaa-mm-dd" o Date). */
export function quincenaDe(fecha: string | Date = new Date()): Quincena {
  const iso = typeof fecha === 'string' ? fecha : hoyISO(fecha);
  const [anio, mes, dia] = iso.split('-').map(Number);
  return construir(anio, mes, dia >= 16);
}

export function quincenaSiguiente(q: Quincena): Quincena {
  const [anio, mes, dia] = q.inicio.split('-').map(Number);
  if (dia === 1) return construir(anio, mes, true);
  return mes === 12 ? construir(anio + 1, 1, false) : construir(anio, mes + 1, false);
}

export function quincenaAnterior(q: Quincena): Quincena {
  const [anio, mes, dia] = q.inicio.split('-').map(Number);
  if (dia === 16) return construir(anio, mes, false);
  return mes === 1 ? construir(anio - 1, 12, true) : construir(anio, mes - 1, true);
}

export const redondear2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Pago base de una quincena: la mitad del salario mensual. */
export const pagoBaseQuincenal = (salarioMensual: number) => redondear2(salarioMensual / 2);

/** Total a pagar: base + bonos - deducciones. */
export const totalPago = (base: number, bonos: number, deducciones: number) => redondear2(base + bonos - deducciones);

/** Mensaje de error si bonos/deducciones no son válidos, o null si están bien. */
export function validarAjustes(base: number, bonos: number, deducciones: number): string | null {
  if (!(bonos >= 0)) return 'Los bonos no pueden ser negativos.';
  if (!(deducciones >= 0)) return 'Las deducciones no pueden ser negativas.';
  if (deducciones > base + bonos) return 'Las deducciones no pueden superar el pago base más los bonos.';
  return null;
}
