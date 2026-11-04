// Utilidades del servidor compartidas por todos los módulos.

export function nuevoId(): string {
  return crypto.randomUUID();
}

/** Fecha y hora actual en ISO-8601 UTC (el formato de todas las columnas de fecha de D1). */
export function ahoraISO(): string {
  return new Date().toISOString();
}

/** Dos decimales, igual que el redondeo del cliente (dinero en dólares). */
export function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Sentencia que incrementa un contador y devuelve el nuevo valor (`RETURNING valor`). Va dentro de un `db.batch`
 * junto con la fila que usa el número (folio de venta, secuencia de códigos de unidad…), así que ambos se confirman
 * o se revierten juntos y dos peticiones nunca reciben el mismo número.
 */
export function sentenciaContador(db: D1Database, nombre: string): D1PreparedStatement {
  return db
    .prepare('INSERT INTO contadores (nombre, valor) VALUES (?, 1) ON CONFLICT (nombre) DO UPDATE SET valor = valor + 1 RETURNING valor')
    .bind(nombre);
}

/** Diferencia (hora local − UTC) en minutos de una zona horaria en un instante dado. */
function desfaseMinutos(instante: number, zona: string): number {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
      .formatToParts(new Date(instante))
      .map((p) => [p.type, p.value])
  );
  const comoUTC = Date.UTC(+partes.year, +partes.month - 1, +partes.day, +partes.hour, +partes.minute, +partes.second);
  return Math.round((comoUTC - Math.floor(instante / 1000) * 1000) / 60_000);
}

function inicioDelDiaUTC(fecha: string, zona: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  const medianoche = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  if (!m || Number.isNaN(medianoche) || new Date(medianoche).toISOString().slice(0, 10) !== fecha) throw new Error(`Fecha inválida: ${fecha}`);
  // Se corrige una vez por si el desfase cambia entre la medianoche UTC y el inicio real del día (horario de verano)
  const aproximado = medianoche - desfaseMinutos(medianoche, zona) * 60_000;
  return medianoche - desfaseMinutos(aproximado, zona) * 60_000;
}

/** El día `aaaa-mm-dd` de una zona horaria como rango [desde, hasta) en ISO UTC (así se filtran las ventas del día del negocio). */
export function rangoDelDiaUTC(fecha: string, zona: string): { desde: string; hasta: string } {
  const siguiente = new Date(Date.UTC(+fecha.slice(0, 4), +fecha.slice(5, 7) - 1, +fecha.slice(8, 10) + 1)).toISOString().slice(0, 10);
  return { desde: new Date(inicioDelDiaUTC(fecha, zona)).toISOString(), hasta: new Date(inicioDelDiaUTC(siguiente, zona)).toISOString() };
}

/** Límite de filas de una consulta a partir de un parámetro de la URL: texto, NaN o infinito → valor por defecto; se acota a 1..maximo. */
export function limiteSeguro(valor: number | undefined, porDefecto: number, maximo: number): number {
  const n = typeof valor === 'number' && Number.isFinite(valor) ? Math.floor(valor) : porDefecto;
  return Math.min(Math.max(1, n), maximo);
}
