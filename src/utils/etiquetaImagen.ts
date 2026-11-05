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
 * La letra más grande (entre `tamMin` y `tamMax`, en píxeles) con la que el nombre cabe en `anchoPx` × `altoPx`, y sus renglones.
 * Prefiere achicar la letra antes que cortar el nombre; solo si ni con la letra mínima cabe, lo corta con "…".
 */
/**
 * Reparte las palabras en a lo más `maxLineas` renglones de a lo más `ancho` caracteres, lo más parejos posible (minimiza la suma
 * de los cuadrados de lo que le falta a cada renglón para llegar a `ancho`: evita una palabra suelta sola en el último). null si no cabe.
 */
function repartirParejo(palabras: string[], ancho: number, maxLineas: number): string[] | null {
  const n = palabras.length;
  if (palabras.some((p) => p.length > ancho)) return null;
  const largo = (i: number, j: number) => palabras.slice(i, j).join(' ').length; // palabras i..j-1
  // mejor[j][k]: costo mínimo de repartir las primeras j palabras en exactamente k renglones
  const mejor: number[][] = Array.from({ length: n + 1 }, () => Array(maxLineas + 1).fill(Infinity));
  const desde: number[][] = Array.from({ length: n + 1 }, () => Array(maxLineas + 1).fill(0));
  mejor[0][0] = 0;
  for (let j = 1; j <= n; j++) {
    for (let k = 1; k <= maxLineas; k++) {
      for (let i = k - 1; i < j; i++) {
        const l = largo(i, j);
        if (l > ancho || mejor[i][k - 1] === Infinity) continue;
        const costo = mejor[i][k - 1] + (ancho - l) ** 2;
        if (costo < mejor[j][k]) {
          mejor[j][k] = costo;
          desde[j][k] = i;
        }
      }
    }
  }
  let mejorK = -1;
  for (let k = 1; k <= maxLineas; k++) if (mejor[n][k] < (mejorK < 0 ? Infinity : mejor[n][mejorK])) mejorK = k;
  if (mejorK < 0) return null;
  const lineas: string[] = [];
  for (let j = n, k = mejorK; k > 0; k--) {
    const i = desde[j][k];
    lineas.unshift(palabras.slice(i, j).join(' '));
    j = i;
  }
  return lineas;
}

/**
 * La letra más grande (entre `tamMin` y `tamMax`, en píxeles) con la que el nombre cabe en `anchoPx` × `altoPx`, y sus renglones
 * (parejos). Prefiere achicar la letra antes que cortar el nombre; solo si ni con la letra mínima cabe, lo corta con "…".
 */
export function ajustarNombre(nombre: string, anchoPx: number, altoPx: number, tamMin: number, tamMax: number, maxLineas: number): { tam: number; lineas: string[] } {
  const palabras = nombre.trim().split(/\s+/).filter(Boolean);
  const completo = palabras.join(' ');
  for (let tam = Math.round(tamMax); tam >= tamMin; tam -= 2) {
    const maxCaracteres = Math.max(4, Math.floor(anchoPx / (tam * 0.58)));
    const lineasPermitidas = Math.min(maxLineas, Math.floor(altoPx / (tam * 1.15)));
    if (lineasPermitidas < 1) continue;
    const lineas = repartirParejo(palabras, maxCaracteres, lineasPermitidas);
    if (lineas) return { tam, lineas };
  }
  const tam = Math.round(tamMin);
  return { tam, lineas: partirEnLineas(completo, Math.max(4, Math.floor(anchoPx / (tam * 0.58))), maxLineas) };
}

/**
 * SVG de UNA etiqueta (fondo blanco, tamaño exacto del formato a `DPI_IMAGEN`). Con QR: el código a la izquierda y el NOMBRE del
 * producto, grande y centrado, en el resto del ancho; con barras: barras arriba y el nombre grande y centrado debajo. Debajo del nombre va escrito el código de la
 * unidad (INF000014), el mismo que dice el QR. Si no se puede dibujar el código, deja un aviso.
 */
