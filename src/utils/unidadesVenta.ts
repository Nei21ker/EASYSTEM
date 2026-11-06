// Qué decirle a quien vende cuando el QR/código que leyó NO se puede vender. Función pura: la usa el POS para mostrar una alerta
// grande (el aviso pequeño de al lado del carrito quedaba fuera de la pantalla en el teléfono y "no avisaba nada").

import type { UnidadProducto } from '../types/database.types';

export interface AlertaUnidad {
  /** Frase corta y clara, para el título de la alerta */
  titulo: string;
  /** Explicación y qué hacer */
  detalle: string;
}

function fechaCorta(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return null;
  return fecha.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Null si la unidad se puede vender (DISPONIBLE y del local activo); si no, la alerta que se le muestra a quien la leyó.
 * `unidad` null = el código no existe (o es de un local al que no se tiene acceso).
 */
export function alertaUnidadNoVendible(unidad: UnidadProducto | null, codigo: string, localActivoId: string): AlertaUnidad | null {
  if (!unidad) {
    return {
      titulo: 'Ese QR no existe',
      detalle: `El código ${codigo} no corresponde a ninguna pieza registrada en el sistema. Si la etiqueta es de otro lugar o está dañada, busca el producto por nombre.`,
    };
  }
  if (localActivoId && unidad.local_id !== localActivoId) {
    return {
      titulo: 'Esa pieza es de otro local',
      detalle: `La pieza ${codigo} pertenece a otro local: no se puede vender desde este.`,
    };
  }
  switch (unidad.estado) {
    case 'DISPONIBLE':
      return null;
    case 'VENDIDA': {
      const cuando = fechaCorta(unidad.vendida_en);
      return {
        titulo: 'Este producto ya se vendió',
        detalle: `La pieza ${codigo} ya fue vendida${cuando ? ` el ${cuando}` : ''}, así que ese QR ya no está disponible. Revisa que no sea una etiqueta repetida o de una pieza anterior.`,
      };
    }
    case 'EN_TRANSITO':
      return {
        titulo: 'Esa pieza va en camino a otro local',
        detalle: `La pieza ${codigo} salió en un traslado y todavía no se recibe: no se puede vender.`,
      };
    case 'BAJA':
      return {
        titulo: 'Esa pieza está dada de baja',
        detalle: `La pieza ${codigo} salió del inventario por una baja (dañada, usada o garantía): no se puede vender.`,
      };
    default:
      return { titulo: 'Esa pieza no está disponible', detalle: `La pieza ${codigo} no está disponible para la venta.` };
  }
}
