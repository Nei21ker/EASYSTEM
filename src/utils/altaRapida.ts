// Alta rápida de productos: en vez de llenar un formulario por producto (lento en el teléfono), se escribe UN PRODUCTO POR LÍNEA y la
// categoría, el prefijo, el precio y la cantidad se ponen una sola vez para todos. Cada línea puede terminar, opcionalmente, con
//   xN   la cantidad que ingresa de ese producto      ("Control A/C Samsung x5")
//   $P   su precio de venta, si no es el de por defecto  ("Control Roku $12" o "$12,50")
// Todo esto es puro (sin pantalla): la ventana solo muestra lo que devuelve.

export const MAX_LINEAS_ALTA = 100;
export const MAX_NOMBRE_ALTA = 120;
const MIN_NOMBRE_ALTA = 3;
const MAX_CANTIDAD_ALTA = 999;

export interface DefectosAlta {
  /** Unidades que ingresan por producto cuando la línea no trae "xN" */
  cantidad: number;
  /** Precio de venta cuando la línea no trae "$P" (null = no se escribió: cada línea debe traer el suyo) */
  precio: number | null;
}

export interface LineaAlta {
  /** Número de renglón en lo que se escribió (para los avisos) */
  linea: number;
  nombre: string;
  cantidad: number;
  precio: number | null;
  /** Por qué no se puede crear esta línea (null = lista) */
  error: string | null;
}

/** Para comparar nombres: sin mayúsculas, sin acentos y con los espacios simplificados. */
export function normalizarNombre(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Un precio escrito a la venezolana o a la gringa ("12,50" / "12.50" / "12"), o null si no es un monto válido. */
export function leerPrecio(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  const valor = Number(limpio);
  return Number.isFinite(valor) && valor <= 100000 ? valor : null;
}

// Lo que puede venir al FINAL de la línea, separado por espacio: x5 / ×5 / *5 (cantidad) o $8 / $8,50 (precio)
const FINAL_CANTIDAD = /\s+[x×*]\s*(\d{1,4})$/i;
const FINAL_PRECIO = /\s+\$\s*(\d+(?:[.,]\d{1,2})?)$/;

/**
 * Lee lo escrito y devuelve una fila por producto. Las líneas vacías se ignoran; si el mismo nombre aparece dos veces se junta en una
 * sola (las cantidades se suman), así que escribir dos veces lo mismo no crea un duplicado.
 */
export function parsearAltaRapida(texto: string, defectos: DefectosAlta): LineaAlta[] {
  const resultado: LineaAlta[] = [];
  const porNombre = new Map<string, LineaAlta>();

  texto.split(/\r?\n/).forEach((crudo, indice) => {
    let resto = crudo.trim().replace(/\s+/g, ' ');
    if (!resto) return;

    let cantidad: number | null = null;
    let precio: number | null = null;
    // Se leen de atrás hacia adelante, en cualquier orden ("x3 $8" o "$8 x3")
    for (let vuelta = 0; vuelta < 2; vuelta++) {
      const c: RegExpExecArray | null = cantidad === null ? FINAL_CANTIDAD.exec(resto) : null;
      if (c) {
        cantidad = Number(c[1]);
        resto = resto.slice(0, c.index).trimEnd();
        continue;
      }
      const p: RegExpExecArray | null = precio === null ? FINAL_PRECIO.exec(resto) : null;
      if (p) {
        precio = leerPrecio(p[1]);
        resto = resto.slice(0, p.index).trimEnd();
        continue;
      }
      break;
    }

    const nombre = resto;
    const linea: LineaAlta = { linea: indice + 1, nombre, cantidad: cantidad ?? defectos.cantidad, precio: precio ?? defectos.precio, error: null };

    if (nombre.length < MIN_NOMBRE_ALTA) linea.error = 'El nombre es muy corto.';
    else if (nombre.length > MAX_NOMBRE_ALTA) linea.error = `El nombre pasa de ${MAX_NOMBRE_ALTA} letras.`;
    else if (!/[\p{L}]/u.test(nombre)) linea.error = 'El nombre debe tener letras.';
    else if (!Number.isInteger(linea.cantidad) || linea.cantidad < 0 || linea.cantidad > MAX_CANTIDAD_ALTA) linea.error = `La cantidad debe estar entre 0 y ${MAX_CANTIDAD_ALTA}.`;
    else if (linea.precio === null || !(linea.precio >= 0)) linea.error = 'Falta el precio: ponlo arriba para todos o al final de la línea ($8).';

    const clave = normalizarNombre(nombre);
    const anterior = porNombre.get(clave);
    if (anterior && !anterior.error && !linea.error) {
      anterior.cantidad = Math.min(MAX_CANTIDAD_ALTA, anterior.cantidad + linea.cantidad);
      return;
    }
    if (!anterior) porNombre.set(clave, linea);
    resultado.push(linea);
  });

  return resultado;
}

/** ¿Se puede crear todo? Devuelve el primer problema (para mostrarlo junto al botón) o null. */
export function problemaDeAlta(lineas: LineaAlta[]): string | null {
  if (lineas.length === 0) return 'Escribe al menos un producto.';
  if (lineas.length > MAX_LINEAS_ALTA) return `Son demasiados productos de una vez (máximo ${MAX_LINEAS_ALTA}): crea el resto en otra tanda.`;
  const mala = lineas.find((l) => l.error);
  return mala ? `Línea ${mala.linea}: ${mala.error}` : null;
}