export function svgEtiqueta(e: Pick<EtiquetaPedida, 'codigo' | 'nombre'>, formato: FormatoEtiqueta, tipo: TipoCodigoEtiqueta = 'qr'): string {
  const W = pixeles(formato.anchoMm);
  const H = pixeles(formato.altoMm);
  const margen = pixeles(1.6);
  const pt = (puntos: number) => Math.round((puntos / 72) * DPI_IMAGEN);
  const tamBase = pt(formato.nombrePt);
  const tamMin = tamBase;
  const tamMax = Math.round(tamBase * 2.2);
  const fuente = 'font-family="Arial, Helvetica, sans-serif"';
  const contenido: string[] = [];

  const texto = (lineas: string[], tam: number, centroX: number, primeraY: number) =>
    lineas.map((linea, i) => `<text x="${centroX}" y="${Math.round(primeraY + i * tam * 1.15)}" font-size="${tam}" font-weight="700" text-anchor="middle" ${fuente}>${escapar(linea)}</text>`);

  // El código de la unidad (INF000014) va escrito debajo del nombre: es lo que dice el QR y se puede teclear si no se lee
  const codigoEscrito = (anchoPx: number) => {
    const tam = Math.max(8, Math.min(Math.round(tamBase * 1.2), Math.floor(anchoPx / (Math.max(1, e.codigo.length) * 0.66))));
    return { tam, alto: Math.round(tam * 1.5) };
  };
  const lineaCodigo = (tam: number, centroX: number, y: number) =>
    `<text x="${centroX}" y="${Math.round(y)}" font-size="${tam}" font-weight="700" letter-spacing="${Math.round(tam * 0.04)}" text-anchor="middle" ${fuente}>${escapar(e.codigo)}</text>`;

  const qr = buscarTipoCodigo(tipo) === 'qr' ? svgQr(e.codigo) : null;
  if (qr) {
    // El QR un poco más chico que el del formato: así el nombre tiene más ancho y se imprime más grande (un QR de ~19 mm se lee bien)
    const lado = Math.min(Math.round(pixeles(formato.qrMm) * 0.85), H - margen * 2);
    const y = Math.round((H - lado) / 2);
    contenido.push(qr.replace('<svg ', `<svg x="${margen}" y="${y}" width="${lado}" height="${lado}" `));
    const x = margen + lado + pixeles(1.5);
    const ancho = W - x - margen;
    const centroX = Math.round(x + ancho / 2);
    const codigo = codigoEscrito(ancho);
    const { tam, lineas } = ajustarNombre(e.nombre, ancho, H - margen * 2 - codigo.alto, tamMin, tamMax, 3);
    const altoNombre = lineas.length * tam * 1.15;
    const arriba = (H - (altoNombre + codigo.alto)) / 2;
    contenido.push(...texto(lineas, tam, centroX, arriba + tam * 0.85));
    contenido.push(lineaCodigo(codigo.tam, centroX, arriba + altoNombre + codigo.tam * 1.05));
  } else {
    const barras = svgCodigoBarras(e.codigo, 40);
    if (barras) {
      const alto = pixeles(formato.barrasMm);
      contenido.push(barras.replace('<svg ', `<svg x="${margen}" y="${margen}" width="${W - margen * 2}" height="${alto}" `));
      const inicio = margen + alto + pixeles(1);
      const disponible = H - inicio - margen;
      const codigo = codigoEscrito(W - margen * 2);
      const { tam, lineas } = ajustarNombre(e.nombre, W - margen * 2, disponible - codigo.alto, tamMin, tamMax, 2);
      const altoNombre = lineas.length * tam * 1.15;
      const arriba = inicio + (disponible - (altoNombre + codigo.alto)) / 2;
      contenido.push(...texto(lineas, tam, Math.round(W / 2), arriba + tam * 0.85));
      contenido.push(lineaCodigo(codigo.tam, Math.round(W / 2), arriba + altoNombre + codigo.tam * 1.05));
    } else {
      contenido.push(`<text x="${W / 2}" y="${H / 2}" font-size="${tamBase}" font-weight="700" text-anchor="middle" ${fuente}>Código no imprimible</text>`);
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

/** Una imagen PNG (archivo) por etiqueta, hasta MAX_ETIQUETAS_POR_TIRA. */
export async function prepararArchivosEtiquetas(
  etiquetas: Pick<EtiquetaPedida, 'codigo' | 'nombre'>[],
  formato: FormatoEtiqueta,
  tipo: TipoCodigoEtiqueta = 'qr'
): Promise<File[]> {
  return Promise.all(
    etiquetas.slice(0, MAX_ETIQUETAS_POR_TIRA).map(async (e) => new File([await etiquetaComoPng(e, formato, tipo)], nombreArchivoEtiqueta(e.codigo), { type: 'image/png' }))
  );
}

/** ¿Este navegador puede abrir el menú "Compartir" con archivos? (iPhone y Android sí; una computadora normalmente no.) */
export function puedeCompartirArchivos(archivos: File[]): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files: archivos });
}

