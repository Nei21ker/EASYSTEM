import { describe, expect, it } from 'vitest';
import { pareceImagen } from '../../src/utils/imagenes';

// Los teléfonos Android a veces entregan la foto sin tipo o como "application/octet-stream": antes se rechazaba y
// "el botón de la foto no funcionaba nunca". Solo se descarta lo que declara ser otra cosa.
describe('pareceImagen: qué archivos se intentan leer como foto', () => {
  it('acepta las fotos normales de cualquier formato de imagen (el navegador decide si las puede leer)', () => {
    for (const tipo of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/JPEG']) {
      expect(pareceImagen({ type: tipo })).toBe(true);
    }
  });

  it('acepta una foto sin tipo o con tipo genérico (Android)', () => {
    expect(pareceImagen({ type: '' })).toBe(true);
    expect(pareceImagen({ type: 'application/octet-stream' })).toBe(true);
  });

  it('rechaza lo que declara ser otra cosa: PDF, texto, video', () => {
    for (const tipo of ['application/pdf', 'text/plain', 'video/mp4']) {
      expect(pareceImagen({ type: tipo })).toBe(false);
    }
  });
});
