// Módulo de Inversión: reglas puras compartidas por el servidor (servicios/inversion.ts), la demo (LocalStorage) y la pantalla.
// Una inversión es una compra de mercancía NUEVA (o una pérdida) que el gerente o el administrador anota a mano, por local; el monto va en
// dólares y la tasa BCV de ese día se guarda aparte para mostrar los bolívares de referencia.
import { normalizarNombre } from './altaRapida';
import type { DatosInversion, Inversion, TipoInversion } from '../types/database.types';

export const MONTO_MAXIMO_INVERSION = 10_000_000;

export const ROTULO_TIPO: Record<TipoInversion, string> = { COMPRA: 'Compra', PERDIDA: 'Pérdida' };

const redondear2 = (n: number) => Math.round(n * 100) / 100;

/** "  Distribuidora   Álvarez " → "Distribuidora Álvarez" (null si queda vacío). */
export function limpiarNombreProveedor(texto: string | null | undefined): string | null {
  const limpio = (texto ?? '').replace(/\s+/g, ' ').trim();
  return limpio ? limpio : null;
}

/** Clave para comparar proveedores sin importar mayúsculas, acentos ni espacios de más. */
export const claveProveedor = (nombre: string): string => normalizarNombre(nombre);

export type DatosInversionValidados = Required<Pick<DatosInversion, 'localId' | 'tipo' | 'fecha' | 'descripcion'>> & { proveedor: string | null; monto_usd: number };

/**
 * Valida y normaliza los datos de una inversión. `hoy` es el día del negocio ("aaaa-mm-dd"): no se aceptan fechas del futuro
 * (con un día de margen por la zona horaria). Lanza Error con el mensaje en español.
 */
export function validarDatosInversion(datos: DatosInversion, hoy: string): DatosInversionValidados {
  if (datos.tipo !== 'COMPRA' && datos.tipo !== 'PERDIDA') throw new Error('Elige si es una compra o una pérdida.');
  if (!datos.localId) throw new Error('Elige el local.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha) || Number.isNaN(Date.parse(`${datos.fecha}T00:00:00Z`)) || new Date(`${datos.fecha}T00:00:00Z`).toISOString().slice(0, 10) !== datos.fecha) {
    throw new Error('La fecha no es válida.');
  }
  if (datos.fecha > diaSiguiente(hoy)) throw new Error('La fecha no puede ser futura.');
  const descripcion = (datos.descripcion ?? '').replace(/\s+/g, ' ').trim();
  if (descripcion.length < 3 || descripcion.length > 300) throw new Error('Describe qué se compró o se perdió (de 3 a 300 caracteres).');
  const monto = Number(datos.monto_usd);
  if (!Number.isFinite(monto) || monto <= 0 || monto > MONTO_MAXIMO_INVERSION) throw new Error('El monto debe ser mayor a 0.');
  const proveedor = limpiarNombreProveedor(datos.proveedor);
  if (proveedor && proveedor.length > 80) throw new Error('El nombre del proveedor es demasiado largo (máximo 80 caracteres).');
  return { localId: datos.localId, tipo: datos.tipo, fecha: datos.fecha, descripcion, proveedor, monto_usd: redondear2(monto) };
}

/** El día siguiente de un "aaaa-mm-dd". */
export function diaSiguiente(fecha: string): string {
  return new Date(Date.UTC(+fecha.slice(0, 4), +fecha.slice(5, 7) - 1, +fecha.slice(8, 10) + 1)).toISOString().slice(0, 10);
}

/**
 * La tasa BCV (Bs por $1) que corresponde a una fecha: la última registrada ese día o antes. Si todavía no había ninguna a esa fecha
 * se usa la primera registrada; sin tasas, null. `tasas` es el historial (cualquier orden).
 */
export function tasaParaFecha(tasas: { fecha: string; tasa: number; created_at: string }[], fecha: string): number | null {
  const validas = tasas.filter((t) => t.tasa > 0);
  if (validas.length === 0) return null;
  const orden = (a: (typeof validas)[number], b: (typeof validas)[number]) => (a.fecha === b.fecha ? a.created_at.localeCompare(b.created_at) : a.fecha.localeCompare(b.fecha));
  const hasta = validas.filter((t) => t.fecha <= fecha).sort(orden);
  if (hasta.length > 0) return hasta[hasta.length - 1].tasa;
  return [...validas].sort(orden)[0].tasa;
}

