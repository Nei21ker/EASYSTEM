// Lee y VALIDA la carpeta datos-controles/ (inventario.csv + las fotos) sin tocar la base de datos ni la red.
//
// Formato de inventario.csv (con coma o punto y coma; la primera fila son los nombres de las columnas, en cualquier orden):
//   nombre | modelo       Nombre del producto (obligatorio, sin repetir)
//   precio_venta | precio Precio de venta en dólares (obligatorio, 5.50 o 5,50)
//   cantidad | stock      Unidades que hay (obligatorio, entero, 0 si todavía no hay)
//   foto | imagen         Nombre del archivo de la foto: se busca en la carpeta y en su subcarpeta fotos/ (obligatorio)
//   codigo                Código de barras de fábrica (opcional; si falta, el sistema le crea uno interno)
//   precio_compra | costo Costo en dólares (opcional)
//   stock_minimo | minimo Aviso de reabastecimiento (opcional)
//   categoria             Categoría (opcional; por defecto "Cargadores")
import { access, readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

export const CATEGORIA_POR_DEFECTO = 'Cargadores';
const EXTENSIONES_FOTO = ['.jpg', '.jpeg', '.png', '.webp'];

const sinAcentos = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '');
const clave = (t) => sinAcentos(String(t)).toLowerCase().replace(/[\s_-]+/g, '_').replace(/^_|_$/g, '');
const limpio = (t) => String(t ?? '').trim().replace(/\s+/g, ' ');

const ALIAS = {
  nombre: ['nombre', 'modelo', 'producto', 'descripcion'],
  precio_venta: ['precio_venta', 'precio', 'precio_de_venta', 'pvp'],
  cantidad: ['cantidad', 'stock', 'existencia', 'existencias', 'unidades'],
  foto: ['foto', 'imagen', 'archivo', 'foto_archivo'],
  codigo_fabrica: ['codigo', 'codigo_fabrica', 'codigo_barras', 'barras'],
  precio_compra: ['precio_compra', 'costo', 'precio_de_compra'],
  stock_minimo: ['stock_minimo', 'minimo'],
  categoria: ['categoria'],
};
const OBLIGATORIAS = ['nombre', 'precio_venta', 'cantidad', 'foto'];

/** Parser CSV: comillas dobles, saltos de línea dentro de comillas, BOM y separador coma o punto y coma. */
export function parsearCsv(texto) {
  const sinBom = texto.replace(/^﻿/, '');
  const primera = sinBom.split(/\r?\n/, 1)[0] ?? '';
  const separador = (primera.match(/;/g)?.length ?? 0) > (primera.match(/,/g)?.length ?? 0) ? ';' : ',';
  const filas = [];
  let fila = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < sinBom.length; i++) {
    const c = sinBom[i];
    if (comillas) {
      if (c === '"' && sinBom[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === separador) {
      fila.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && sinBom[i + 1] === '\n') i++;
      fila.push(campo);
      filas.push({ campos: fila, linea: filas.length + 1 });
      fila = [];
      campo = '';
    } else campo += c;
  }
  if (campo !== '' || fila.length > 0) {
    fila.push(campo);
    filas.push({ campos: fila, linea: filas.length + 1 });
  }
  return filas.filter((f) => f.campos.some((c) => c.trim() !== ''));
}

/** "5,50", "5.50", "$ 5", "1.234,56" → número; null si no lo es. */
export function leerNumero(texto) {
  let t = String(texto ?? '').replace(/[$\s]/g, '');
  if (t === '' || !/^-?[\d.,]+$/.test(t)) return null;
  const ultimaComa = t.lastIndexOf(',');
  const ultimoPunto = t.lastIndexOf('.');
  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    // El último separador es el decimal; el otro agrupa miles
    t = ultimaComa > ultimoPunto ? t.replaceAll('.', '').replace(',', '.') : t.replaceAll(',', '');
  } else if (ultimaComa >= 0) t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

async function existe(ruta) {
  try {
    await access(ruta);
    return true;
  } catch {
    return false;
  }
}

/** Ruta real de la foto (en la carpeta o en fotos/), o null. */
export async function rutaDeFoto(carpeta, nombre) {
  for (const base of [carpeta, join(carpeta, 'fotos')]) {
    const ruta = join(base, nombre);
    if (await existe(ruta)) return ruta;
  }
  return null;
}

/**
 * @returns {Promise<{ filas: Array<{ linea: number, nombre: string, precio_venta: number, cantidad: number, foto: string, ruta_foto: string,
 *   codigo_fabrica?: string, precio_compra?: number, stock_minimo?: number, categoria: string }>, problemas: string[] }>}
 */
