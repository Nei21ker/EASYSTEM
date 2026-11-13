// Lista de promotores ya registrados en el local, para elegir uno en el cobro con precio de promotor (y en «promotor que instala»)
// en vez de escribir sus datos. Lo que se muestra lo decide el servidor (los de ESE local); aquí solo se busca y se elige.
import type { Promotor } from '../types/database.types';

const sinAcentos = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const escapar = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Filtra por nombre, apellido, cédula o teléfono (sin mayúsculas ni acentos; cada palabra escrita debe aparecer). */
export function filtrarPromotores(lista: Promotor[], texto: string): Promotor[] {
  const palabras = sinAcentos(texto).split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return lista;
  return lista.filter((p) => {
    const pajar = sinAcentos(`${p.nombre} ${p.apellido} ${p.cedula} ${p.telefono ?? ''}`);
    return palabras.every((w) => pajar.includes(w));
  });
}

/** Separa «V-12345678» en la nacionalidad y el número (para los dos campos de la cédula). */
export function partirCedula(cedula: string): { nac: 'V' | 'E'; numero: string } {
  const m = cedula.toUpperCase().match(/^([VE])-?(\d+)$/);
  return { nac: m?.[1] === 'E' ? 'E' : 'V', numero: m?.[2] ?? '' };
}

interface Elementos {
  boton: HTMLElement;
  panel: HTMLElement;
  buscador: HTMLInputElement;
  lista: HTMLElement;
  vacio: HTMLElement;
  cargar: () => Promise<Promotor[]>;
  alElegir: (promotor: Promotor) => void;
}

/** Conecta el botón «Elegir promotor registrado» con su panel desplegable. `cerrar()` lo esconde (al abrir o cerrar el diálogo). */
export function montarSelectorPromotor(e: Elementos): { cerrar: () => void } {
  let promotores: Promotor[] = [];

  function pintar() {
    const visibles = filtrarPromotores(promotores, e.buscador.value);
    e.vacio.classList.toggle('hidden', visibles.length > 0);
    e.vacio.textContent = promotores.length === 0 ? 'Todavía no hay promotores registrados en este local. Escribe sus datos abajo y quedará registrado.' : 'Ninguno coincide con lo que escribiste.';
    e.lista.innerHTML = visibles
      .map(
        (p) =>
          `<li><button type="button" data-promotor="${escapar(p.id)}" class="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800"><span class="min-w-0 break-words text-sm font-medium text-slate-800 dark:text-slate-100">${escapar(`${p.nombre} ${p.apellido}`.trim() || p.cedula)}</span><span class="shrink-0 text-xs text-slate-500 dark:text-slate-400">${escapar(p.cedula)}</span></button></li>`
      )
      .join('');
  }

  async function abrir() {
    e.panel.classList.remove('hidden');
    e.buscador.value = '';
    pintar();
    try {
      promotores = await e.cargar();
    } catch {
      // Sin conexión o sin permiso: se escriben a mano
      promotores = [];
    }
    pintar();
    e.buscador.focus();
  }

  const cerrar = () => e.panel.classList.add('hidden');

  e.boton.addEventListener('click', () => {
    if (e.panel.classList.contains('hidden')) void abrir();
    else cerrar();
  });
  e.buscador.addEventListener('input', pintar);
  e.lista.addEventListener('click', (ev) => {
    const id = (ev.target as HTMLElement).closest<HTMLElement>('[data-promotor]')?.dataset.promotor;
    const elegido = promotores.find((p) => p.id === id);
    if (!elegido) return;
    cerrar();
    e.alElegir(elegido);
  });
  return { cerrar };
}
