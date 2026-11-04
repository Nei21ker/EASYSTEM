// Reimprimir etiquetas: qué unidades se ofrecen y cómo se agrupan. Una etiqueta se reimprime cuando se despegó, se perdió o salió mal;
// el código de la unidad no cambia. Solo se ofrecen unidades DISPONIBLES: una vendida ya no está en el local y su etiqueta no debe
// pegarse en otra pieza (se perdería la trazabilidad de la garantía).
import type { UnidadProducto } from '../types/database.types';

export interface ProductoParaReimprimir {
  id: string;
  nombre: string;
  codigo_barras: string;
}

export interface GrupoReimpresion {
  producto: ProductoParaReimprimir;
  unidades: UnidadProducto[];
}

const normalizar = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Las unidades disponibles agrupadas por producto (productos por nombre, unidades de la más antigua a la más nueva).
 * `texto` filtra por nombre del producto, por su código de barras o por el código de una unidad; `soloProductoId` limita a un producto.
 */
export function agruparUnidadesParaReimprimir(
  unidades: UnidadProducto[],
  productos: ProductoParaReimprimir[],
  texto: string,
  soloProductoId?: string
): GrupoReimpresion[] {
  const consulta = normalizar(texto);
  const porId = new Map(productos.map((p) => [p.id, p]));
  const grupos = new Map<string, GrupoReimpresion>();

  for (const unidad of unidades) {
    if (unidad.estado !== 'DISPONIBLE') continue;
    if (soloProductoId && unidad.producto_id !== soloProductoId) continue;
    const producto = porId.get(unidad.producto_id);
    if (!producto) continue;

    if (consulta) {
      const porUnidad = unidad.codigo === consulta;
      const nombre = normalizar(producto.nombre);
      // Todas las palabras escritas deben estar en el nombre, en cualquier orden ("honor tipo" encuentra "Cargador Honor sencillo Tipo C")
      const porProducto = consulta.split(/\s+/).every((palabra) => nombre.includes(palabra)) || producto.codigo_barras === consulta;
      // Si lo escrito es el código de una unidad, solo esa unidad; si no, todas las del producto que coincide
      const esCodigoDeUnidad = unidades.some((u) => u.codigo === consulta);
      if (esCodigoDeUnidad ? !porUnidad : !porProducto) continue;
    }

    const grupo = grupos.get(producto.id) ?? { producto, unidades: [] };
    grupo.unidades.push(unidad);
    grupos.set(producto.id, grupo);
  }

  for (const grupo of grupos.values()) grupo.unidades.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.codigo.localeCompare(b.codigo));
  return [...grupos.values()].sort((a, b) => a.producto.nombre.localeCompare(b.producto.nombre, 'es'));
}

/** "Nunca reimpresa", "Reimpresa 1 vez", "Reimpresa 3 veces". */
export function resumenReimpresion(unidad: Pick<UnidadProducto, 'reimpresiones'>): string {
  const n = unidad.reimpresiones ?? 0;
  if (n === 0) return 'Nunca reimpresa';
  return `Reimpresa ${n} ${n === 1 ? 'vez' : 'veces'}`;
}
