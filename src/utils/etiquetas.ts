// Etiquetas con código QR (o de barras) y nombre del producto, listas para imprimir.
//
// Por defecto llevan un código QR: lo lee la cámara de cualquier teléfono y los lectores 2D/inalámbricos. Los
// lectores láser clásicos solo leen barras: para ellos se puede elegir "Barras" (ver TIPOS_CODIGO_ETIQUETA).
//
// Dos formas de impresora (aún no hay una elegida, así que ambas están soportadas):
//  · Rollo (impresora térmica de etiquetas): cada etiqueta es una página del tamaño exacto de la etiqueta.
//  · Hoja A4 de etiquetas adhesivas: se acomodan en cuadrícula, varias por página.
// Se imprime con window.print() sobre un contenedor temporal (ocultando el resto de la página con CSS de
// impresión), igual que el resto del sistema; las barras vienen de utils/codigoBarras.ts.
import { svgCodigoBarras } from './codigoBarras';
import { svgQr } from './qr';

export type TipoCodigoEtiqueta = 'qr' | 'barras';

export const TIPOS_CODIGO_ETIQUETA: { id: TipoCodigoEtiqueta; nombre: string; ayuda: string }[] = [
  { id: 'qr', nombre: 'Código QR (recomendado)', ayuda: 'Lo lee la cámara de cualquier teléfono y los lectores 2D. Un lector láser clásico NO lee QR.' },
  { id: 'barras', nombre: 'Código de barras', ayuda: 'Lo leen los lectores láser clásicos y casi todos los 2D; la cámara del teléfono a veces falla con barras.' },
];

export const TIPO_CODIGO_POR_DEFECTO: TipoCodigoEtiqueta = 'qr';

export function buscarTipoCodigo(id: string | null | undefined): TipoCodigoEtiqueta {
  return id === 'barras' ? 'barras' : 'qr';
}

export interface FormatoEtiqueta {
  id: string;
  nombre: string;
  anchoMm: number;
  altoMm: number;
  /** Alto de las barras en mm */
  barrasMm: number;
  /** Lado del código QR en mm */
  qrMm: number;
  /** Tamaño de letra del nombre y del número, en puntos */
  nombrePt: number;
  numeroPt: number;
  /** Si existe: hoja A4 con etiquetas en cuadrícula (si no, rollo: una etiqueta por página) */
  hoja?: { columnas: number; filas: number };
}

export const FORMATOS_ETIQUETA: FormatoEtiqueta[] = [
  { id: 'rollo-50x30', nombre: 'Rollo de 50 × 30 mm (impresora térmica)', anchoMm: 50, altoMm: 30, barrasMm: 13, qrMm: 22, nombrePt: 7.5, numeroPt: 7 },
  { id: 'rollo-40x25', nombre: 'Rollo de 40 × 25 mm (impresora térmica)', anchoMm: 40, altoMm: 25, barrasMm: 10, qrMm: 18, nombrePt: 6.5, numeroPt: 6 },
  { id: 'a4-3x8', nombre: 'Hoja A4 de 24 etiquetas (3 × 8, de 70 × 37 mm)', anchoMm: 70, altoMm: 37, barrasMm: 17, qrMm: 28, nombrePt: 9, numeroPt: 8, hoja: { columnas: 3, filas: 8 } },
];

export const FORMATO_ETIQUETA_POR_DEFECTO = FORMATOS_ETIQUETA[0].id;

export function buscarFormatoEtiqueta(id: string | null | undefined): FormatoEtiqueta {
  return FORMATOS_ETIQUETA.find((f) => f.id === id) ?? FORMATOS_ETIQUETA[0];
}

export interface EtiquetaPedida {
  codigo: string;
  nombre: string;
  copias: number;
}

