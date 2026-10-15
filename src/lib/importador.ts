// Importación de productos desde CSV: PREPARACIÓN (pura, sin acceso a datos).
//
// Recibe el texto del archivo + los productos/modelos actuales y devuelve un
// plan revisable (qué se crea, qué se actualiza, qué falló). Aplicarlo es
// trabajo de inventoryService.importarProductos().
import { generarCodigosInternos } from '../utils/codigos';
import { normalizarClave, parsearCSV, parsearNumero } from '../utils/csvLectura';
import type { ModeloTelefono, ProductoConRelaciones } from '../types/database.types';

export interface FilaImportacion {
  linea: number;
  accion: 'crear' | 'actualizar';
  productoId?: string;
  codigo_barras: string;
  codigoGenerado: boolean;
  nombre: string;
  categoria: string;
  precio_venta: number;
  /** null = la columna no venía en el archivo: no se toca */
  precio_compra: number | null;
  stock_minimo: number | null;
  /** Stock declarado en el archivo; se aplica como movimiento, nunca directo */
  stock_objetivo: number | null;
  /** null = no tocar compatibilidades */
  modeloIds: string[] | null;
  /** Texto corto de lo que cambia (solo actualizaciones), para la vista previa */
  cambios: string[];
}

export interface PlanImportacion {
  filas: FilaImportacion[];
  errores: { linea: number; mensaje: string }[];
  advertencias: { linea: number; mensaje: string }[];
  resumen: {
    leidas: number;
    creados: number;
    actualizados: number;
    sinCambios: number;
    codigosGenerados: number;
    ajustesStock: number;
  };
}

export const PLANTILLA_CSV = [
  'codigo_barras,nombre,categoria,precio_venta,precio_compra,stock_actual,stock_minimo,compatible_con',
  ',Forro de silicona iPhone 15,Forros,38,0,0,0,Apple iPhone 15',
  '7501234567890,Cargador rápido 20W USB-C,Cargadores,80,32,10,5,',
  ',Vidrio templado universal 6.1,Vidrios Templados,16,4,0,10,Apple iPhone 13 | Samsung Galaxy A54 | Redmi Note 12',
].join('\r\n');

const ALIAS_COLUMNAS: Record<string, string> = {
  codigo_barras: 'codigo_barras',
  codigo: 'codigo_barras',
  codigo_de_barras: 'codigo_barras',
  barras: 'codigo_barras',
  sku: 'codigo_barras',
  nombre: 'nombre',
  producto: 'nombre',
  descripcion: 'nombre',
  categoria: 'categoria',
  precio_venta: 'precio_venta',
  precio: 'precio_venta',
  pvp: 'precio_venta',
  venta: 'precio_venta',
  precio_compra: 'precio_compra',
  costo: 'precio_compra',
  compra: 'precio_compra',
  stock_actual: 'stock_actual',
  stock: 'stock_actual',
  cantidad: 'stock_actual',
  existencia: 'stock_actual',
  stock_minimo: 'stock_minimo',
  minimo: 'stock_minimo',
  compatible_con: 'compatible_con',
  compatibilidad: 'compatible_con',
  compatibilidades: 'compatible_con',
  modelos: 'compatible_con',
};

function entero(valor: string, etiqueta: string): { n: number | null; error?: string } {
  const n = parsearNumero(valor);
  if (n === null) return { n: null };
  if (Number.isNaN(n)) return { n: null, error: `${etiqueta} no es un número ("${valor}")` };
  if (n < 0 || !Number.isInteger(n)) return { n: null, error: `${etiqueta} debe ser un entero mayor o igual a 0 ("${valor}")` };
  return { n };
}

