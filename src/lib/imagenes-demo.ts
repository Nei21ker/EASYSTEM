// Imágenes de PRUEBA de los productos del Local Accesorios: ilustraciones sencillas (public/img/demo/*.svg)
// elegidas por el nombre del producto. Son de relleno hasta cargar las fotos reales con "Editar".
//
// La misma regla existe en SQL (migración 0031): si cambias el orden o los patrones aquí, cámbialo allá también.

export const RUTA_IMAGENES_DEMO = '/img/demo/';

const sinAcentos = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Ruta de la imagen de prueba que le corresponde a un producto (por nombre y categoría). */
export function imagenDemoParaProducto(nombre: string, categoria: string): string {
  const n = sinAcentos(nombre);
  const c = sinAcentos(categoria);
  const archivo = (() => {
    if (/^forro.*magsafe/.test(n)) return 'forro-magsafe';
    if (/^forro.*silicona/.test(n)) return 'forro-silicona';
    if (/^forro.*antigolpes/.test(n)) return 'forro-antigolpes';
    if (/^forro.*transparente/.test(n)) return 'forro-transparente';
    if (c === 'forros') return 'forro-silicona';
    if (/inalambric/.test(n)) return 'cargador-inalambrico';
    if (/carro/.test(n)) return 'cargador-carro';
    if (/^cable/.test(n)) return 'cable';
    if (/popsocket/.test(n) || /^popsocket/.test(c)) return 'popsocket';
    if (/audifonos/.test(n)) return 'audifonos';
    if (/^cargador/.test(n) || c === 'cargadores') return 'cargador';
    return 'generico';
  })();
  return `${RUTA_IMAGENES_DEMO}${archivo}.svg`;
}
