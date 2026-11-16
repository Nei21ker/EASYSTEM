import { describe, expect, it } from 'vitest';
import { mensajeEquipoListo } from '../../src/utils/servicioTecnico';
import { urlWhatsAppConTexto } from '../../src/utils/ticketWhatsApp';

describe('aviso al cliente: equipo listo', () => {
  it('saluda por el primer nombre y dice equipo, folio y local', () => {
    const m = mensajeEquipoListo({ cliente: 'Neiker Flores', marca: 'Infinix', modelo: 'Hot 30i', folio: 1, local: 'Local Servicio Técnico' });
    expect(m).toContain('Hola Neiker,');
    expect(m).toContain('Infinix Hot 30i (orden #0001) ya está listo');
    expect(m).toContain('retirarlo en Local Servicio Técnico');
    expect(m).not.toContain('Flores');
  });

  it('sin nombre de local no dice «en …»', () => {
    expect(mensajeEquipoListo({ cliente: 'Ana', marca: 'Apple', modelo: 'iPhone 11', folio: 12 })).toContain('retirarlo.');
  });

  it('el enlace abre el chat del número con el texto codificado; null si el teléfono no sirve', () => {
    const url = urlWhatsAppConTexto('0424-8993046', 'Hola, ya está listo & seguro');
    expect(url).toBe(`https://wa.me/584248993046?text=${encodeURIComponent('Hola, ya está listo & seguro')}`);
    expect(urlWhatsAppConTexto('123', 'x')).toBeNull();
  });
});
