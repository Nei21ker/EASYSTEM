// Actualización en vivo entre dispositivos: cuando alguien registra una venta, ingresa mercancía, paga la nómina,
// cambia la tasa, etc., las demás pantallas abiertas se actualizan solas, sin recargar la página.
//
// En modo servidor se consulta GET /api/cambios cada 10 s (solo con la pestaña visible y con actividad reciente; ver
// src/lib/sondeo.ts). El servidor devuelve únicamente las versiones de lo que el rol puede leer (un vendedor no se
// entera de la nómina, por ejemplo). Los datos del aviso se ignoran: solo se usa "qué tabla cambió" para volver a pedir
// la información con las funciones de siempre (inventoryService/auth), así que nada nuevo viaja ni se guarda.
//
// En modo demo (LocalStorage) no hay otros dispositivos, pero sí otras pestañas del mismo navegador: el evento
// "storage" avisa cuando una de ellas guarda, y se reutiliza el mismo mecanismo.
//
// Uso en una pantalla:
//   alCambiarDatos(['ventas', 'movimientos_inventario'], recargar);
// El aviso se agrupa (debounce) y nunca se ejecutan dos recargas a la vez.
import { api } from './api';
import { modoServidor } from './modo';
import { crearSondeo, type VersionCambio } from './sondeo';

/** Tablas cuyo cambio se avisa (el servidor sube su versión en cada escritura: src/server/cambios.ts). */
export const TABLAS_TIEMPO_REAL = [
  'productos',
  'inventario_local',
  'movimientos_inventario',
  'ventas',
  'devoluciones',
  'ordenes_servicio',
  'tasas_cambio',
  'empleados',
  'nominas',
  'nomina_reventas',
  'locales',
  'perfiles',
  'modelos_telefono',
  'compatibilidades',
  'unidades_producto',
  'cuadres_caja',
  'traslados',
  'mermas',
  'pendientes',
  'promotores',
] as const;

/** Cada cuánto se pregunta por cambios con la pantalla visible y activa. */
export const INTERVALO_SONDEO_MS = 10_000;

export const EVENTO_DATOS = 'easystem:datos-cambiaron';

let iniciado = false;

function emitir(tabla: string) {
  window.dispatchEvent(new CustomEvent(EVENTO_DATOS, { detail: { tabla } }));
}

/** Empieza a escuchar los cambios (una sola vez por carga de página). Es seguro llamarla varias veces. */
export function iniciarTiempoReal() {
  if (iniciado || typeof window === 'undefined') return;
  iniciado = true;

  // Al volver a la pestaña o recuperar la conexión se vuelve a pedir todo: por si se perdió algún aviso mientras dormía
  let ultimoResync = 0;
  const resincronizar = () => {
    const ahora = Date.now();
    if (ahora - ultimoResync < 5000) return;
    ultimoResync = ahora;
    emitir('*');
  };

  if (!modoServidor) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') resincronizar();
    });
    window.addEventListener('online', resincronizar);
    // Otras pestañas del mismo navegador (modo demostración)
    window.addEventListener('storage', (e) => {
      if (e.key === 'easystem:db:v1') emitir('*');
      else if (e.key === 'easystem:usuarios' || e.key === 'easystem:cierres-forzados') emitir('perfiles');
      else if (e.key === 'easystem:suscripciones') emitir('locales');
    });
    return;
  }

  const sondeo = crearSondeo({
    consultar: async () => (await api.get<{ versiones: VersionCambio[] }>('/api/cambios')).versiones,
    emitir,
    visible: () => document.visibilityState === 'visible',
    // Cada consulta es una petición del Worker (el plan gratuito permite 100.000 al día): 10 s con varias cajas abiertas
    // cuesta la mitad que 5 s y sigue siendo "casi en vivo"
    intervaloMs: INTERVALO_SONDEO_MS,
  });
  sondeo.iniciar();

  // Cualquier gesto cuenta como actividad (si la pantalla estaba en pausa por inactividad, se consulta al instante)
  for (const evento of ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const) {
    window.addEventListener(evento, () => sondeo.registrarActividad(), { passive: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sondeo.alVolverAVerse();
  });
  window.addEventListener('online', () => {
    resincronizar();
    sondeo.alVolverAVerse();
  });
}

/**
 * Ejecuta `recargar` cuando cambie alguna de las `tablas` (o cuando haya que resincronizar todo).
 * Agrupa avisos seguidos (`esperaMs`) y, si una recarga está en curso, encola una sola más.
 * Devuelve una función para dejar de escuchar.
 */
export function alCambiarDatos(tablas: readonly string[], recargar: () => void | Promise<void>, esperaMs = 600): () => void {
  iniciarTiempoReal();

  let temporizador: number | undefined;
  let corriendo = false;
  let pendiente = false;

  const ejecutar = async () => {
    if (corriendo) {
      pendiente = true;
      return;
    }
    corriendo = true;
    try {
      await recargar();
    } catch (err) {
      console.warn('[EASYSTEM] No se pudo actualizar la pantalla en vivo.', err);
    } finally {
      corriendo = false;
      if (pendiente) {
        pendiente = false;
        void ejecutar();
      }
    }
  };

  const oyente = (e: Event) => {
    const tabla = (e as CustomEvent<{ tabla: string }>).detail?.tabla;
    if (tabla !== '*' && !tablas.includes(tabla)) return;
    window.clearTimeout(temporizador);
    temporizador = window.setTimeout(ejecutar, esperaMs);
  };

  window.addEventListener(EVENTO_DATOS, oyente);
  return () => window.removeEventListener(EVENTO_DATOS, oyente);
}
