// Utilidades de imágenes de producto: reducción en el navegador antes de
// guardar (una foto de teléfono pesa varios MB; para una miniatura de
// inventario bastan ~50 KB) y renderizado seguro de miniaturas.

const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];
const LADO_MAXIMO = 720;
const CALIDAD = 0.82;
const BYTES_MAXIMOS_ORIGINAL = 15 * 1024 * 1024;

/**
 * Reduce una imagen a JPEG (por defecto de máx. 720 px por lado, suficiente para una miniatura). Para capturas de
 * pantalla con texto se pide `ladoMaximo: 1280`. Lanza un Error con mensaje para el usuario.
 */
export async function reducirImagen(archivo: File, opciones: { ladoMaximo?: number } = {}): Promise<Blob> {
  const ladoMaximo = opciones.ladoMaximo ?? LADO_MAXIMO;
  if (!TIPOS_PERMITIDOS.includes(archivo.type)) {
    throw new Error('Formato no admitido. Usa una foto JPG, PNG o WebP.');
  }
  if (archivo.size > BYTES_MAXIMOS_ORIGINAL) {
    throw new Error('La imagen es demasiado grande (máximo 15 MB).');
  }

  const bitmap = await createImageBitmap(archivo).catch(() => {
    throw new Error('No se pudo leer la imagen. Prueba con otra foto.');
  });

  const escala = Math.min(1, ladoMaximo / Math.max(bitmap.width, bitmap.height));
  const ancho = Math.max(1, Math.round(bitmap.width * escala));
  const alto = Math.max(1, Math.round(bitmap.height * escala));

  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext('2d');
  if (!ctx) throw new Error('Tu navegador no pudo procesar la imagen.');

  // Fondo blanco: los PNG con transparencia no deben quedar negros al pasar a JPEG
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ancho, alto);
  ctx.drawImage(bitmap, 0, 0, ancho, alto);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => lienzo.toBlob(resolve, 'image/jpeg', CALIDAD));
  if (!blob) throw new Error('No se pudo comprimir la imagen.');
  return blob;
}

export function blobADataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result));
    lector.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    lector.readAsDataURL(blob);
  });
}

/** Solo se aceptan imágenes data:, http(s):// o rutas del propio sitio (nunca javascript:). */
function urlSegura(url: string): boolean {
  return /^(data:image\/(jpeg|png|webp);base64,|https?:\/\/|\/)/i.test(url);
}

const ICONO_CAJA =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="h-1/2 w-1/2"><path d="M20 7 12 3 4 7m16 0-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * HTML de la miniatura de un producto: la foto si existe, o un recuadro con un
 * ícono. `clases` define el tamaño (p. ej. "h-10 w-10").
 */
export function htmlMiniatura(url: string | null | undefined, alt: string, clases = 'h-10 w-10'): string {
  const base = `${clases} shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800`;
  if (url && urlSegura(url)) {
    const seguraAlt = alt.replace(/"/g, '&quot;').replace(/</g, '&lt;');
    return `<img src="${url.replace(/"/g, '&quot;')}" alt="${seguraAlt}" loading="lazy" decoding="async" class="${base} object-cover" />`;
  }
  return `<span class="${base} flex items-center justify-center text-slate-400 dark:text-slate-500" aria-hidden="true">${ICONO_CAJA}</span>`;
}
