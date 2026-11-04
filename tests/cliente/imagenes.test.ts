import { describe, expect, it } from 'vitest';
import { htmlMiniatura } from '../../src/utils/imagenes';

describe('htmlMiniatura', () => {
  it('toda foto real se puede ampliar: lleva data-ampliable y cursor de lupa', () => {
    const html = htmlMiniatura('/api/archivos/publico/productos/p/1.jpg', 'Cargador Honor', 'h-12 w-12');
    expect(html).toContain('data-ampliable');
    expect(html).toContain('cursor-zoom-in');
    expect(html).toContain('alt="Cargador Honor"');
  });

  it('sin foto es un ícono: no se puede ampliar', () => {
    const html = htmlMiniatura(null, 'Sin foto');
    expect(html).not.toContain('data-ampliable');
    expect(html).not.toContain('<img');
  });

  it('una dirección peligrosa no genera imagen ni se puede ampliar', () => {
    const html = htmlMiniatura('javascript:alert(1)', 'x');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('data-ampliable');
  });

  it('el nombre con comillas o etiquetas no rompe el HTML', () => {
    const html = htmlMiniatura('/x.jpg', 'Cable "USB" <b>');
    expect(html).toContain('alt="Cable &quot;USB&quot; &lt;b>"');
  });
});
