/** Dispara la descarga de un CSV (compatible con Excel) a partir de filas planas. */
export function descargarCSV(nombreArchivo: string, filas: Record<string, string | number>[]) {
  if (filas.length === 0) return;

  const columnas = Object.keys(filas[0]);
  const escapar = (valor: unknown) => `"${String(valor ?? '').replace(/"/g, '""')}"`;
  const contenido = [
    columnas.map(escapar).join(','),
    ...filas.map((fila) => columnas.map((columna) => escapar(fila[columna])).join(',')),
  ].join('\r\n');

  // BOM (﻿) para que Excel detecte UTF-8 y no rompa acentos/ñ.
  const blob = new Blob(['﻿' + contenido], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}