/** Abre el menú Compartir con las imágenes. Devuelve false si el usuario lo cerró sin elegir nada. Debe llamarse desde un toque del usuario. */
export async function compartirArchivos(archivos: File[], titulo = 'Etiquetas EASYSTEM'): Promise<boolean> {
  try {
    await navigator.share({ files: archivos, title: titulo });
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

// ---------------------------------------------------------------------------------------------------------------------
// Varias etiquetas en UN solo archivo (las apps de impresoras como WePrint suelen aceptar una imagen o un PDF a la vez)
// ---------------------------------------------------------------------------------------------------------------------

/** Máximo de etiquetas en una tira o en un PDF. */
export const MAX_ETIQUETAS_POR_TIRA = 40;

/**
 * UNA imagen con todas las etiquetas una debajo de otra (ancho = el de la etiqueta, alto = etiquetas × alto de la etiqueta, más
 * `separacionMm` entre una y otra). Con el papel de etiquetas configurado en la app a ese mismo tamaño, la app imprime la tira
 * etiqueta por etiqueta. `separacionMm` sirve para compensar el espacio entre etiquetas del rollo si la impresión se va corriendo.
 */
export async function tiraComoPng(
  etiquetas: Pick<EtiquetaPedida, 'codigo' | 'nombre'>[],
  formato: FormatoEtiqueta,
  tipo: TipoCodigoEtiqueta = 'qr',
  separacionMm = 0
): Promise<Blob> {
  const lote = etiquetas.slice(0, MAX_ETIQUETAS_POR_TIRA);
  if (lote.length === 0) throw new Error('No hay etiquetas para la tira.');
  const ancho = pixeles(formato.anchoMm);
  const alto = pixeles(formato.altoMm);
  const separacion = pixeles(Math.max(0, Math.min(separacionMm, 10)));
  const canvas = document.createElement('canvas');
  canvas.width = ancho;
  canvas.height = alto * lote.length + separacion * (lote.length - 1);
  const contexto = canvas.getContext('2d');
  if (!contexto) throw new Error('El navegador no pudo preparar la imagen de la tira.');
  contexto.fillStyle = '#fff';
  contexto.fillRect(0, 0, canvas.width, canvas.height);
  for (const [i, e] of lote.entries()) {
    const imagen = new Image();
    imagen.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgEtiqueta(e, formato, tipo))}`;
    await imagen.decode();
    contexto.drawImage(imagen, 0, i * (alto + separacion), ancho, alto);
  }
  const blob = await new Promise<Blob | null>((resolver) => canvas.toBlob(resolver, 'image/png'));
  if (!blob) throw new Error('No se pudo crear la imagen de la tira.');
  return blob;
}

function concatenar(partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((s, p) => s + p.length, 0);
  const salida = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    salida.set(p, pos);
    pos += p.length;
  }
  return salida;
}

/**
 * PDF de varias páginas, UNA etiqueta por página con el tamaño exacto de la etiqueta (cada página es una imagen JPEG).
 * Es un PDF mínimo escrito a mano (sin librerías): catálogo, árbol de páginas y, por página, su contenido y su imagen.
 */
export function construirPdfDeJpegs(jpegs: { bytes: Uint8Array; ancho: number; alto: number }[], anchoMm: number, altoMm: number): Uint8Array {
  if (jpegs.length === 0) throw new Error('No hay páginas para el PDF.');
  const codificador = new TextEncoder();
  const puntos = (mm: number) => ((mm * 72) / MM_POR_PULGADA).toFixed(2);
  const W = puntos(anchoMm);
  const H = puntos(altoMm);

  // Numeración: 1 = catálogo, 2 = páginas; por cada página i: 3+3i = página, 4+3i = contenido, 5+3i = imagen
  const objetos: Uint8Array[] = [];
  objetos[1] = codificador.encode('<< /Type /Catalog /Pages 2 0 R >>');
  objetos[2] = codificador.encode(`<< /Type /Pages /Count ${jpegs.length} /Kids [${jpegs.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] >>`);
  jpegs.forEach((j, i) => {
    const pagina = 3 + 3 * i;
    const contenido = codificador.encode(`q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`);
    objetos[pagina] = codificador.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${pagina + 2} 0 R >> >> /Contents ${pagina + 1} 0 R >>`);
    objetos[pagina + 1] = concatenar([codificador.encode(`<< /Length ${contenido.length} >>\nstream\n`), contenido, codificador.encode('\nendstream')]);
    objetos[pagina + 2] = concatenar([
      codificador.encode(`<< /Type /XObject /Subtype /Image /Width ${j.ancho} /Height ${j.alto} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${j.bytes.length} >>\nstream\n`),
      j.bytes,
      codificador.encode('\nendstream'),
    ]);
  });

  const partes: Uint8Array[] = [codificador.encode('%PDF-1.4\n')];
  const posiciones: number[] = [];
  let largo = partes[0].length;
  for (let n = 1; n < objetos.length; n++) {
    posiciones[n] = largo;
    const cabeza = codificador.encode(`${n} 0 obj\n`);
    const cola = codificador.encode('\nendobj\n');
    partes.push(cabeza, objetos[n], cola);
    largo += cabeza.length + objetos[n].length + cola.length;
  }
  const filas = ['0000000000 65535 f '];
  for (let n = 1; n < objetos.length; n++) filas.push(`${String(posiciones[n]).padStart(10, '0')} 00000 n `);
  partes.push(codificador.encode(`xref\n0 ${objetos.length}\n${filas.join('\n')}\ntrailer\n<< /Size ${objetos.length} /Root 1 0 R >>\nstartxref\n${largo}\n%%EOF\n`));
  return concatenar(partes);
}

