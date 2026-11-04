import { afterEach, describe, expect, it, vi } from 'vitest';
import { copiarImagenAlPortapapeles } from '../../src/utils/ticketImagen';

class ClipboardItemFalso {
  constructor(public datos: Record<string, Blob | Promise<Blob>>) {}
}

afterEach(() => vi.unstubAllGlobals());

const archivo = () => new File([new Uint8Array([1, 2, 3])], 'ticket-0074.png', { type: 'image/png' });

describe('copiarImagenAlPortapapeles', () => {
  it('copia la imagen PNG al portapapeles y devuelve true', async () => {
    const escribir = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('ClipboardItem', ClipboardItemFalso);
    vi.stubGlobal('navigator', { clipboard: { write: escribir } });

    expect(await copiarImagenAlPortapapeles(Promise.resolve(archivo()))).toBe(true);

    expect(escribir).toHaveBeenCalledTimes(1);
    const [items] = escribir.mock.calls[0] as [ClipboardItemFalso[]];
    expect(Object.keys(items[0].datos)).toEqual(['image/png']);
    expect(await items[0].datos['image/png']).toBeInstanceOf(Blob);
  });

  it('llama a write() de inmediato, sin esperar la imagen (el iPhone exige que ocurra dentro del toque del usuario)', () => {
    const escribir = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('ClipboardItem', ClipboardItemFalso);
    vi.stubGlobal('navigator', { clipboard: { write: escribir } });

    void copiarImagenAlPortapapeles(new Promise<File>(() => {})); // la imagen nunca llega
    expect(escribir).toHaveBeenCalledTimes(1); // y aun así ya se pidió escribir
  });

  it('devuelve false si el navegador no sabe copiar imágenes', async () => {
    vi.stubGlobal('navigator', {});
    expect(await copiarImagenAlPortapapeles(Promise.resolve(archivo()))).toBe(false);
  });

  it('devuelve false si el navegador rechaza la copia (sin permiso)', async () => {
    vi.stubGlobal('ClipboardItem', ClipboardItemFalso);
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError')) } });
    expect(await copiarImagenAlPortapapeles(Promise.resolve(archivo()))).toBe(false);
  });
});
