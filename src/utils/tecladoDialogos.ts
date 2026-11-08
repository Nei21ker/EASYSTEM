/**
 * Teclado en pantalla (celular) dentro de las ventanas (<dialog>).
 *
 * Al salir el teclado la ventana queda bajita y el campo que se escribe, o los botones de abajo, quedaban fuera de lo visible.
 * Solo con pantalla táctil (`(pointer: coarse)`; con ratón y teclado físico no pasa nada):
 *  - al enfocar un campo de texto dentro de una ventana se lo lleva a la vista (a los 150 y 450 ms, y otra vez cuando
 *    `visualViewport` cambia de tamaño, que es cuando el teclado termina de salir);
 *  - mientras ese campo tiene el foco, la ventana lleva `data-teclado="true"`. Con eso se esconde lo secundario: cualquier
 *    elemento con la clase `oculto-con-teclado` (ver global.css) o con `group-data-[teclado=true]:hidden` si la ventana es `group`.
 *    Se quita 250 ms después de perder el foco (si no pasó a otro campo) y al cerrar la ventana.
 * Se detecta por foco + puntero táctil y no por el alto de la ventana: iOS solo encoge `visualViewport`, Android encoge todo.
 */
const NO_ES_TEXTO = ['checkbox', 'radio', 'button', 'submit', 'file', 'range', 'color'];

export function esCampoDeTexto(el: Element | null): el is HTMLElement {
  return !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !NO_ES_TEXTO.includes((el as HTMLInputElement).type);
}

let iniciado = false;

export function iniciarTecladoDialogos(): void {
  if (iniciado || typeof document === 'undefined') return;
  iniciado = true;

  const pantallaTactil = window.matchMedia('(pointer: coarse)');
  const traerAVista = (campo: HTMLElement) => {
    if (campo.isConnected && document.activeElement === campo) campo.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  let pausa: ReturnType<typeof setTimeout> | undefined;

  document.addEventListener('focusin', (e) => {
    const campo = e.target as Element | null;
    if (!pantallaTactil.matches || !esCampoDeTexto(campo)) return;
    const dialogo = campo.closest('dialog');
    if (!dialogo) return;
    clearTimeout(pausa);
    dialogo.dataset.teclado = 'true';
    for (const ms of [150, 450]) setTimeout(() => traerAVista(campo), ms);
  });

  document.addEventListener('focusout', (e) => {
    const dialogo = (e.target as Element | null)?.closest?.('dialog') as HTMLDialogElement | null | undefined;
    if (!dialogo) return;
    clearTimeout(pausa);
    pausa = setTimeout(() => {
      if (!dialogo.contains(document.activeElement) || !esCampoDeTexto(document.activeElement)) delete dialogo.dataset.teclado;
    }, 250);
  });

  // 'close' no burbujea: se escucha en la fase de captura
  document.addEventListener('close', (e) => delete (e.target as HTMLElement).dataset?.teclado, true);

  window.visualViewport?.addEventListener('resize', () => {
    const activo = document.activeElement;
    if (pantallaTactil.matches && esCampoDeTexto(activo) && activo.closest('dialog[open]')) traerAVista(activo);
  });
}
