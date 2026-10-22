// Código QR en SVG para las etiquetas (lo lee la cámara de cualquier teléfono y los lectores 2D).
// El contenido es el MISMO código del producto que llevan las barras, así que el escáner de la aplicación,
// el de otras apps y los lectores tipo teclado entregan exactamente el mismo valor.
import qrcode from 'qrcode-generator';

/** Margen blanco (en módulos) que exige la norma alrededor del QR para poder leerse. */
const ZONA_SILENCIO = 2;

/**
 * SVG cuadrado del QR de `texto`, o null si no se puede generar (vacío o demasiado largo).
 * Nivel de corrección "M" (~15 %): aguanta etiquetas con un poco de roce o suciedad sin agrandar el código.
 */
export function svgQr(texto: string): string | null {
  const contenido = texto.trim();
  if (!contenido) return null;

  let qr: ReturnType<typeof qrcode>;
  try {
    qr = qrcode(0, 'M'); // versión automática
    qr.addData(contenido, 'Byte');
    qr.make();
  } catch {
    return null; // más datos de los que caben en la versión máxima
  }

  const modulos = qr.getModuleCount();
  const lado = modulos + ZONA_SILENCIO * 2;
  // Una sola trazada: un rectángulo por cada tramo seguido de módulos oscuros en la fila
  let trazo = '';
  for (let fila = 0; fila < modulos; fila++) {
    let inicio = -1;
    for (let col = 0; col <= modulos; col++) {
      const oscuro = col < modulos && qr.isDark(fila, col);
      if (oscuro && inicio < 0) inicio = col;
      if (!oscuro && inicio >= 0) {
        trazo += `M${inicio + ZONA_SILENCIO} ${fila + ZONA_SILENCIO}h${col - inicio}v1h-${col - inicio}z`;
        inicio = -1;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" shape-rendering="crispEdges" role="img" aria-label="Código QR ${contenido.replace(/"/g, '')}"><rect width="${lado}" height="${lado}" fill="#fff"/><path d="${trazo}" fill="#000"/></svg>`;
}
