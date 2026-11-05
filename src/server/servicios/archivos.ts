// Archivos en R2.
//   · FOTOS_PUBLICAS: fotos de producto (se sirven sin sesión, con caché de un año: cada foto tiene un nombre único).
//   · FOTOS_PRIVADAS: comprobantes de nómina y fotos de cuadre de caja. NUNCA públicas: cada lectura/escritura pasa por
//     las mismas reglas de acceso que los datos a los que respaldan (comprobante_accesible, cuadre_foto_accesible,
//     cuadre_foto_editable de Postgres).
import { alcanceDe, alcanceNomina, esGerencia, esGlobal, localAccesible, type Sesion } from '../authz';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';

const MIME_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FOTO_PRODUCTO = 2 * 1024 * 1024;
const MAX_MINIATURA = 100 * 1024;
const MAX_ARCHIVO_PRIVADO = 5 * 1024 * 1024;
// La miniatura de una foto lleva el mismo nombre con -m antes de la extensión (1730000000000-m.webp)
const CLAVE_PRODUCTO = /^productos\/[A-Za-z0-9-]{1,64}\/\d{10,16}(-m)?\.(jpg|png|webp)$/;
const CLAVE_FOTO = /^productos\/([A-Za-z0-9-]{1,64})\/(\d{10,16})\.(jpg|png|webp)$/;
const RUTA_CUADRE = /^cuadres-caja\/([0-9a-f-]{36})\/(\d{4}-\d{2}-\d{2})\/[A-Z_]{3,16}-\d{1,16}-\d{1,6}\.(jpg|jpeg|png|webp)$/i;
const RUTA_COMPROBANTE = /^comprobantes-nomina\/([0-9a-f-]{36})\/[A-Za-z0-9._-]{1,120}\.(jpg|jpeg|png|webp)$/i;

const sinPermiso = (mensaje = 'No tienes permiso para ver este archivo.') => new ErrorApi(403, mensaje, 'sin_permiso');

function validarImagen(bytes: ArrayBuffer, tipoMime: string, maximo: number): void {
  if (!MIME_PERMITIDOS.includes(tipoMime)) throw new ErrorApi(400, 'Formato no admitido. Usa una foto JPG, PNG o WebP.', 'formato_invalido');
  if (bytes.byteLength === 0) throw new ErrorApi(400, 'El archivo está vacío.', 'datos_invalidos');
  if (bytes.byteLength > maximo) {
    throw new ErrorApi(400, `La imagen es demasiado grande (máximo ${Math.round(maximo / 1024 / 1024)} MB).`, 'archivo_grande');
  }
}

