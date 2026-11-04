// Ticket de venta para enviarlo por WhatsApp desde el teléfono donde se usa el sistema.
// WhatsApp no deja que una página mande mensajes sola: se abre el chat del cliente (enlace wa.me) con el ticket ya escrito y quien
// cobra solo toca "Enviar" en WhatsApp. Sirve igual en el WhatsApp del iPhone, de Android o de la computadora.
import { formatearBolivares, formatearMoneda } from './format';
import { etiquetaMetodoPago, pagosDeVenta } from './pagos';
import type { DineroEntregado, PagoVenta, VentaItem, Venta } from '../types/database.types';

/** Código de país por defecto de los teléfonos que se escriben sin él (Venezuela). */
export const CODIGO_PAIS_POR_DEFECTO = '58';

/**
 * El teléfono como lo pide WhatsApp: solo dígitos, con el código de país y sin ceros de marcación (584141234567).
 * Acepta "0414-1234567", "(0414) 123 4567", "+58 414 1234567", "4141234567"… Un número con "+" o "00" de otro país se respeta.
 * Devuelve null si no parece un teléfono válido (menos de 10 o más de 15 dígitos).
 */
export function telefonoParaWhatsApp(telefono: string, codigoPais: string = CODIGO_PAIS_POR_DEFECTO): string | null {
  const limpio = telefono.trim();
  let digitos = limpio.replace(/\D/g, '');
  if (!digitos) return null;

  if (limpio.startsWith('+')) {
    // Ya viene con su código de país
  } else if (digitos.startsWith('00')) {
    digitos = digitos.slice(2);
  } else if (digitos.startsWith('0')) {
    digitos = codigoPais + digitos.replace(/^0+/, ''); // 0414… → 58414…
  } else if (!digitos.startsWith(codigoPais) || digitos.length <= 10) {
    digitos = codigoPais + digitos; // 4141234567 → 584141234567
  }
  return digitos.length >= 10 && digitos.length <= 15 ? digitos : null;
}

/** Enlace que abre WhatsApp en el chat de ese número con el texto escrito; null si el teléfono no sirve. */
export function urlWhatsApp(telefono: string, texto: string): string | null {
  const numero = telefonoParaWhatsApp(telefono);
  return numero ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}` : null;
}

export interface VentaParaTicket {
  folio: number;
  fecha: string;
  cliente_nombre: string;
  total: number;
  total_bs?: number | null;
  tasa_cambio?: number | null;
  metodo_pago: Venta['metodo_pago'];
  pagos?: PagoVenta[] | null;
  vuelto?: DineroEntregado | null;
  items: VentaItem[];
}

/**
 * El texto del ticket con el formato de WhatsApp (*negrita*). A propósito NO lleva la cédula ni el teléfono del cliente: el mensaje
 * queda guardado en un chat y son datos personales.
 */
export function textoTicketWhatsApp(venta: VentaParaTicket): string {
  const fecha = new Date(venta.fecha).toLocaleString('es-VE', { dateStyle: 'medium', timeStyle: 'short' });
  const lineas: string[] = [
    '*Edward Accesorios*',
    'Ticket de venta',
    venta.folio ? `Folio #${String(venta.folio).padStart(4, '0')}` : 'Folio pendiente (se asigna al sincronizar)',
    fecha,
    '',
    `Cliente: ${venta.cliente_nombre}`,
    '',
    ...venta.items.map((i) => `• ${i.cantidad} × ${i.nombre} — ${formatearMoneda(i.precio_unitario * i.cantidad)}`),
    '',
    `*Total: ${formatearMoneda(venta.total)}*`,
  ];
  if (venta.total_bs != null) lineas.push(`Cobrado en bolívares: ${formatearBolivares(venta.total_bs)}`);
  if (venta.tasa_cambio) lineas.push(`Tasa del día: ${formatearBolivares(venta.tasa_cambio)} por $1`);

  const pagos = pagosDeVenta(venta as Pick<Venta, 'pagos' | 'metodo_pago' | 'total' | 'total_bs'>);
  if (pagos.length > 0) {
    lineas.push('', 'Forma de pago:');
    for (const p of pagos) {
      lineas.push(`• ${etiquetaMetodoPago(p.metodo)}: ${p.monto_bs != null ? `${formatearBolivares(p.monto_bs)} (${formatearMoneda(p.monto_usd)})` : formatearMoneda(p.monto_usd)}`);
    }
  }
  if (venta.vuelto) {
    const v = venta.vuelto;
    lineas.push(`Vuelto (${etiquetaMetodoPago(v.metodo)}): ${v.monto_bs != null ? `${formatearBolivares(v.monto_bs)} (${formatearMoneda(v.monto_usd)})` : formatearMoneda(v.monto_usd)}`);
  }
  lineas.push('', '¡Gracias por su compra!');
  return lineas.join('\n');
}
