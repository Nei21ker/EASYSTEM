// Actualización en vivo entre dispositivos: cuando alguien registra una venta, ingresa mercancía, paga la nómina,
// cambia la tasa, etc., las demás pantallas abiertas se actualizan solas, sin recargar la página.
//
// Con Supabase usa Realtime (postgres_changes) sobre las tablas de la migración 0030. Los cambios llegan
// FILTRADOS POR RLS: cada usuario solo se entera de lo que ya puede leer (un vendedor no recibe avisos de
// la nómina, por ejemplo). Los datos del aviso se ignoran: solo se usa "qué tabla cambió" para volver a pedir
// la información con las funciones de siempre (inventoryService/auth), así que nada nuevo viaja ni se guarda.
//
// En modo LocalStorage (sin Supabase) no hay otros dispositivos, pero sí otras pestañas del mismo navegador:
// el evento "storage" avisa cuando una de ellas guarda, y se reutiliza el mismo mecanismo.
//
// Uso en una pantalla:
//   alCambiarDatos(['ventas', 'movimientos_inventario'], recargar);
// El aviso se agrupa (debounce) y nunca se ejecutan dos recargas a la vez.
import { supabase, supabaseConfigurado } from './supabase';

/** Tablas que se escuchan (deben estar en la publicación supabase_realtime: migración 0030). */
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
] as const;

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
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resincronizar();
  });
  window.addEventListener('online', resincronizar);

  if (!supabaseConfigurado) {
    // Otras pestañas del mismo navegador (modo demostración)
    window.addEventListener('storage', (e) => {
      if (e.key === 'easystem:db:v1') emitir('*');
      else if (e.key === 'easystem:usuarios' || e.key === 'easystem:cierres-forzados') emitir('perfiles');
      else if (e.key === 'easystem:suscripciones') emitir('locales');
    });
    return;
  }

  try {
    const canal = supabase.channel('easystem-cambios');
    for (const tabla of TABLAS_TIEMPO_REAL) {
      canal.on('postgres_changes', { event: '*', schema: 'public', table: tabla }, () => emitir(tabla));
    }
    let conexiones = 0;
    canal.subscribe((estado) => {
      if (estado === 'SUBSCRIBED') {
        conexiones += 1;
        // Una reconexión pudo perder avisos: se vuelve a pedir todo
        if (conexiones > 1) emitir('*');
      } else if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT') {
        console.warn('[EASYSTEM] Actualización en vivo no disponible (¿aplicaste la migración 0030?). Las pantallas se actualizan al recargar.');
      }
    });
  } catch (err) {
    console.warn('[EASYSTEM] No se pudo iniciar la actualización en vivo.', err);
  }
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