const extensionDe = (tipoMime: string) => (tipoMime === 'image/png' ? 'png' : tipoMime === 'image/webp' ? 'webp' : 'jpg');
const fechaReal = (texto: string) => {
  const d = new Date(`${texto}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(texto);
};

// --- Fotos de producto -----------------------------------------------------------------------------------------
async function exigirGestionCatalogo(env: Entorno, sesion: Sesion): Promise<void> {
  if (!esGerencia(sesion.rol)) throw sinPermiso('Tu rol no puede cambiar las fotos de los productos.');
  await alcanceDe(env, sesion);
}

/** Sube la foto de un producto y devuelve su URL (base pública + clave). Cada subida tiene nombre único. */
export async function subirFotoProducto(env: Entorno, sesion: Sesion, productoId: string, bytes: ArrayBuffer, tipoMime: string): Promise<string> {
  await exigirGestionCatalogo(env, sesion);
  const existe = await env.DB.prepare('SELECT 1 AS ok FROM productos WHERE id = ?').bind(productoId).first();
  if (!existe) throw new ErrorApi(404, 'Producto no encontrado.', 'no_existe');
  validarImagen(bytes, tipoMime, MAX_FOTO_PRODUCTO);

  const clave = `productos/${productoId}/${Date.now()}.${extensionDe(tipoMime)}`;
  await env.FOTOS_PUBLICAS.put(clave, bytes, { httpMetadata: { contentType: tipoMime } });
  return `${env.URL_FOTOS_PUBLICAS}/${clave}`;
}

/**
 * Sube la MINIATURA (unos 190 px, de unos pocos KB) de una foto ya subida, para que las listas no descarguen la foto grande en
 * cada fila. Va con el mismo nombre más -m y la misma extensión. Devuelve su URL.
 */
export async function subirMiniaturaProducto(env: Entorno, sesion: Sesion, productoId: string, urlFoto: string, bytes: ArrayBuffer, tipoMime: string): Promise<string> {
  await exigirGestionCatalogo(env, sesion);
  validarImagen(bytes, tipoMime, MAX_MINIATURA);
  const prefijo = `${env.URL_FOTOS_PUBLICAS}/`;
  const clave = urlFoto.startsWith(prefijo) ? urlFoto.slice(prefijo.length) : '';
  const partes = CLAVE_FOTO.exec(clave);
  if (!partes || partes[1] !== productoId) throw new ErrorApi(400, 'La foto no corresponde a este producto.', 'datos_invalidos');
  if (extensionDe(tipoMime) !== partes[3]) throw new ErrorApi(400, 'La miniatura debe ser del mismo tipo que la foto.', 'datos_invalidos');
  if (!(await env.FOTOS_PUBLICAS.head(clave))) throw new ErrorApi(400, 'La foto no corresponde a este producto: ya no existe.', 'datos_invalidos');

  const claveMiniatura = `productos/${productoId}/${partes[2]}-m.${partes[3]}`;
  await env.FOTOS_PUBLICAS.put(claveMiniatura, bytes, { httpMetadata: { contentType: tipoMime } });
  return `${prefijo}${claveMiniatura}`;
}

/** Borra el archivo al que apunta una URL de foto de producto (si es de nuestro almacenamiento; si no, no hace nada). */
export async function eliminarFotoProducto(env: Entorno, sesion: Sesion, url: string): Promise<void> {
  await exigirGestionCatalogo(env, sesion);
  const prefijo = `${env.URL_FOTOS_PUBLICAS}/`;
  if (!url.startsWith(prefijo)) return;
  const clave = decodeURIComponent(url.slice(prefijo.length).split('?')[0]);
  if (CLAVE_PRODUCTO.test(clave)) await env.FOTOS_PUBLICAS.delete([clave, clave.replace(/(-m)?(\.[a-z]+)$/, '-m$2')]); // la foto y su miniatura
}

/** Lectura sin sesión: SOLO fotos de producto. Cualquier otra clave responde 404. */
export async function leerArchivoPublico(env: Entorno, clave: string): Promise<Response> {
  if (!CLAVE_PRODUCTO.test(clave)) return new Response('No encontrado', { status: 404 });
  const objeto = await env.FOTOS_PUBLICAS.get(clave);
  // Las fotos anteriores a las miniaturas no la tienen: el cliente cae a la foto grande, y este 404 se recuerda una hora
  if (!objeto) return new Response('No encontrado', { status: 404, headers: { 'cache-control': 'public, max-age=3600' } });
  return new Response(objeto.body, {
    headers: {
      'content-type': objeto.httpMetadata?.contentType ?? 'image/jpeg',
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}

// --- Archivos privados ---------------------------------------------------------------------------------------------
type Accion = 'leer' | 'escribir';

/** Aplica las reglas de acceso de la ruta (o lanza 400 si la ruta no tiene la forma esperada). */
async function autorizarRuta(env: Entorno, sesion: Sesion, ruta: string, accion: Accion): Promise<void> {
  const cuadre = RUTA_CUADRE.exec(ruta);
  if (cuadre) {
    const [, localId, fecha] = cuadre;
    if (!fechaReal(fecha)) throw new ErrorApi(400, 'La ruta del archivo no es válida.', 'ruta_invalida');
    if (!esGerencia(sesion.rol) || !(await localAccesible(env, sesion, localId))) throw sinPermiso();
    if (accion === 'escribir' && !esGlobal(sesion.rol)) {
      const fila = await env.DB.prepare('SELECT estado FROM cuadres_caja WHERE local_id = ? AND fecha = ?').bind(localId, fecha).first<{ estado: string }>();
      if (fila?.estado === 'CERRADO') throw sinPermiso('Este cuadre ya está cerrado y no se puede modificar.');
    }
    return;
  }
  const comprobante = RUTA_COMPROBANTE.exec(ruta);
  if (comprobante) {
    try {
      await alcanceNomina(env, sesion, comprobante[1]);
    } catch (err) {
      if (err instanceof ErrorApi && err.status === 403) throw sinPermiso();
      throw err;
    }
    return;
  }
  throw new ErrorApi(400, 'La ruta del archivo no es válida.', 'ruta_invalida');
}

export async function subirArchivoPrivado(env: Entorno, sesion: Sesion, ruta: string, bytes: ArrayBuffer, tipoMime: string): Promise<void> {
  await autorizarRuta(env, sesion, ruta, 'escribir');
  validarImagen(bytes, tipoMime, MAX_ARCHIVO_PRIVADO);
  // Nunca se sobrescribe: cada archivo tiene un nombre único y un comprobante ya guardado es prueba de un pago
  const guardado = await env.FOTOS_PRIVADAS.put(ruta, bytes, { httpMetadata: { contentType: tipoMime }, onlyIf: { etagDoesNotMatch: '*' } });
  if (guardado === null) throw new ErrorApi(409, 'Ya existe un archivo con esa ruta; no se puede sobrescribir.', 'archivo_existente');
}

export async function leerArchivoPrivado(env: Entorno, sesion: Sesion, ruta: string): Promise<Response> {
  await autorizarRuta(env, sesion, ruta, 'leer');
  const objeto = await env.FOTOS_PRIVADAS.get(ruta);
  if (!objeto) throw new ErrorApi(404, 'El archivo no existe.', 'no_existe');
  return new Response(objeto.body, {
    headers: { 'content-type': objeto.httpMetadata?.contentType ?? 'image/jpeg', 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' },
  });
}

export async function borrarArchivosPrivados(env: Entorno, sesion: Sesion, rutas: string[]): Promise<void> {
  if (rutas.length > 100) throw new ErrorApi(400, 'Se pueden borrar hasta 100 archivos por petición.', 'lote_grande');
  for (const ruta of rutas) await autorizarRuta(env, sesion, ruta, 'escribir');
  // La captura de un pago PAGADO es su prueba: no se borra
  const comprobantes = rutas.filter((r) => RUTA_COMPROBANTE.test(r));
  if (comprobantes.length > 0) {
    const marcas = comprobantes.map(() => '?').join(', ');
    const ligado = await env.DB
      .prepare(`SELECT 1 AS ok FROM nominas WHERE estado_pago = 'PAGADO' AND comprobante_path IN (${marcas}) LIMIT 1`)
      .bind(...comprobantes)
      .first();
    if (ligado) throw new ErrorApi(409, 'Esa captura pertenece a un pago ya registrado como PAGADO y no se puede borrar.', 'pago_pagado');
  }
  if (rutas.length > 0) await env.FOTOS_PRIVADAS.delete(rutas);
}