/** Bolívares de referencia de un registro (monto en dólares × la tasa BCV de su fecha); null si no había tasa. */
export const bsDeInversion = (i: Pick<Inversion, 'monto_usd' | 'tasa_bcv'> & { monto_bs_fijo?: number | null }): number | null =>
  i.monto_bs_fijo != null ? redondear2(i.monto_bs_fijo) : i.tasa_bcv && i.tasa_bcv > 0 ? redondear2(i.monto_usd * i.tasa_bcv) : null;

export interface TotalInversion {
  /** Lo invertido en compras */
  compras_usd: number;
  compras_bs: number;
  /** Pérdidas (se muestran aparte: no se restan de la inversión) */
  perdidas_usd: number;
  perdidas_bs: number;
  n_compras: number;
  n_perdidas: number;
  /** Registros que no tienen tasa BCV (sus bolívares no se pueden calcular) */
  sin_tasa: number;
}

export const totalVacio = (): TotalInversion => ({ compras_usd: 0, compras_bs: 0, perdidas_usd: 0, perdidas_bs: 0, n_compras: 0, n_perdidas: 0, sin_tasa: 0 });

/** Suma un grupo de registros (compras y pérdidas por separado, en dólares y en bolívares de referencia). */
export function totalizar(filas: Inversion[]): TotalInversion {
  const t = totalVacio();
  for (const f of filas) {
    const bs = bsDeInversion(f);
    if (bs === null) t.sin_tasa++;
    if (f.tipo === 'COMPRA') {
      t.compras_usd += f.monto_usd;
      t.compras_bs += bs ?? 0;
      t.n_compras++;
    } else {
      t.perdidas_usd += f.monto_usd;
      t.perdidas_bs += bs ?? 0;
      t.n_perdidas++;
    }
  }
  t.compras_usd = redondear2(t.compras_usd);
  t.compras_bs = redondear2(t.compras_bs);
  t.perdidas_usd = redondear2(t.perdidas_usd);
  t.perdidas_bs = redondear2(t.perdidas_bs);
  return t;
}

/** Totales por local (un grupo por cada local aunque no tenga registros). */
export function totalizarPorLocal(filas: Inversion[], localIds: string[]): Map<string, TotalInversion> {
  const m = new Map(localIds.map((id) => [id, [] as Inversion[]]));
  for (const f of filas) (m.get(f.local_id) ?? m.set(f.local_id, []).get(f.local_id)!).push(f);
  return new Map([...m].map(([id, lista]) => [id, totalizar(lista)]));
}

/** Total de COMPRAS por día ("aaaa-mm-dd") dentro de [desde, hasta], con los días sin compras en 0 (para el gráfico). */
export function comprasPorDia(filas: Inversion[], desde: string, hasta: string): { fecha: string; usd: number }[] {
  const suma = new Map<string, number>();
  for (const f of filas) if (f.tipo === 'COMPRA') suma.set(f.fecha, (suma.get(f.fecha) ?? 0) + f.monto_usd);
  const dias: { fecha: string; usd: number }[] = [];
  for (let d = desde, n = 0; d <= hasta && n < 400; d = diaSiguiente(d), n++) dias.push({ fecha: d, usd: redondear2(suma.get(d) ?? 0) });
  return dias;
}

/** Total de COMPRAS por proveedor (los registros sin proveedor van juntos), de mayor a menor. */
export function comprasPorProveedor(filas: Inversion[]): { proveedor: string; usd: number; n: number }[] {
  const m = new Map<string, { proveedor: string; usd: number; n: number }>();
  for (const f of filas) {
    if (f.tipo !== 'COMPRA') continue;
    const nombre = f.proveedor_nombre ?? 'Sin proveedor';
    const clave = claveProveedor(nombre);
    const x = m.get(clave) ?? { proveedor: nombre, usd: 0, n: 0 };
    x.usd += f.monto_usd;
    x.n++;
    m.set(clave, x);
  }
  return [...m.values()].map((x) => ({ ...x, usd: redondear2(x.usd) })).sort((a, b) => b.usd - a.usd);
}