export function prepararImportacion(
  texto: string,
  existentes: ProductoConRelaciones[],
  modelos: ModeloTelefono[]
): PlanImportacion {
  const plan: PlanImportacion = {
    filas: [],
    errores: [],
    advertencias: [],
    resumen: { leidas: 0, creados: 0, actualizados: 0, sinCambios: 0, codigosGenerados: 0, ajustesStock: 0 },
  };

  const tabla = parsearCSV(texto);
  if (tabla.length < 2) {
    plan.errores.push({ linea: 1, mensaje: 'El archivo está vacío o solo trae encabezados.' });
    return plan;
  }

  // Encabezados -> índice de columna canónica
  const columna: Record<string, number> = {};
  tabla[0].forEach((encabezado, i) => {
    const canonica = ALIAS_COLUMNAS[normalizarClave(encabezado)];
    if (canonica && !(canonica in columna)) columna[canonica] = i;
  });

  if (!('codigo_barras' in columna) && !('nombre' in columna)) {
    plan.errores.push({
      linea: 1,
      mensaje: 'Faltan columnas: se necesita al menos "codigo_barras" o "nombre". Descarga la plantilla para ver el formato.',
    });
    return plan;
  }

  const celda = (fila: string[], clave: string): string => (clave in columna ? (fila[columna[clave]] ?? '').trim() : '');

  const porCodigo = new Map(existentes.map((p) => [p.codigo_barras, p]));
  const porNombre = new Map(existentes.map((p) => [p.nombre.trim().toLowerCase(), p]));

  const modeloPorClave = new Map<string, ModeloTelefono>();
  for (const m of modelos) {
    modeloPorClave.set(normalizarClave(`${m.marca} ${m.modelo}`), m);
    const soloModelo = normalizarClave(m.modelo);
    if (!modeloPorClave.has(soloModelo)) modeloPorClave.set(soloModelo, m);
  }

  const codigosVistos = new Set<string>();
  const nombresVistos = new Set<string>();
  const sinCodigo: FilaImportacion[] = [];

  for (let i = 1; i < tabla.length; i++) {
    const fila = tabla[i];
    const linea = i + 1;
    plan.resumen.leidas++;

    const err = (mensaje: string) => plan.errores.push({ linea, mensaje });

    const codigo = celda(fila, 'codigo_barras');
    const nombre = celda(fila, 'nombre');

    if (/e\+/i.test(codigo)) {
      err(`El código "${codigo}" está en notación científica. En Excel formatea la columna como Texto antes de guardar.`);
      continue;
    }
    if (!codigo && !nombre) {
      err('La fila no tiene código de barras ni nombre.');
      continue;
    }
    if (codigo && codigosVistos.has(codigo)) {
      err(`El código ${codigo} está repetido en el archivo.`);
      continue;
    }

    // Si trae código se busca por código; si no, por nombre exacto (así reimportar
    // una lista sin códigos actualiza en vez de duplicar).
    let existente: ProductoConRelaciones | undefined;
    if (codigo) existente = porCodigo.get(codigo);
    else if (nombre) existente = porNombre.get(nombre.toLowerCase());

    if (!existente && nombresVistos.has(nombre.toLowerCase()) && !codigo) {
      err(`El producto "${nombre}" está repetido en el archivo.`);
      continue;
    }
    if (codigo) codigosVistos.add(codigo);
    if (nombre) nombresVistos.add(nombre.toLowerCase());

    // Números
    const errores: string[] = [];
    const pv = parsearNumero(celda(fila, 'precio_venta'));
    if (pv !== null && (Number.isNaN(pv) || pv < 0)) errores.push(`precio_venta inválido ("${celda(fila, 'precio_venta')}")`);
    const pc = parsearNumero(celda(fila, 'precio_compra'));
    if (pc !== null && (Number.isNaN(pc) || pc < 0)) errores.push(`precio_compra inválido ("${celda(fila, 'precio_compra')}")`);
    const stock = entero(celda(fila, 'stock_actual'), 'stock_actual');
    if (stock.error) errores.push(stock.error);
    const minimo = entero(celda(fila, 'stock_minimo'), 'stock_minimo');
    if (minimo.error) errores.push(minimo.error);
    if (errores.length) {
      err(errores.join('; '));
      continue;
    }

    // Compatibilidades
    let modeloIds: string[] | null = null;
    const textoModelos = celda(fila, 'compatible_con');
    if (textoModelos) {
      modeloIds = [];
      for (const token of textoModelos.split(/[|;]/).map((t) => t.trim()).filter(Boolean)) {
        const m = modeloPorClave.get(normalizarClave(token));
        if (m) modeloIds.push(m.id);
        else plan.advertencias.push({ linea, mensaje: `Modelo no encontrado en el catálogo: "${token}"` });
      }
      modeloIds = [...new Set(modeloIds)];
    }

    const base = {
      linea,
      nombre: nombre || existente?.nombre || '',
      precio_compra: pc,
      stock_minimo: minimo.n,
      stock_objetivo: stock.n,
      modeloIds,
    };

    if (!existente) {
      const categoria = celda(fila, 'categoria');
      if (!nombre) {
        err(`El código ${codigo} no existe en el inventario y la fila no trae nombre para crearlo.`);
        continue;
      }
      if (!categoria) {
        err(`"${nombre}": falta la categoría (es obligatoria para productos nuevos).`);
        continue;
      }
      if (pv === null) {
        err(`"${nombre}": falta el precio_venta (es obligatorio para productos nuevos).`);
        continue;
      }

      const nueva: FilaImportacion = {
        ...base,
        nombre,
        accion: 'crear',
        codigo_barras: codigo,
        codigoGenerado: !codigo,
        categoria,
        precio_venta: pv,
        cambios: [],
      };
      if (!codigo) sinCodigo.push(nueva);
      plan.filas.push(nueva);
      plan.resumen.creados++;
      continue;
    }

    // Actualización: solo se listan los campos que realmente cambian
    const cambios: string[] = [];
    const categoria = celda(fila, 'categoria');
    if (nombre && nombre !== existente.nombre) cambios.push(`nombre → ${nombre}`);
    if (categoria && categoria !== existente.categoria) cambios.push(`categoría → ${categoria}`);
    if (pv !== null && pv !== existente.precio_venta) cambios.push(`precio venta ${existente.precio_venta} → ${pv}`);
    if (pc !== null && pc !== existente.precio_compra) cambios.push(`precio compra ${existente.precio_compra} → ${pc}`);
    if (minimo.n !== null && minimo.n !== existente.stock_minimo) cambios.push(`mínimo ${existente.stock_minimo} → ${minimo.n}`);
    if (stock.n !== null && stock.n !== existente.stock_actual) {
      cambios.push(`stock ${existente.stock_actual} → ${stock.n}`);
      plan.resumen.ajustesStock++;
    }
    if (modeloIds !== null) {
      const actuales = new Set(existente.modelos_compatibles.map((m) => m.id));
      const igual = modeloIds.length === actuales.size && modeloIds.every((id) => actuales.has(id));
      if (!igual) cambios.push(`compatibilidades (${modeloIds.length})`);
    }

    if (cambios.length === 0) {
      plan.resumen.sinCambios++;
      continue;
    }

    plan.filas.push({
      ...base,
      accion: 'actualizar',
      productoId: existente.id,
      codigo_barras: existente.codigo_barras,
      codigoGenerado: false,
      nombre: nombre || existente.nombre,
      categoria: categoria || existente.categoria,
      precio_venta: pv ?? existente.precio_venta,
      cambios,
    });
    plan.resumen.actualizados++;
  }

  // Códigos internos para los productos nuevos sin código, a continuación del mayor existente
  if (sinCodigo.length > 0) {
    const usados = [...existentes.map((p) => p.codigo_barras), ...plan.filas.map((f) => f.codigo_barras).filter(Boolean)];
    const nuevos = generarCodigosInternos(usados, sinCodigo.length);
    sinCodigo.forEach((f, i) => (f.codigo_barras = nuevos[i]));
    plan.resumen.codigosGenerados = sinCodigo.length;
  }

  return plan;
}
