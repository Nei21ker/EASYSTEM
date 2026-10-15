// Utilidades de animación para los <script> de cliente. Las animaciones en sí
// viven en src/styles/global.css; aquí solo se disparan. Todo respeta la
// preferencia del sistema "reducir movimiento".

function sinMovimiento(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Hace que los hijos directos de un contenedor (filas, tarjetas) entren
 * escalonados. Se quita la clase al terminar, así que los re-renders
 * posteriores (p. ej. al escribir en un buscador) NO vuelven a animarse.
 */
const temporizadores = new WeakMap<HTMLElement, number>();

export function animarLista(contenedor: HTMLElement | null) {
  if (!contenedor || sinMovimiento()) return;

  window.clearTimeout(temporizadores.get(contenedor));
  contenedor.classList.add('anim-lista');
  temporizadores.set(
    contenedor,
    window.setTimeout(() => contenedor.classList.remove('anim-lista'), 900)
  );
}

/** Reinicia una animación CSS de un solo disparo sobre un elemento. */
export function reanimar(el: HTMLElement | null, clase: string) {
  if (!el || sinMovimiento()) return;
  el.classList.remove(clase);
  void el.offsetWidth; // fuerza reflow para poder repetir la animación
  el.classList.add(clase);
  const alTerminar = (e: AnimationEvent) => {
    if (e.target !== el) return;
    el.classList.remove(clase);
    el.removeEventListener('animationend', alTerminar);
  };
  el.addEventListener('animationend', alTerminar);
}

/** Cuenta desde 0 hasta `destino` con ease-out, escribiendo el texto formateado. */
export function contarHasta(
  el: HTMLElement | null,
  destino: number,
  formato: (n: number) => string = (n) => String(Math.round(n)),
  duracionMs = 900
) {
  if (!el) return;
  if (sinMovimiento() || destino === 0 || !Number.isFinite(destino)) {
    delete el.dataset.contando; // cancela cualquier conteo anterior en curso
    el.textContent = formato(destino);
    return;
  }

  const inicio = performance.now();
  // Si el mismo elemento vuelve a animarse (p. ej. al cambiar un filtro), la
  // animación anterior se descarta para que no pise el valor nuevo.
  const id = String(inicio);
  el.dataset.contando = id;
  const paso = (ahora: number) => {
    if (el.dataset.contando !== id) return;
    const t = Math.min(1, (ahora - inicio) / duracionMs);
    const suave = 1 - Math.pow(1 - t, 3); // ease-out cúbico
    el.textContent = formato(destino * suave);
    if (t < 1) requestAnimationFrame(paso);
    else el.textContent = formato(destino);
  };
  requestAnimationFrame(paso);

  // requestAnimationFrame se pausa en pestañas en segundo plano: este respaldo
  // garantiza que el valor final siempre quede escrito.
  window.setTimeout(() => {
    if (el.dataset.contando === id) el.textContent = formato(destino);
  }, duracionMs + 150);
}