const celdaCsv = (v: string | number | null) => {
  const t = v === null ? '' : String(v);
  return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** CSV de los registros (para abrirlo en Excel): fecha, local, tipo, proveedor, descripción, monto en $, tasa BCV y monto en Bs. */
export function csvInversiones(filas: Inversion[], nombreLocal: (id: string) => string): string {
  const cab = ['Fecha', 'Local', 'Tipo', 'Proveedor', 'Descripción', 'Monto USD', 'Tasa BCV', 'Monto Bs', 'Registrado por'];
  const lineas = filas.map((f) => [f.fecha, nombreLocal(f.local_id), ROTULO_TIPO[f.tipo], f.proveedor_nombre, f.descripcion, f.monto_usd.toFixed(2), f.tasa_bcv, bsDeInversion(f), f.creado_por_nombre].map(celdaCsv).join(','));
  return [cab.join(','), ...lineas].join('\n');
}

/** Lunes de la semana de una fecha "aaaa-mm-dd" (semana de lunes a domingo). */
export function lunesDeSemana(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  const dia = d.getUTCDay(); // 0 = domingo
  d.setUTCDate(d.getUTCDate() - (dia === 0 ? 6 : dia - 1));
  return d.toISOString().slice(0, 10);
}

/** Primer día del mes de una fecha "aaaa-mm-dd". */
export const primerDiaDelMes = (fecha: string): string => `${fecha.slice(0, 7)}-01`;

// --- Pérdidas automáticas: las mermas (vidrios defectuosos o dados de baja) se ven como PÉRDIDA ----------------------

/** El día del negocio ("aaaa-mm-dd") de una marca de tiempo ISO, en la zona horaria dada. */
export function diaDelNegocioDe(iso: string, zona: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

const TEXTO_MOTIVO_MERMA: Record<string, string> = { DEFECTO_FABRICA: 'venía defectuoso', DANADO_AL_COLOCAR: 'se dañó al colocar', OTRO: 'otro motivo' };

export interface MermaParaInversion {
  id: string;
  local_id: string;
  producto_nombre: string | null;
  cantidad: number;
  origen: 'VENTA' | 'DESCARGO';
  motivo: string | null;
  nota: string | null;
  por_nombre: string;
  fecha: string;
  valor_unitario_usd?: number | null;
  /** Valor de una pieza en Bs si el producto tiene precio fijo en bolívares (no se convierte con la tasa) */
  valor_unitario_bs?: number | null;
}

/**
 * Una merma como registro de PÉRDIDA de Inversión (id `merma:<id>`, `automatica`): «3 × Vidrio blindado Samsung A15 — defectuoso en una
 * venta (venía defectuoso)». El monto es cantidad × valor de una pieza (compra, o venta si no hay costo; 0 si no se pudo valorar); si el producto tiene precio FIJO en bolívares, `monto_bs_fijo` lleva los Bs exactos (cantidad × Bs de una pieza) y NO se convierten con la tasa.
 * `dia` es el día del negocio de la merma y `tasa` la BCV de ese día (la pone quien llama).
 */
export function mermaComoPerdida(m: MermaParaInversion, dia: string, tasa: number | null): Inversion {
  const motivo = m.motivo ? TEXTO_MOTIVO_MERMA[m.motivo] : null;
  const origen = m.origen === 'VENTA' ? 'defectuoso en una venta' : 'dado de baja en Descargo';
  const detalle = [motivo, m.nota].filter(Boolean).join(', ');
  const descripcion = `${m.cantidad} × ${m.producto_nombre ?? 'Producto eliminado'} — ${origen}${detalle ? ` (${detalle})` : ''}`;
  return {
    id: `merma:${m.id}`,
    local_id: m.local_id,
    tipo: 'PERDIDA',
    fecha: dia,
    descripcion,
    proveedor_id: null,
    proveedor_nombre: null,
    monto_usd: redondear2(m.cantidad * (m.valor_unitario_usd ?? 0)),
    monto_bs_fijo: m.valor_unitario_bs != null ? redondear2(m.cantidad * m.valor_unitario_bs) : null,
    tasa_bcv: tasa,
    creado_por_nombre: m.por_nombre,
    created_at: m.fecha,
    updated_at: m.fecha,
    automatica: true,
  };
}

/** Ordena como la lista de Inversión: día más reciente primero y, dentro del día, lo último anotado primero. */
export const compararInversiones = (a: Inversion, b: Inversion): number => (a.fecha === b.fecha ? b.created_at.localeCompare(a.created_at) : b.fecha.localeCompare(a.fecha));
