// Cabeceras de seguridad de las respuestas del Worker (la API y las páginas que atiende Astro).
// Las páginas estáticas (HTML, JS, CSS) las sirve Cloudflare directo desde `public/_headers`: si cambias una política aquí, cámbiala allá también.

/**
 * Para la API y los archivos: no se pueden meter en un marco de otro sitio, el navegador no adivina el tipo (un archivo subido como
 * imagen nunca se ejecuta como página), no se manda la dirección como referente a otros sitios y siempre HTTPS.
 * Sin `default-src 'none'` a propósito: Chrome no muestra una imagen abierta sola con esa política.
 */
export const CABECERAS_API: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy': "frame-ancestors 'none'",
  'referrer-policy': 'same-origin',
  'strict-transport-security': 'max-age=31536000',
  'permissions-policy': 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
};

/** La misma respuesta con las cabeceras de seguridad. No pisa las que la ruta ya puso. Conserva estado, cuerpo y cookies. */
export function conCabecerasDeSeguridad(respuesta: Response): Response {
  const nueva = new Response(respuesta.body, respuesta);
  for (const [nombre, valor] of Object.entries(CABECERAS_API)) {
    if (!nueva.headers.has(nombre)) nueva.headers.set(nombre, valor);
  }
  return nueva;
}
