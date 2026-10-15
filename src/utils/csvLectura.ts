// Lectura de archivos CSV (la contraparte de csv.ts, que solo exporta).
// Excel en español guarda los CSV con ";" como separador y a veces en
// Windows-1252, así que se detectan ambas cosas en vez de asumirlas.

/** Decodifica bytes de un archivo: UTF-8 y, si hay caracteres inválidos, Windows-1252. */
export function decodificarArchivo(bytes: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  const texto = utf8.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : utf8;
  return texto.replace(/^﻿/, '');
}

function detectarSeparador(texto: string): string {
  const primeraLinea = texto.split(/\r?\n/, 1)[0] ?? '';
  const conteo = (s: string) => primeraLinea.split(s).length - 1;
  const candidatos: [string, number][] = [
    [';', conteo(';')],
    [',', conteo(',')],
    ['\t', conteo('\t')],
  ];
  return candidatos.sort((a, b) => b[1] - a[1])[0][0];
}

/** Parsea CSV a filas de celdas (respeta comillas, comillas escapadas y saltos de línea en celdas). */
export function parsearCSV(texto: string): string[][] {
  const separador = detectarSeparador(texto);
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let entreComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];

    if (entreComillas) {
      if (c === '"' && texto[i + 1] === '"') {
        celda += '"';
        i++;
      } else if (c === '"') {
        entreComillas = false;
      } else {
        celda += c;
      }
      continue;
    }

    if (c === '"') entreComillas = true;
    else if (c === separador) {
      fila.push(celda);
      celda = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = '';
    } else {
      celda += c;
    }
  }

  if (celda !== '' || fila.length > 0) {
    fila.push(celda);
    filas.push(fila);
  }

  // Descarta filas totalmente vacías (típico al final de los CSV de Excel)
  return filas.filter((f) => f.some((c) => c.trim() !== ''));
}

/** "Q 1,234.50" → 1234.5 · "38,5" → 38.5 · "" → null · "abc" → NaN */
export function parsearNumero(valor: string): number | null {
  let s = valor.replace(/[Qq$\s]/g, '').trim();
  if (s === '') return null;
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, ''); // 1,234.50
  else if (s.includes(',')) s = s.replace(',', '.'); // 38,5
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

/** minúsculas, sin acentos, espacios → "_" (para comparar encabezados y nombres). */
export function normalizarClave(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}
