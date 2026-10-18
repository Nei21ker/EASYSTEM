// Tasa del dólar vigente (Bs por $), compartida por toda la interfaz. Arranca con
// la última tasa guardada en este navegador (para pintar los Bs. sin esperar a la
// red) y la actualiza TasaDelDia.astro al registrar o confirmar la del día.
// Las páginas leen `tasaActual.get()` al renderizar y se re-renderizan con
// `tasaActual.listen(...)` cuando cambia.
import { atom } from 'nanostores';
import { leerTasaCacheada } from '../lib/inventoryService';

export const tasaActual = atom<number | null>(leerTasaCacheada()?.tasa ?? null);
