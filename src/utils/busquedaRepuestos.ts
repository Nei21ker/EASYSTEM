/** Mantiene la búsqueda en primer plano mientras se escribe o ajusta una cantidad en el móvil. */
export function configurarBusquedaRepuestos(
  dialogo: HTMLDialogElement,
  buscador: HTMLInputElement,
  volver: HTMLButtonElement,
  repuestosUsados: HTMLElement,
  esTactil = () => window.matchMedia('(pointer: coarse)').matches
): (destino?: HTMLElement) => void {
  const finalizar = (destino = repuestosUsados) => {
    if (!dialogo.dataset.buscandoRepuesto) return;
    delete dialogo.dataset.buscandoRepuesto;
    destino.focus({ preventScroll: true });
    destino.scrollIntoView({ block: 'nearest' });
  };

  buscador.addEventListener('focus', () => {
    if (dialogo.open && esTactil()) dialogo.dataset.buscandoRepuesto = 'true';
  });
  volver.addEventListener('click', () => finalizar());
  dialogo.addEventListener('close', () => delete dialogo.dataset.buscandoRepuesto);
  return finalizar;
}
