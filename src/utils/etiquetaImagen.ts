// Etiquetas como IMAGEN (PNG) para mandarlas a una impresora Bluetooth desde el celular.
//
// Un iPhone no deja que una página web hable directamente con una impresora Bluetooth (Safari no tiene Web Bluetooth), así
// que el camino que funciona es: el sistema dibuja cada etiqueta como imagen del tamaño exacto del rollo y la entrega a la
// app de la impresora (WePrint, etc.) con el menú "Compartir" del teléfono. La app hace la conexión Bluetooth y la impresión.
import { buscarTipoCodigo, type EtiquetaPedida, type FormatoEtiqueta, type TipoCodigoEtiqueta } from './etiquetas';
import { svgCodigoBarras } from './codigoBarras';
import { svgQr } from './qr';

/** Puntos por pulgada de la imagen: 300 sobra para el cabezal de las térmicas de 203 y de 300 dpi (la app la reduce). */
export const DPI_IMAGEN = 300;
/** Máximo de etiquetas que se entregan juntas en un "Compartir" (el menú del teléfono se vuelve pesado con muchas). */
export const MAX_ETIQUETAS_POR_ENVIO = 20;

const MM_POR_PULGADA = 25.4;
const pixeles = (mm: number) => Math.round((mm / MM_POR_PULGADA) * DPI_IMAGEN);

