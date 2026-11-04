// Ticket de venta como IMAGEN (PNG): es la nota de entrega y el comprobante de garantía que se le manda al cliente.
//
// WhatsApp no deja que una página mande mensajes sola, y un enlace wa.me solo puede llevar texto. Para mandar una imagen se usa el menú
// "Compartir" del teléfono (Web Share API con archivos): el cajero elige WhatsApp y el chat del cliente y toca "Enviar". Es el mismo
// camino que ya usan las etiquetas (etiquetaImagen.ts): se dibuja un SVG, se pasa a PNG con un canvas y se entrega como archivo.
import { formatearBolivares, formatearMoneda } from './format';
import { etiquetaMetodoPago, pagosDeVenta } from './pagos';
import { partirEnLineas } from './etiquetaImagen';
import type { DineroEntregado, PagoVenta, Venta, VentaItem } from '../types/database.types';

export interface VentaParaTicket {
  folio: number;
  fecha: string;
  cliente_nombre: string;
  /** La cédula del cliente: identifica a quien compró (el ticket es su garantía). Se muestra igual que en el ticket de pantalla. */
  cliente_cedula?: string;
  total: number;
  total_bs?: number | null;
  tasa_cambio?: number | null;
  metodo_pago: Venta['metodo_pago'];
  pagos?: PagoVenta[] | null;
  vuelto?: DineroEntregado | null;
  items: VentaItem[];
}

/** Ancho del ticket en píxeles (se ve bien en la pantalla de un teléfono y se lee al ampliarlo). */
export const ANCHO_TICKET_PX = 720;

const MARGEN = 40;
const FUENTE = 'font-family="Arial, Helvetica, sans-serif"';
const FUENTE_CODIGO = 'font-family="Consolas, \'Courier New\', monospace"';

function escapar(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Nombre del archivo: el folio es único por venta. */
export function nombreArchivoTicket(folio: number): string {
  return folio ? `ticket-${String(folio).padStart(4, '0')}.png` : 'ticket-pendiente.png';
}

function montoConBs(usd: number, bs: number | null | undefined): string {
  return bs != null ? `${formatearBolivares(bs)} (${formatearMoneda(usd)})` : formatearMoneda(usd);
}

/**
 * SVG del ticket completo: negocio, folio, fecha, cliente, cada producto (cantidad, precio y el CÓDIGO de cada unidad vendida), total,
 * bolívares con la tasa, forma de pago, vuelto y la leyenda de nota de entrega / garantía. Alto variable según el contenido.
 */
export function svgTicket(venta: VentaParaTicket): string {
  const W = ANCHO_TICKET_PX;
  const derecha = W - MARGEN;
  const partes: string[] = [];
  let y = 0;

  const texto = (contenido: string, x: number, tam: number, opciones: { peso?: number; ancla?: 'start' | 'middle' | 'end'; color?: string; codigo?: boolean } = {}) => {
    const { peso = 400, ancla = 'start', color = '#0f172a', codigo = false } = opciones;
    partes.push(`<text x="${x}" y="${y}" font-size="${tam}" font-weight="${peso}" text-anchor="${ancla}" fill="${color}" ${codigo ? FUENTE_CODIGO : FUENTE}>${escapar(contenido)}</text>`);
  };
  const separador = () => {
    partes.push(`<line x1="${MARGEN}" y1="${y}" x2="${derecha}" y2="${y}" stroke="#94a3b8" stroke-width="2" stroke-dasharray="8 6"/>`);
  };
  const filaDosColumnas = (izquierda: string, valor: string, tam: number, peso = 400, color = '#0f172a') => {
    texto(izquierda, MARGEN, tam, { peso, color });
    texto(valor, derecha, tam, { peso, ancla: 'end', color });
  };

  // Encabezado
  y = 70;
  texto('Edward Accesorios', W / 2, 40, { peso: 700, ancla: 'middle' });
  y += 38;
  texto('Ticket de venta', W / 2, 26, { ancla: 'middle', color: '#475569' });
  y += 36;
  texto(venta.folio ? `Folio #${String(venta.folio).padStart(4, '0')}` : 'Folio pendiente (se asigna al sincronizar)', W / 2, 26, { peso: 700, ancla: 'middle' });
  y += 34;
  const fecha = new Date(venta.fecha).toLocaleString('es-VE', { dateStyle: 'medium', timeStyle: 'short' });
  texto(fecha, W / 2, 24, { ancla: 'middle', color: '#475569' });
  y += 40;
  const cliente = venta.cliente_cedula ? `Cliente: ${venta.cliente_nombre} · ${venta.cliente_cedula}` : `Cliente: ${venta.cliente_nombre}`;
  for (const linea of partirEnLineas(cliente, 44, 3)) {
    texto(linea, W / 2, 24, { ancla: 'middle' });
    y += 32;
  }
  y += 6;
  separador();
  y += 14;

  // Productos: nombre y subtotal, cantidad × precio, y los códigos de cada unidad vendida
  for (const item of venta.items) {
    const lineasNombre = partirEnLineas(item.nombre, 34, 4);
    y += 30;
    lineasNombre.forEach((linea, i) => {
      texto(linea, MARGEN, 27, { peso: 700 });
      if (i === 0) texto(formatearMoneda(item.precio_unitario * item.cantidad), derecha, 27, { peso: 700, ancla: 'end' });
      if (i < lineasNombre.length - 1) y += 33;
    });
    y += 32;
    texto(`${item.cantidad} × ${formatearMoneda(item.precio_unitario)}`, MARGEN, 23, { color: '#475569' });

    const codigos = item.unidades ?? [];
    if (codigos.length > 0) {
      y += 30;
      texto(codigos.length === 1 ? 'Código del producto:' : 'Códigos de los productos:', MARGEN, 21, { color: '#475569' });
      const porFila = 3;
      const ancho = (derecha - MARGEN) / porFila;
      for (let i = 0; i < codigos.length; i += porFila) {
        y += 30;
        codigos.slice(i, i + porFila).forEach((codigo, j) => texto(codigo, MARGEN + j * ancho, 23, { peso: 700, codigo: true }));
      }
    }
    y += 22;
  }

  separador();
  y += 42;

  // Totales
  filaDosColumnas('Total', formatearMoneda(venta.total), 32, 700);
  if (venta.total_bs != null) {
    y += 38;
    filaDosColumnas('Cobrado en bolívares', formatearBolivares(venta.total_bs), 24, 700);
  }
  if (venta.tasa_cambio) {
    y += 32;
    texto(`Tasa del día: ${formatearBolivares(venta.tasa_cambio)} por $1`, derecha, 21, { ancla: 'end', color: '#475569' });
  }

  // Forma de pago
  const pagos = pagosDeVenta(venta as Pick<Venta, 'pagos' | 'metodo_pago' | 'total' | 'total_bs'>);
  if (pagos.length > 0 || venta.vuelto) {
    y += 28;
    separador();
    y += 36;
    texto('Forma de pago', MARGEN, 23, { peso: 700, color: '#334155' });
    for (const p of pagos) {
      y += 32;
      filaDosColumnas(etiquetaMetodoPago(p.metodo), montoConBs(p.monto_usd, p.monto_bs), 22, 400, '#334155');
    }
    if (venta.vuelto) {
      y += 32;
      filaDosColumnas(`Vuelto (${etiquetaMetodoPago(venta.vuelto.metodo)})`, `−${montoConBs(venta.vuelto.monto_usd, venta.vuelto.monto_bs)}`, 22, 700, '#334155');
    }
  }

  // Cierre: agradecimiento y leyenda de garantía
  y += 34;
  separador();
  y += 44;
  texto('¡Gracias por su compra!', W / 2, 28, { peso: 700, ancla: 'middle' });
  const leyenda = 'Este ticket es su nota de entrega y su comprobante de compra para hacer valer la garantía. Consérvelo.';
  for (const linea of partirEnLineas(leyenda, 50, 4)) {
    y += 32;
    texto(linea, W / 2, 21, { ancla: 'middle', color: '#475569' });
  }
  y += 48;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}"><rect width="${W}" height="${y}" fill="#fff"/>${partes.join('')}</svg>`;
}

