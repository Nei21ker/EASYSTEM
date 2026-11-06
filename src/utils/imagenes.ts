// Utilidades de imágenes de producto: reducción en el navegador antes de
// guardar (una foto de teléfono pesa varios MB; para una miniatura de
// inventario bastan ~50 KB) y renderizado seguro de miniaturas.

const LADO_MAXIMO = 720;
const CALIDAD = 0.82;
const BYTES_MAXIMOS_ORIGINAL = 15 * 1024 * 1024;

/**
 * Reduce una imagen a JPEG (por defecto de máx. 720 px por lado, suficiente para una miniatura). Para capturas de
 * pantalla con texto se pide `ladoMaximo: 1280`. Lanza un Error con mensaje para el usuario.
 */
export async function reducirImagen(
  archivo: File,
  opciones: { ladoMaximo?: number; /** WebP pesa ~30 % menos que JPEG; si el navegador no lo sabe crear, sale JPEG */ preferirWebp?: boolean; calidad?: number } = {}
): Promise<Blob> {
  const ladoMaximo = opciones.ladoMaximo ?? LADO_MAXIMO;
  if (!pareceImagen(archivo)) {
    throw new Error('Ese archivo no es una imagen. Usa una foto JPG, PNG o WebP.');
  }
  if (archivo.size > BYTES_MAXIMOS_ORIGINAL) {
    throw new Error('La imagen es demasiado grande (máximo 15 MB).');
  }

  const origen = await decodificar(archivo);
  const escala = Math.min(1, ladoMaximo / Math.max(origen.ancho, origen.alto));
  const ancho = Math.max(1, Math.round(origen.ancho * escala));
  const alto = Math.max(1, Math.round(origen.alto * escala));

  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  try {
    const ctx = lienzo.getContext('2d');
    if (!ctx) throw new Error('Tu navegador no pudo procesar la imagen.');

    // Fondo blanco: los PNG con transparencia no deben quedar negros al pasar a JPEG
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ancho, alto);
    ctx.drawImage(origen.fuente, 0, 0, ancho, alto);
    origen.liberar();

    const calidad = opciones.calidad ?? CALIDAD;
    let blob: Blob | null = null;
    if (opciones.preferirWebp) {
      blob = await new Promise<Blob | null>((resolve) => lienzo.toBlob(resolve, 'image/webp', calidad));
      if (blob && blob.type !== 'image/webp') blob = null; // el navegador no sabe crear WebP y devolvió otro formato
    }
    blob ??= await new Promise<Blob | null>((resolve) => lienzo.toBlob(resolve, 'image/jpeg', calidad));
    if (!blob) throw new Error('No se pudo comprimir la imagen.');
    return blob;
  } finally {
    origen.liberar();
    // Safari de iPhone no suelta la memoria de los lienzos por sí solo: tras varias fotos seguidas dejaba de procesarlas
    lienzo.width = 0;
    lienzo.height = 0;
  }
}

/**
 * ¿El archivo elegido puede ser una imagen? Los teléfonos Android a veces entregan la foto SIN tipo ("") o como
 * "application/octet-stream" (según la app desde la que se elige), y rechazarla por eso hacía que "no funcionara nunca". Solo se
 * descarta lo que declara ser otra cosa (PDF, texto…); el decodificador del navegador decide si de verdad se puede leer.
 */
export function pareceImagen(archivo: Pick<File, 'type'>): boolean {
  const tipo = (archivo.type || '').toLowerCase();
  return tipo === '' || tipo === 'application/octet-stream' || tipo.startsWith('image/');
}

interface ImagenDecodificada {
  fuente: CanvasImageSource;
  ancho: number;
  alto: number;
  liberar: () => void;
}

/** Decodifica la imagen: primero con createImageBitmap y, si el navegador no puede, con un <img> (cubre navegadores y formatos más viejos). */
async function decodificar(archivo: File): Promise<ImagenDecodificada> {
  try {
    const bitmap = await createImageBitmap(archivo);
    return { fuente: bitmap, ancho: bitmap.width, alto: bitmap.height, liberar: () => bitmap.close() };
  } catch {
    // se intenta con un <img>
  }
  const url = URL.createObjectURL(archivo);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('decodificación fallida'));
      img.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('imagen vacía');
    return { fuente: img, ancho: img.naturalWidth, alto: img.naturalHeight, liberar: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('No se pudo leer la imagen. Prueba con otra foto (JPG, PNG o WebP).');
  }
}

/** Lado mayor de la miniatura de las listas (se muestra a 40–48 px; con margen para pantallas de alta densidad). */
export const LADO_MINIATURA = 192;

/** La miniatura de una foto ya reducida: unos 190 px y calidad menor, del MISMO tipo (el servidor lo exige). Pesa unos pocos KB. */
export function crearMiniatura(foto: Blob): Promise<Blob> {
  return reducirImagen(new File([foto], 'foto', { type: foto.type }), { ladoMaximo: LADO_MINIATURA, calidad: 0.7, preferirWebp: foto.type === 'image/webp' });
}

const RUTA_FOTO_SERVIDOR = /^(\/api\/archivos\/publico\/productos\/[A-Za-z0-9-]{1,64}\/\d{10,16})(\.(?:jpg|png|webp))$/;

/** La dirección de la miniatura de una foto subida al servidor; null si no es una (data:, otro sitio, ilustración o ya una miniatura). */
export function urlMiniatura(url: string | null | undefined): string | null {
  const partes = url ? RUTA_FOTO_SERVIDOR.exec(url) : null;
  return partes ? `${partes[1]}-m${partes[2]}` : null;
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
 * ícono. La foto se puede ampliar al tocarla (VisorImagen.astro, global en DashboardLayout). `clases` define el tamaño (p. ej. "h-10 w-10").
 */
export function htmlMiniatura(url: string | null | undefined, alt: string, clases = 'h-10 w-10'): string {
  const base = `${clases} shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800`;
  if (url && urlSegura(url)) {
    const seguraAlt = alt.replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const original = url.replace(/"/g, '&quot;');
    const miniatura = urlMiniatura(url);
    // Las listas piden la miniatura (unos KB); si no existe (foto anterior a las miniaturas) caen a la foto grande, y al ampliar se ve la grande
    const adicional = miniatura ? ` data-grande="${original}" onerror="this.onerror=null;this.src='${original}'"` : '';
    return `<img src="${miniatura ?? original}" alt="${seguraAlt}" width="48" height="48" loading="lazy" decoding="async" class="${base} cursor-zoom-in object-cover" data-ampliable${adicional} />`;
  }
  return `<span class="${base} flex items-center justify-center text-slate-400 dark:text-slate-500" aria-hidden="true">${ICONO_CAJA}</span>`;
}