export async function leerInventario(carpeta) {
  const problemas = [];
  const archivoCsv = join(carpeta, 'inventario.csv');
  let texto;
  try {
    texto = await readFile(archivoCsv, 'utf8');
  } catch {
    const otros = await readdir(carpeta).catch(() => []);
    const csvs = otros.filter((n) => n.toLowerCase().endsWith('.csv'));
    return {
      filas: [],
      problemas: [
        csvs.length > 0
          ? `No encuentro inventario.csv en ${carpeta} (hay ${csvs.join(', ')}: renómbralo a inventario.csv).`
          : `No encuentro inventario.csv en ${carpeta}.`,
      ],
    };
  }

  const registros = parsearCsv(texto);
  if (registros.length === 0) return { filas: [], problemas: ['El archivo inventario.csv está vacío.'] };

  // Columnas
  const cabecera = registros[0].campos.map(clave);
  const indice = {};
  for (const [campo, alias] of Object.entries(ALIAS)) {
    const i = cabecera.findIndex((c) => alias.includes(c));
    if (i >= 0) indice[campo] = i;
  }
  for (const obligatoria of OBLIGATORIAS) {
    if (indice[obligatoria] === undefined) problemas.push(`Falta la columna "${obligatoria}" en la primera fila de inventario.csv.`);
  }
  if (problemas.length > 0) return { filas: [], problemas };
  if (registros.length === 1) return { filas: [], problemas: ['En inventario.csv no hay productos (solo la fila de títulos).'] };

  const filas = [];
  const nombresVistos = new Map();
  const codigosVistos = new Map();
  for (const { campos, linea } of registros.slice(1)) {
    const dato = (campo) => (indice[campo] === undefined ? '' : limpio(campos[indice[campo]]));
    const etiqueta = `Línea ${linea}${dato('nombre') ? ` (${dato('nombre')})` : ''}`;
    const antes = problemas.length;

    const nombre = dato('nombre');
    if (!nombre) problemas.push(`${etiqueta}: falta el nombre.`);

    const precio = leerNumero(dato('precio_venta'));
    if (precio === null || precio < 0) problemas.push(`${etiqueta}: el precio "${dato('precio_venta')}" no es un número válido (usa 5.50 o 5,50; no puede ser negativo).`);

    const cantidadNumero = leerNumero(dato('cantidad'));
    if (cantidadNumero === null || !Number.isInteger(cantidadNumero) || cantidadNumero < 0) {
      problemas.push(`${etiqueta}: la cantidad "${dato('cantidad')}" debe ser un número entero de 0 o más.`);
    }

    const foto = dato('foto');
    let rutaFoto = null;
    if (!foto) problemas.push(`${etiqueta}: falta el nombre de la foto.`);
    else if (!EXTENSIONES_FOTO.includes(extname(foto).toLowerCase())) problemas.push(`${etiqueta}: la foto "${foto}" debe ser .jpg, .png o .webp.`);
    else {
      rutaFoto = await rutaDeFoto(carpeta, foto);
      if (!rutaFoto) problemas.push(`${etiqueta}: la foto "${foto}" no existe (la busqué en ${carpeta} y en su subcarpeta fotos).`);
    }

    let precioCompra;
    if (dato('precio_compra') !== '') {
      precioCompra = leerNumero(dato('precio_compra'));
      if (precioCompra === null || precioCompra < 0) problemas.push(`${etiqueta}: el costo "${dato('precio_compra')}" no es un número válido.`);
    }
    let stockMinimo;
    if (dato('stock_minimo') !== '') {
      stockMinimo = leerNumero(dato('stock_minimo'));
      if (stockMinimo === null || !Number.isInteger(stockMinimo) || stockMinimo < 0) problemas.push(`${etiqueta}: el stock mínimo "${dato('stock_minimo')}" debe ser un entero de 0 o más.`);
    }

    const claveNombre = clave(nombre);
    if (nombre) {
      if (nombresVistos.has(claveNombre)) problemas.push(`${etiqueta}: nombre repetido (ya está en la línea ${nombresVistos.get(claveNombre)}).`);
      else nombresVistos.set(claveNombre, linea);
    }
    const codigo = dato('codigo_fabrica');
    if (codigo) {
      if (codigosVistos.has(codigo)) problemas.push(`${etiqueta}: el código ${codigo} ya está en la línea ${codigosVistos.get(codigo)}.`);
      else codigosVistos.set(codigo, linea);
    }

    if (problemas.length === antes) {
      filas.push({
        linea,
        nombre,
        precio_venta: Math.round(precio * 100) / 100,
        cantidad: cantidadNumero,
        foto,
        ruta_foto: rutaFoto,
        ...(codigo ? { codigo_fabrica: codigo } : {}),
        ...(precioCompra !== undefined ? { precio_compra: Math.round(precioCompra * 100) / 100 } : {}),
        ...(stockMinimo !== undefined ? { stock_minimo: stockMinimo } : {}),
        categoria: dato('categoria') || CATEGORIA_POR_DEFECTO,
      });
    }
  }
  return { filas, problemas };
}
