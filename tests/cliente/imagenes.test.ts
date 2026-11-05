import { describe, expect, it } from 'vitest';
import { htmlMiniatura, urlMiniatura } from '../../src/utils/imagenes';

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

describe('miniaturas de las fotos del servidor', () => {
  const FOTO = '/api/archivos/publico/productos/64606e11-ab5f-4156-bd4b-e5ae82c23c44/1730000000000.webp';
  const MINIATURA = '/api/archivos/publico/productos/64606e11-ab5f-4156-bd4b-e5ae82c23c44/1730000000000-m.webp';

  it('urlMiniatura: la foto del servidor tiene su miniatura (mismo nombre + -m, misma extensión)', () => {
    expect(urlMiniatura(FOTO)).toBe(MINIATURA);
    expect(urlMiniatura(FOTO.replace('.webp', '.jpg'))).toBe(MINIATURA.replace('.webp', '.jpg'));
  });

  it('urlMiniatura: lo que no es una foto del servidor (data:, otro sitio, la propia miniatura, ilustraciones) no tiene', () => {
    expect(urlMiniatura(MINIATURA)).toBeNull();
    expect(urlMiniatura('data:image/jpeg;base64,AAAA')).toBeNull();
    expect(urlMiniatura('https://otro-sitio.com/x.jpg')).toBeNull();
    expect(urlMiniatura('/img/demo/forro.svg')).toBeNull();
    expect(urlMiniatura(null)).toBeNull();
    expect(urlMiniatura(undefined)).toBeNull();
  });

  it('la lista pide la miniatura, y si no existe (foto anterior) cae a la foto grande', () => {
    const html = htmlMiniatura(FOTO, 'Cargador', 'h-12 w-12');
    expect(html).toContain(`src="${MINIATURA}"`);
    expect(html).toContain(`onerror="this.onerror=null;this.src='${FOTO}'"`);
  });

  it('al ampliar se muestra la foto grande, no la miniatura', () => {
    expect(htmlMiniatura(FOTO, 'Cargador')).toContain(`data-grande="${FOTO}"`);
  });

  it('una foto sin miniatura (demo, ilustración) se pinta igual que antes', () => {
    const html = htmlMiniatura('/img/demo/forro.svg', 'Forro');
    expect(html).toContain('src="/img/demo/forro.svg"');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('data-grande');
  });
});