/** PDF con una etiqueta por página (solo en el navegador: dibuja cada etiqueta y la guarda como JPEG). */
export async function etiquetasComoPdf(etiquetas: Pick<EtiquetaPedida, 'codigo' | 'nombre'>[], formato: FormatoEtiqueta, tipo: TipoCodigoEtiqueta = 'qr'): Promise<Blob> {
  const ancho = pixeles(formato.anchoMm);
  const alto = pixeles(formato.altoMm);
  const jpegs: { bytes: Uint8Array; ancho: number; alto: number }[] = [];
  for (const e of etiquetas.slice(0, MAX_ETIQUETAS_POR_TIRA)) {
    const imagen = new Image();
    imagen.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgEtiqueta(e, formato, tipo))}`;
    await imagen.decode();
    const canvas = document.createElement('canvas');
    canvas.width = ancho;
    canvas.height = alto;
    const contexto = canvas.getContext('2d');
    if (!contexto) throw new Error('El navegador no pudo preparar el PDF.');
    contexto.fillStyle = '#fff';
    contexto.fillRect(0, 0, ancho, alto);
    contexto.drawImage(imagen, 0, 0, ancho, alto);
    const blob = await new Promise<Blob | null>((resolver) => canvas.toBlob(resolver, 'image/jpeg', 0.95));
    if (!blob) throw new Error('No se pudo crear el PDF de etiquetas.');
    jpegs.push({ bytes: new Uint8Array(await blob.arrayBuffer()), ancho, alto });
  }
  return new Blob([construirPdfDeJpegs(jpegs, formato.anchoMm, formato.altoMm) as BlobPart], { type: 'application/pdf' });
}
