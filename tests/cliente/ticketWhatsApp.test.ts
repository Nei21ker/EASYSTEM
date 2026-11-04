import { describe, expect, it } from 'vitest';
import { telefonoParaWhatsApp, urlWhatsApp } from '../../src/utils/ticketWhatsApp';

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

describe('urlWhatsApp', () => {
  it('abre el chat de ese número, sin texto (el ticket va como imagen)', () => {
    expect(urlWhatsApp('0414-1234567')).toBe('https://wa.me/584141234567');
  });

  it('con un teléfono que no sirve no hay enlace', () => {
    expect(urlWhatsApp('abc')).toBeNull();
  });
});
