// Cliente de la API de EASYSTEM (/api/*). Todas las llamadas llevan la cookie de sesión.
// Los errores son `Error` con el mensaje en español que envía el servidor; un fallo de red produce un
// mensaje que `esErrorDeRed` reconoce, para que el modo sin conexión siga encolando como siempre.

export class ErrorDeApi extends Error {
  constructor(
    mensaje: string,
    readonly status: number,
    readonly codigo?: string
  ) {
    super(mensaje);
    this.name = 'ErrorDeApi';
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

function construirUrl(ruta: string, query?: Query): string {
  if (!query) return ruta;
  const parametros = new URLSearchParams();
  for (const [clave, valor] of Object.entries(query)) {
    if (valor !== undefined && valor !== null) parametros.set(clave, String(valor));
  }
  const texto = parametros.toString();
  return texto ? `${ruta}${ruta.includes('?') ? '&' : '?'}${texto}` : ruta;
}

async function pedir<T>(metodo: string, ruta: string, opciones: { query?: Query; cuerpo?: BodyInit; tipo?: string } = {}): Promise<T> {
  const cabeceras: Record<string, string> = {};
  if (opciones.tipo) cabeceras['Content-Type'] = opciones.tipo;

  let respuesta: Response;
  try {
    respuesta = await fetch(construirUrl(ruta, opciones.query), { method: metodo, credentials: 'include', headers: cabeceras, body: opciones.cuerpo });
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    throw new ErrorDeApi(`No hay conexión con el servidor (${detalle}).`, 0, 'sin_conexion');
  }

  let datos: unknown = null;
  const tipoRespuesta = respuesta.headers.get('content-type') ?? '';
  if (tipoRespuesta.includes('application/json')) {
    try {
      datos = await respuesta.json();
    } catch {
      datos = null;
    }
  }
  if (!respuesta.ok) {
    // Nuestras rutas responden { error, codigo }; Better-Auth responde { message, code }
    const cuerpo = (datos ?? {}) as { error?: string; codigo?: string; message?: string; code?: string };
    throw new ErrorDeApi(cuerpo.error ?? cuerpo.message ?? `El servidor respondió con un error (${respuesta.status}).`, respuesta.status, cuerpo.codigo ?? cuerpo.code);
  }
  return datos as T;
}

const json = (cuerpo: unknown) => ({ cuerpo: JSON.stringify(cuerpo ?? {}), tipo: 'application/json' });

export const api = {
  get: <T>(ruta: string, query?: Query) => pedir<T>('GET', ruta, { query }),
  post: <T>(ruta: string, cuerpo?: unknown) => pedir<T>('POST', ruta, json(cuerpo)),
  put: <T>(ruta: string, cuerpo?: unknown) => pedir<T>('PUT', ruta, json(cuerpo)),
  patch: <T>(ruta: string, cuerpo?: unknown) => pedir<T>('PATCH', ruta, json(cuerpo)),
  delete: <T>(ruta: string, query?: Query) => pedir<T>('DELETE', ruta, { query }),
  /** Sube un archivo (PUT con los bytes) y devuelve la URL (fotos de producto) o la ruta (archivos privados) que respondió el servidor. */
  async subir(ruta: string, archivo: Blob, tipoMime: string): Promise<string> {
    const r = await pedir<{ url?: string; ruta?: string }>('PUT', ruta, { cuerpo: archivo, tipo: tipoMime });
    const resultado = r.url ?? r.ruta;
    if (!resultado) throw new ErrorDeApi('El servidor no devolvió la dirección del archivo.', 200);
    return resultado;
  },
};