function escapar(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** CSS de la etiqueta (sirve tanto para la vista previa en pantalla como para imprimir). */
export function estilosEtiqueta(): string {
  return `
.etq{box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;gap:.4mm;overflow:hidden;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif;padding:1.6mm 2mm;line-height:1.1;break-inside:avoid}
.etq svg{display:block;width:100%}
.etq .etq-numero{text-align:center;font-family:'Courier New',monospace;letter-spacing:.15mm;white-space:nowrap}
.etq .etq-nombre{font-weight:700;text-align:center;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.etq.etq-fila{flex-direction:row;align-items:center;justify-content:flex-start;gap:2mm}
.etq .etq-qr{flex:none}
.etq .etq-qr svg{width:100%;height:100%}
.etq .etq-texto{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:.8mm}
.etq-fila .etq-nombre{text-align:left;-webkit-line-clamp:3}
.etq-fila .etq-numero{text-align:left;letter-spacing:0}
.etq .etq-sin-barras{font-size:7pt;font-weight:700;text-align:center;border:.3mm dashed #000;padding:1mm}
`;
}

/** HTML de UNA etiqueta con el tamaño de `formato` y el tipo de código elegido (QR por defecto). */
export function htmlEtiqueta(e: Pick<EtiquetaPedida, 'codigo' | 'nombre'>, formato: FormatoEtiqueta, tipo: TipoCodigoEtiqueta = TIPO_CODIGO_POR_DEFECTO): string {
  const dimensiones = `width:${formato.anchoMm}mm;height:${formato.altoMm}mm`;
  const qr = tipo === 'qr' ? svgQr(e.codigo) : null;
  // Con QR: el código a la izquierda y, a su lado, el nombre y el número. Si no se puede generar un QR, se cae a las barras.
  if (qr) {
    return `<div class="etq etq-fila" style="${dimensiones}"><div class="etq-qr" style="width:${formato.qrMm}mm;height:${formato.qrMm}mm">${qr}</div><div class="etq-texto"><div class="etq-nombre" style="font-size:${formato.nombrePt}pt">${escapar(e.nombre)}</div><div class="etq-numero" style="font-size:${formato.numeroPt}pt">${escapar(e.codigo)}</div></div></div>`;
  }

  const barras = svgCodigoBarras(e.codigo, 40);
  const cuerpo = barras
    ? `<div style="height:${formato.barrasMm}mm">${barras.replace('<svg ', '<svg style="height:100%" ')}</div>
       <div class="etq-numero" style="font-size:${formato.numeroPt}pt">${escapar(e.codigo)}</div>`
    : `<div class="etq-sin-barras">Código no imprimible en barras: ${escapar(e.codigo)}</div>`;
  return `<div class="etq" style="${dimensiones}">${cuerpo}<div class="etq-nombre" style="font-size:${formato.nombrePt}pt">${escapar(e.nombre)}</div></div>`;
}

/** Cantidad total de etiquetas del pedido. */
export function totalEtiquetas(pedidas: EtiquetaPedida[]): number {
  return pedidas.reduce((suma, p) => suma + Math.max(0, Math.floor(p.copias)), 0);
}

/** Hojas necesarias (A4) o etiquetas (rollo) para el pedido. */
export function paginasNecesarias(pedidas: EtiquetaPedida[], formato: FormatoEtiqueta): number {
  const total = totalEtiquetas(pedidas);
  return formato.hoja ? Math.ceil(total / (formato.hoja.columnas * formato.hoja.filas)) : total;
}

const ID_CONTENEDOR = 'etiquetas-impresion';
const ID_ESTILO = 'etiquetas-estilo-impresion';

function limpiarImpresion() {
  document.getElementById(ID_CONTENEDOR)?.remove();
  document.getElementById(ID_ESTILO)?.remove();
}

/** Abre el diálogo de impresión del navegador con todas las etiquetas. Devuelve cuántas se mandaron. */
export function imprimirEtiquetas(pedidas: EtiquetaPedida[], formato: FormatoEtiqueta, tipo: TipoCodigoEtiqueta = TIPO_CODIGO_POR_DEFECTO): number {
  const etiquetas: string[] = [];
  for (const p of pedidas) {
    const n = Math.max(0, Math.floor(p.copias));
    if (n === 0) continue;
    const html = htmlEtiqueta(p, formato, tipo);
    for (let i = 0; i < n; i++) etiquetas.push(html);
  }
  if (etiquetas.length === 0) return 0;

  limpiarImpresion();

  let cuerpo: string;
  let tamanoPagina: string;
  if (formato.hoja) {
    const porHoja = formato.hoja.columnas * formato.hoja.filas;
    const hojas: string[] = [];
    for (let i = 0; i < etiquetas.length; i += porHoja) {
      hojas.push(`<div class="etq-hoja">${etiquetas.slice(i, i + porHoja).join('')}</div>`);
    }
    cuerpo = hojas.join('');
    tamanoPagina = 'A4';
  } else {
    cuerpo = etiquetas.map((html) => `<div class="etq-pagina">${html}</div>`).join('');
    tamanoPagina = `${formato.anchoMm}mm ${formato.altoMm}mm`;
  }

  const estilo = document.createElement('style');
  estilo.id = ID_ESTILO;
  estilo.textContent = `
${estilosEtiqueta()}
@page { size: ${tamanoPagina}; margin: 0; }
#${ID_CONTENEDOR}{display:none}
.etq-pagina{width:${formato.anchoMm}mm;height:${formato.altoMm}mm;overflow:hidden;page-break-after:always;break-after:page}
.etq-pagina:last-child{page-break-after:auto;break-after:auto}
.etq-hoja{display:grid;grid-template-columns:repeat(${formato.hoja?.columnas ?? 1},${formato.anchoMm}mm);grid-auto-rows:${formato.altoMm}mm;width:210mm;height:296mm;overflow:hidden;page-break-after:always;break-after:page}
.etq-hoja:last-child{page-break-after:auto;break-after:auto}
@media print{
  html,body{margin:0!important;padding:0!important;background:#fff!important}
  body>*:not(#${ID_CONTENEDOR}){display:none!important}
  #${ID_CONTENEDOR}{display:block!important}
}`;

  const contenedor = document.createElement('div');
  contenedor.id = ID_CONTENEDOR;
  contenedor.innerHTML = cuerpo;

  document.head.appendChild(estilo);
  document.body.appendChild(contenedor);

  window.addEventListener('afterprint', limpiarImpresion, { once: true });
  // Si el navegador no avisa al terminar, se limpia de todos modos
  window.setTimeout(limpiarImpresion, 120_000);
  window.print();
  return etiquetas.length;
}