/** Dibuja el ticket en un canvas y lo devuelve como PNG (solo en el navegador). */
export async function ticketComoPng(venta: VentaParaTicket): Promise<Blob> {
  const svg = svgTicket(venta);
  const ancho = ANCHO_TICKET_PX;
  const alto = Number(/<svg[^>]* height="(\d+)"/.exec(svg)![1]);
  const imagen = new Image();
  imagen.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await imagen.decode();
  const escala = 2; // el doble de píxeles: el texto de los códigos se lee bien al ampliar la imagen en el chat
  const canvas = document.createElement('canvas');
  canvas.width = ancho * escala;
  canvas.height = alto * escala;
  const contexto = canvas.getContext('2d');
  if (!contexto) throw new Error('El navegador no pudo preparar la imagen del ticket.');
  contexto.fillStyle = '#fff';
  contexto.fillRect(0, 0, canvas.width, canvas.height);
  contexto.drawImage(imagen, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolver) => canvas.toBlob(resolver, 'image/png'));
  if (!blob) throw new Error('No se pudo crear la imagen del ticket.');
  return blob;
}

/** El ticket como archivo PNG listo para compartir. */
export async function archivoDeTicket(venta: VentaParaTicket): Promise<File> {
  return new File([await ticketComoPng(venta)], nombreArchivoTicket(venta.folio), { type: 'image/png' });
}

/**
 * Copia la imagen al portapapeles para pegarla en el chat de WhatsApp (mantener pulsado el cuadro de mensaje → Pegar). Es la forma de
 * mandar una imagen al chat de UN número concreto: el menú Compartir no deja elegir el chat, y un enlace wa.me solo lleva texto.
 * Se pide escribir de inmediato con la imagen como promesa: Safari exige que `write()` ocurra dentro del toque del usuario.
 * Devuelve false si el navegador no sabe copiar imágenes o no lo permite (entonces se descarga o se comparte).
 */
export async function copiarImagenAlPortapapeles(archivo: Promise<File>): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': archivo.then((a) => new Blob([a], { type: 'image/png' })) })]);
    return true;
  } catch {
    return false;
  }
}
