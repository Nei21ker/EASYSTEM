export type RangoPreestablecido = 'hoy' | 'semana' | 'mes' | 'personalizado';

function inicioDelDia(fecha: Date): Date {
  const copia = new Date(fecha);
  copia.setHours(0, 0, 0, 0);
  return copia;
}

function finDelDia(fecha: Date): Date {
  const copia = new Date(fecha);
  copia.setHours(23, 59, 59, 999);
  return copia;
}

/** Lunes de la semana de `fecha` (semana ISO, lunes a domingo). */
function inicioDeSemana(fecha: Date): Date {
  const copia = inicioDelDia(fecha);
  const diaSemana = copia.getDay(); // 0 = domingo
  const diff = diaSemana === 0 ? 6 : diaSemana - 1;
  copia.setDate(copia.getDate() - diff);
  return copia;
}

function inicioDeMes(fecha: Date): Date {
  const copia = inicioDelDia(fecha);
  copia.setDate(1);
  return copia;
}

/** Calcula el rango [desde, hasta] para un preset; para "personalizado" usa las fechas dadas. */
export function calcularRango(
  preset: RangoPreestablecido,
  personalizado?: { desde?: string; hasta?: string }
): { desde: Date; hasta: Date } {
  const ahora = new Date();

  switch (preset) {
    case 'hoy':
      return { desde: inicioDelDia(ahora), hasta: finDelDia(ahora) };
    case 'semana':
      return { desde: inicioDeSemana(ahora), hasta: finDelDia(ahora) };
    case 'mes':
      return { desde: inicioDeMes(ahora), hasta: finDelDia(ahora) };
    case 'personalizado': {
      const desde = personalizado?.desde ? inicioDelDia(new Date(`${personalizado.desde}T00:00:00`)) : inicioDeMes(ahora);
      const hasta = personalizado?.hasta ? finDelDia(new Date(`${personalizado.hasta}T00:00:00`)) : finDelDia(ahora);
      return { desde, hasta };
    }
  }
}

/** Clave YYYY-MM-DD en hora LOCAL (no usar toISOString: convierte a UTC y desplaza el día). */
export function formatearClaveDia(fecha: Date): string {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

export function formatearEtiquetaDia(claveDia: string): string {
  return new Date(`${claveDia}T00:00:00`).toLocaleDateString('es-GT', { day: '2-digit', month: 'short' });
}

/** Todas las claves de día (YYYY-MM-DD) entre desde y hasta, inclusive. */
export function listarDiasEnRango(desde: Date, hasta: Date): string[] {
  const dias: string[] = [];
  const cursor = inicioDelDia(desde);
  const limite = inicioDelDia(hasta);
  while (cursor <= limite) {
    dias.push(formatearClaveDia(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dias;
}
