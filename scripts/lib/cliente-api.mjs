// Cliente mínimo de la API de EASYSTEM para los scripts: inicia sesión con Better-Auth y reenvía la cookie.
// (La clave solo se usa para iniciar sesión: no se guarda ni aparece en ningún mensaje de error.)

export function crearClienteApi(base, fetchFn = fetch) {
  const url = base.replace(/\/+$/, '');
  const origen = new URL(url).origin;
  let cookie = '';

  async function pedir(metodo, ruta, { cuerpo, tipo } = {}) {
    const cabeceras = { origin: origen };
    if (cookie) cabeceras.cookie = cookie;
    if (tipo) cabeceras['content-type'] = tipo;
    let respuesta;
    try {
      respuesta = await fetchFn(`${url}${ruta}`, { method: metodo, headers: cabeceras, body: cuerpo });
    } catch (err) {
      throw new Error(`No pude conectar con ${url} (${err.message}). ¿Está encendido (npx wrangler dev) o es la dirección correcta?`);
    }
    let datos = null;
    if ((respuesta.headers.get('content-type') ?? '').includes('application/json')) datos = await respuesta.json().catch(() => null);
    if (!respuesta.ok) {
      const e = datos ?? {};
      const error = new Error(e.error ?? e.message ?? `El servidor respondió ${respuesta.status}.`);
      error.status = respuesta.status;
      error.codigo = e.codigo ?? e.code;
      throw error;
    }
    return { datos, respuesta };
  }

  const json = (cuerpo) => ({ cuerpo: JSON.stringify(cuerpo ?? {}), tipo: 'application/json' });

  return {
    async iniciarSesion(email, password) {
      try {
        const { respuesta } = await pedir('POST', '/api/auth/sign-in/email', json({ email, password }));
        cookie = respuesta.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
        if (!cookie) throw new Error('El servidor no devolvió una sesión.');
      } catch (err) {
        if (err.codigo === 'INVALID_EMAIL_OR_PASSWORD' || err.status === 401) throw new Error('El correo o la contraseña no son correctos.');
        throw err;
      }
    },
    get: async (ruta) => (await pedir('GET', ruta)).datos,
    post: async (ruta, cuerpo) => (await pedir('POST', ruta, json(cuerpo))).datos,
    patch: async (ruta, cuerpo) => (await pedir('PATCH', ruta, json(cuerpo))).datos,
    /** Sube un archivo (los bytes) y devuelve la url que respondió el servidor. */
    async subir(ruta, bytes, tipoMime) {
      const { datos } = await pedir('PUT', ruta, { cuerpo: bytes, tipo: tipoMime });
      return datos.url ?? datos.ruta;
    },
  };
}
