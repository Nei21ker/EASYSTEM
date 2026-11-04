import { describe, expect, it } from 'vitest';
import { nombreArchivoTicket, svgTicket } from '../../src/utils/ticketImagen';

const venta = {
  folio: 74,
  fecha: '2026-11-04T15:30:00.000Z',
  cliente_nombre: 'María Pérez',
  cliente_cedula: 'V-12345678',
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
    {
      producto_id: 'a',
      nombre: 'Cargador Honor sencillo Tipo C',
      codigo_barras: '2000000000015',
      cantidad: 2,
      precio_unitario: 6,
      unidades: ['2100000000741', '2100000000819'],
    },
  ],
};

const texto = (svg: string) => svg.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const alto = (svg: string) => Number(/<svg[^>]* height="(\d+)"/.exec(svg)![1]);

describe('svgTicket', () => {
  const svg = svgTicket(venta);

  it('es un SVG de ancho fijo con fondo blanco', () => {
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toMatch(/ width="\d+"/);
    expect(svg).toContain('fill="#fff"');
  });

  it('lleva el negocio, el folio, la fecha, el cliente con su cédula, cada producto con su cantidad y el total', () => {
    const t = texto(svg);
    expect(t).toContain('Edward Accesorios');
    expect(t).toContain('Folio #0074');
    expect(t).toContain('2026');
    expect(t).toContain('María Pérez');
    expect(t).toContain('V-12345678');
    expect(t).toContain('Cargador Honor sencillo Tipo C');
    expect(t).toContain('2 ×');
    expect(t).toContain('$12.00');
  });

  it('muestra el código de CADA unidad comprada (es lo que identifica el producto en la garantía)', () => {
    const t = texto(svg);
    expect(t).toContain('2100000000741');
    expect(t).toContain('2100000000819');
  });

  it('muestra la forma de pago y lo cobrado en bolívares con la tasa', () => {
    const t = texto(svg);
    expect(t).toMatch(/Pago móvil/i);
    expect(t).toMatch(/Bs\./);
    expect(t).toMatch(/36,50/);
  });

  it('dice que sirve como nota de entrega y comprobante de garantía', () => {
    expect(texto(svg)).toMatch(/nota de entrega/i);
    expect(texto(svg)).toMatch(/garant[ií]a/i);
  });

  it('una venta sin códigos de unidad (hecha antes de que existieran) no deja un hueco ni falla', () => {
    const sin = svgTicket({ ...venta, items: [{ ...venta.items[0], unidades: undefined }] });
    expect(texto(sin)).toContain('Cargador Honor sencillo Tipo C');
  });

  it('una venta hecha sin conexión (folio 0) avisa que el folio se asigna después y no inventa uno', () => {
    const t = texto(svgTicket({ ...venta, folio: 0 }));
    expect(t).not.toContain('#0000');
    expect(t).toMatch(/folio.*pendiente/i);
  });

  it('con vuelto lo indica', () => {
    const t = texto(svgTicket({ ...venta, vuelto: { metodo: 'USD_EFECTIVO', monto_usd: 4, monto_bs: null } }));
    expect(t).toMatch(/Vuelto/);
    expect(t).toContain('$4.00');
  });

  it('escapa los caracteres especiales del nombre para que el SVG siga siendo válido', () => {
    const raro = svgTicket({ ...venta, items: [{ ...venta.items[0], nombre: 'Forro <Pro> & "Max"' }] });
    expect(raro).not.toContain('<Pro>');
    expect(raro).toContain('Forro &lt;Pro&gt; &amp; &quot;Max&quot;');
  });

  it('crece con más unidades y más productos (nada se corta)', () => {
    const muchas = Array.from({ length: 12 }, (_, i) => `21000000${String(i).padStart(5, '0')}`);
    const grande = svgTicket({
      ...venta,
      items: [
        { ...venta.items[0], cantidad: 12, unidades: muchas },
        { ...venta.items[0], producto_id: 'b', nombre: 'Cable USB', unidades: ['2100000009999'], cantidad: 1 },
      ],
    });
    expect(alto(grande)).toBeGreaterThan(alto(svg));
    for (const c of muchas) expect(texto(grande)).toContain(c);
  });

  it('un nombre muy largo se reparte en varios renglones sin perder palabras', () => {
    const nombre = 'Cargador de pared rápido 25W Samsung Galaxy S23 Ultra con cable USB tipo C original';
    const t = texto(svgTicket({ ...venta, items: [{ ...venta.items[0], nombre }] }));
    for (const palabra of nombre.split(' ')) expect(t).toContain(palabra);
  });
});

describe('nombreArchivoTicket', () => {
  it('usa el folio con ceros y termina en .png', () => {
    expect(nombreArchivoTicket(74)).toBe('ticket-0074.png');
  });
  it('sin folio (venta sin conexión) usa un nombre genérico', () => {
    expect(nombreArchivoTicket(0)).toBe('ticket-pendiente.png');
  });
});
