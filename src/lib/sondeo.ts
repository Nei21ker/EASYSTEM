// Núcleo de la actualización en vivo por consulta periódica (sin Durable Objects ni WebSockets: el costo es una petición
// pequeña cada 5 s por pantalla abierta y activa). Es independiente del navegador para poder probarse con reloj falso.
//
// Reglas:
//  · La primera consulta fija la línea base y NO emite nada.
//  · Cada 5 s, si la pestaña está visible y hubo actividad en los últimos 3 minutos, se consulta; una pantalla
//    abandonada o en segundo plano no gasta peticiones.
//  · Se emite el evento de una tabla cuando alguna de sus versiones (por local) cambió o apareció.
//  · Al volver a verse la pestaña, o al haber actividad tras una pausa, se consulta de inmediato.
//  · Nunca hay dos consultas a la vez; un fallo de red se ignora y conserva la línea base.

export interface VersionCambio {
  tabla: string;
  local_id: string | null;
  version: number;
}

export interface OpcionesSondeo {
  consultar: () => Promise<VersionCambio[]>;
  emitir: (tabla: string) => void;
  visible: () => boolean;
  intervaloMs?: number;
  inactividadMs?: number;
}

export function crearSondeo(opciones: OpcionesSondeo) {
  const intervaloMs = opciones.intervaloMs ?? 5000;
  const inactividadMs = opciones.inactividadMs ?? 3 * 60_000;

  let temporizador: ReturnType<typeof setInterval> | undefined;
  let linea: Map<string, number> | null = null;
  let consultando = false;
  let ultimaActividad = Date.now();

  const inactivo = () => Date.now() - ultimaActividad > inactividadMs;

  async function consultar(): Promise<void> {
    if (consultando) return;
    consultando = true;
    try {
      const versiones = await opciones.consultar();
      const actual = new Map(versiones.map((v) => [`${v.tabla}@${v.local_id ?? ''}`, v.version]));
      if (linea) {
        const cambiadas = new Set<string>();
        for (const v of versiones) {
          if (linea.get(`${v.tabla}@${v.local_id ?? ''}`) !== v.version) cambiadas.add(v.tabla);
        }
        for (const tabla of cambiadas) opciones.emitir(tabla);
      }
      linea = actual;
    } catch {
      // Sin red o error del servidor: se reintenta en la siguiente vuelta, con la misma línea base
    } finally {
      consultando = false;
    }
  }

  return {
    iniciar() {
      if (temporizador) return;
      ultimaActividad = Date.now();
      void consultar();
      temporizador = setInterval(() => {
        if (!opciones.visible() || inactivo()) return;
        void consultar();
      }, intervaloMs);
    },
    detener() {
      if (temporizador) clearInterval(temporizador);
      temporizador = undefined;
    },
    /** El usuario hizo algo (tocar, teclear, mover): si estaba en pausa por inactividad, se consulta de inmediato. */
    registrarActividad() {
      const estabaInactivo = inactivo();
      ultimaActividad = Date.now();
      if (estabaInactivo && temporizador && opciones.visible()) void consultar();
    },
    /** La pestaña volvió a estar visible (o regresó la conexión): se consulta ya, sin esperar al siguiente turno. */
    alVolverAVerse() {
      ultimaActividad = Date.now();
      if (temporizador) void consultar();
    },
  };
}
