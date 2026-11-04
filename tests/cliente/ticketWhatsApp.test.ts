import { describe, expect, it } from 'vitest';
import { telefonoParaWhatsApp, textoTicketWhatsApp, urlWhatsApp } from '../../src/utils/ticketWhatsApp';

describe('telefonoParaWhatsApp', () => {
  it('un celular venezolano escrito de cualquier forma se vuelve el número internacional (58 + sin el 0 inicial)', () => {
    for (const escrito of ['0414-1234567', '04141234567', '0414 123 4567', '(0414) 123-4567', '4141234567', '+58 414 1234567', '584141234567', '00584141234567']) {
      expect(telefonoParaWhatsApp(escrito), escrito).toBe('584141234567');
    }
  });

  it('un número de otro país con + se respeta tal cual', () => {
    expect(telefonoParaWhatsApp('+57 300 1234567')).toBe('573001234567');
    expect(telefonoParaWhatsApp('+1 (305) 555-0123')).toBe('13055550123');
  });

  it('un teléfono demasiado corto, demasiado largo o sin números no sirve', () => {
    for (const malo of ['', 'abc', '12345', '0414-123', '+58 414 12345678901234']) expect(telefonoParaWhatsApp(malo), malo).toBeNull();
  });

  it('el código de país por defecto se puede cambiar', () => {
    expect(telefonoParaWhatsApp('0300-1234567', '57')).toBe('573001234567');
  });
});

const venta = {
  folio: 74,
  fecha: '2026-11-04T15:30:00.000Z',
  cliente_nombre: 'María Pérez',
  cliente_cedula: 'V-12345678',
  cliente_telefono: '0414-1234567',
  total: 12,
  total_bs: 438,
  tasa_cambio: 36.5,
  metodo_pago: 'MIXTO' as const,
  pagos: [
    { metodo: 'USD_EFECTIVO' as const, monto_usd: 6, monto_bs: null },
    { metodo: 'BS_PAGO_MOVIL' as const, monto_usd: 6, monto_bs: 219 },
  ],
  vuelto: null,
  items: [
    { producto_id: 'a', nombre: 'Cargador Honor sencillo Tipo C', codigo_barras: '2000000000015', cantidad: 2, precio_unitario: 6 },
  ],
};

describe('textoTicketWhatsApp', () => {
  const texto = textoTicketWhatsApp(venta);

  it('lleva el negocio, el folio, el cliente, cada producto con su cantidad y el total', () => {
    expect(texto).toContain('*Edward Accesorios*');
    expect(texto).toContain('Folio #0074');
    expect(texto).toContain('María Pérez');
    expect(texto).toContain('2 × Cargador Honor sencillo Tipo C');
    expect(texto).toContain('$12.00');
    expect(texto).toMatch(/Total/);
  });

  it('muestra la forma de pago y lo cobrado en bolívares con la tasa', () => {
    expect(texto).toMatch(/Pago móvil/i);
    expect(texto).toMatch(/Bs\./);
    expect(texto).toMatch(/36,50/);
  });

  it('una venta hecha sin conexión (folio 0) avisa que el folio se asigna después, y no inventa uno', () => {
    const t = textoTicketWhatsApp({ ...venta, folio: 0 });
    expect(t).not.toContain('#0000');
    expect(t).toMatch(/folio.*pendiente/i);
  });

  it('con vuelto lo indica', () => {
    const t = textoTicketWhatsApp({ ...venta, vuelto: { metodo: 'USD_EFECTIVO', monto_usd: 4, monto_bs: null } });
    expect(t).toMatch(/Vuelto/);
    expect(t).toContain('$4.00');
  });

  it('no incluye la cédula ni el teléfono del cliente (el mensaje queda en un chat, y la cédula es un dato sensible)', () => {
    expect(texto).not.toContain('12345678');
    expect(texto).not.toContain('1234567');
  });
});

describe('urlWhatsApp', () => {
  it('abre el chat de ese número con el texto ya escrito y bien codificado', () => {
    const url = urlWhatsApp('0414-1234567', 'Hola *ticket*\n2 × Cargador & más');
    expect(url.startsWith('https://wa.me/584141234567?text=')).toBe(true);
    expect(decodeURIComponent(url.split('text=')[1])).toBe('Hola *ticket*\n2 × Cargador & más');
  });

  it('con un teléfono que no sirve no hay enlace', () => {
    expect(urlWhatsApp('abc', 'x')).toBeNull();
  });
});