function escapar(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Parte un texto en renglones de a lo más `maxCaracteres` (por palabras) y como máximo `maxLineas`; lo que sobre se corta con "…". */
export function partirEnLineas(texto: string, maxCaracteres: number, maxLineas: number): string[] {
  const palabras = texto.trim().split(/\s+/).filter(Boolean);
  const lineas: string[] = [];
  let actual = '';
  for (const palabra of palabras) {
    const candidata = actual ? `${actual} ${palabra}` : palabra;
    if (candidata.length <= maxCaracteres) {
      actual = candidata;
      continue;
    }
    if (actual) lineas.push(actual);
    actual = palabra.length > maxCaracteres ? palabra.slice(0, maxCaracteres) : palabra;
  }
  if (actual) lineas.push(actual);
  if (lineas.length <= maxLineas) return lineas;
  const recortadas = lineas.slice(0, maxLineas);
  const ultima = recortadas[maxLineas - 1];
  recortadas[maxLineas - 1] = `${ultima.slice(0, Math.max(1, maxCaracteres - 1))}…`;
  return recortadas;
}

/**
 * SVG de UNA etiqueta (fondo blanco, tamaño exacto del formato a `DPI_IMAGEN`). Con QR: el código a la izquierda y el nombre
 * y el número a su lado; con barras: barras arriba, número y nombre abajo. Si no se puede dibujar el código, deja un aviso.
 */
export function svgEtiqueta(e: Pick<EtiquetaPedida, 'codigo' | 'nombre'>, formato: FormatoEtiqueta, tipo: TipoCodigoEtiqueta = 'qr'): string {
  const W = pixeles(formato.anchoMm);
  const H = pixeles(formato.altoMm);
  const margen = pixeles(1.6);
  const pt = (puntos: number) => Math.round((puntos / 72) * DPI_IMAGEN);
  const tamNombre = pt(formato.nombrePt);
  const tamNumero = pt(formato.numeroPt);
  const fuente = "font-family=\"Arial, Helvetica, sans-serif\"";
  const contenido: string[] = [];

  const qr = buscarTipoCodigo(tipo) === 'qr' ? svgQr(e.codigo) : null;
  if (qr) {
    const lado = Math.min(pixeles(formato.qrMm), H - margen * 2);
    const y = Math.round((H - lado) / 2);
    contenido.push(qr.replace('<svg ', `<svg x="${margen}" y="${y}" width="${lado}" height="${lado}" `));
    const x = margen + lado + pixeles(2);
    const ancho = W - x - margen;
    const caracteres = Math.max(6, Math.floor(ancho / (tamNombre * 0.56)));
    const lineas = partirEnLineas(e.nombre, caracteres, 3);
    const altoTexto = lineas.length * tamNombre * 1.15 + tamNumero * 1.4;
    let ty = Math.round((H - altoTexto) / 2 + tamNombre);
    for (const linea of lineas) {
      contenido.push(`<text x="${x}" y="${ty}" font-size="${tamNombre}" font-weight="700" ${fuente}>${escapar(linea)}</text>`);
      ty += Math.round(tamNombre * 1.15);
    }
    const numeroEnLinea = Math.floor(ancho / (tamNumero * 0.62)) >= e.codigo.length;
    contenido.push(
      `<text x="${x}" y="${ty + Math.round(tamNumero * 0.4)}" font-size="${tamNumero}" font-family="'Courier New', monospace" ${numeroEnLinea ? '' : `textLength="${ancho}" lengthAdjust="spacingAndGlyphs"`}>${escapar(e.codigo)}</text>`
    );
  } else {
    const barras = svgCodigoBarras(e.codigo, 40);
    if (barras) {
      const alto = pixeles(formato.barrasMm);
      contenido.push(barras.replace('<svg ', `<svg x="${margen}" y="${margen}" width="${W - margen * 2}" height="${alto}" `));
      contenido.push(`<text x="${W / 2}" y="${margen + alto + tamNumero * 1.2}" font-size="${tamNumero}" text-anchor="middle" font-family="'Courier New', monospace">${escapar(e.codigo)}</text>`);
      const caracteres = Math.max(8, Math.floor((W - margen * 2) / (tamNombre * 0.56)));
      const lineas = partirEnLineas(e.nombre, caracteres, 2);
      let ty = Math.round(margen + alto + tamNumero * 1.2 + tamNombre * 1.25);
      for (const linea of lineas) {
        contenido.push(`<text x="${W / 2}" y="${ty}" font-size="${tamNombre}" font-weight="700" text-anchor="middle" ${fuente}>${escapar(linea)}</text>`);
        ty += Math.round(tamNombre * 1.15);
      }
    } else {
      contenido.push(`<text x="${margen}" y="${H / 2}" font-size="${tamNombre}" font-weight="700" ${fuente}>Código no imprimible: ${escapar(e.codigo)}</text>`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>${contenido.join('')}</svg>`;
}

/** Nombre de archivo de la imagen: el código es único por unidad. */
export function nombreArchivoEtiqueta(codigo: string): string {
  return `etiqueta-${codigo.replace(/[^A-Za-z0-9_-]/g, '')}.png`;
}

/** Dibuja la etiqueta en un canvas y la devuelve como PNG (solo en el navegador). */
export async function etiquetaComoPng(e: Pick<EtiquetaPedida, 'codigo' | 'nombre'>, formato: FormatoEtiqueta, tipo: TipoCodigoEtiqueta = 'qr'): Promise<Blob> {
  const svg = svgEtiqueta(e, formato, tipo);
  const imagen = new Image();
  imagen.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await imagen.decode();
  const canvas = document.createElement('canvas');
  canvas.width = pixeles(formato.anchoMm);
  canvas.height = pixeles(formato.altoMm);
  const contexto = canvas.getContext('2d');
  if (!contexto) throw new Error('El navegador no pudo preparar la imagen de la etiqueta.');
  contexto.fillStyle = '#fff';
  contexto.fillRect(0, 0, canvas.width, canvas.height);
  contexto.drawImage(imagen, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolver) => canvas.toBlob(resolver, 'image/png'));
  if (!blob) throw new Error('No se pudo crear la imagen de la etiqueta.');
  return blob;
}

/** Una imagen PNG (archivo) por etiqueta, hasta MAX_ETIQUETAS_POR_ENVIO. */
export async function prepararArchivosEtiquetas(
  etiquetas: Pick<EtiquetaPedida, 'codigo' | 'nombre'>[],
  formato: FormatoEtiqueta,
  tipo: TipoCodigoEtiqueta = 'qr'
): Promise<File[]> {
  return Promise.all(
    etiquetas.slice(0, MAX_ETIQUETAS_POR_ENVIO).map(async (e) => new File([await etiquetaComoPng(e, formato, tipo)], nombreArchivoEtiqueta(e.codigo), { type: 'image/png' }))
  );
}

/** ¿Este navegador puede abrir el menú "Compartir" con archivos? (iPhone y Android sí; una computadora normalmente no.) */
export function puedeCompartirArchivos(archivos: File[]): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files: archivos });
}

/** Abre el menú Compartir con las imágenes. Devuelve false si el usuario lo cerró sin elegir nada. Debe llamarse desde un toque del usuario. */
export async function compartirArchivos(archivos: File[]): Promise<boolean> {
  try {
    await navigator.share({ files: archivos, title: 'Etiquetas EASYSTEM' });
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return false;
    throw err;
  }
}

/** Descarga las imágenes (en el iPhone quedan en la app Archivos, de donde WePrint las puede abrir). */
export function descargarArchivos(archivos: File[]): void {
  for (const archivo of archivos) {
    const url = URL.createObjectURL(archivo);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = archivo.name;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
