import { persistentAtom } from '@nanostores/persistent';

export type Tema = 'light' | 'dark';

export const $tema = persistentAtom<Tema>('easystem:tema', 'light');

export function alternarTema() {
  $tema.set($tema.get() === 'dark' ? 'light' : 'dark');
}

export function aplicarTemaAlDocumento(tema: Tema) {
  document.documentElement.classList.toggle('dark', tema === 'dark');
}
