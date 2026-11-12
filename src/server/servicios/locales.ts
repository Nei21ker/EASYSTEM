// Alta de locales (solo administrador): cada local nuevo es una sede/tienda más con su propio inventario y su propia suscripción.
// El catálogo es compartido, así que el local nuevo nace vacío y recibe mercancía por ingreso o por traslado de otro local.
import { sentenciasCambio } from '../cambios';
import { esAdministrador, type Sesion } from '../authz';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';
import { cargarLocales } from '../repos/locales';
import { nuevoId } from '../util';
import { normalizarLocalNuevo, type DatosLocal } from '../../utils/local';
import type { Local } from '../../types/database.types';

/** Cambia nombre, tipo, sede, dirección y teléfono de un local (solo administrador). La suscripción no se toca aquí. */
export async function actualizarLocal(env: Entorno, sesion: Sesion, id: string, datos: DatosLocal): Promise<Local> {
  if (!esAdministrador(sesion.rol)) throw new ErrorApi(403, 'Solo el administrador puede editar locales.', 'sin_permiso');
  const limpio = normalizarLocalNuevo(datos);
  if (typeof limpio === 'string') throw new ErrorApi(400, limpio, 'datos_invalidos');

  const existentes = await cargarLocales(env);
  if (!existentes.some((l) => l.id === id)) throw new ErrorApi(404, 'Ese local no existe.', 'no_encontrado');
  const repetido = existentes.find((l) => l.id !== id && l.nombre.trim().toLowerCase() === limpio.nombre.toLowerCase());
  if (repetido) throw new ErrorApi(409, `Ya existe un local llamado «${repetido.nombre}».`, 'local_repetido');

  await env.DB.batch([
    env.DB.prepare('UPDATE locales SET nombre = ?, tipo = ?, sede = ?, direccion = ?, telefono = ? WHERE id = ?').bind(limpio.nombre, limpio.tipo, limpio.sede, limpio.direccion, limpio.telefono, id),
    ...sentenciasCambio(env.DB, ['locales'], null),
  ]);
  const editado = (await cargarLocales(env)).find((l) => l.id === id);
  if (!editado) throw new ErrorApi(500, 'No se pudo leer el local editado.', 'error_interno');
  return editado;
}

export async function crearLocal(env: Entorno, sesion: Sesion, datos: DatosLocal): Promise<Local> {
  if (!esAdministrador(sesion.rol)) throw new ErrorApi(403, 'Solo el administrador puede agregar locales.', 'sin_permiso');
  const limpio = normalizarLocalNuevo(datos);
  if (typeof limpio === 'string') throw new ErrorApi(400, limpio, 'datos_invalidos');

  const existentes = await cargarLocales(env);
  const repetido = existentes.find((l) => l.nombre.trim().toLowerCase() === limpio.nombre.toLowerCase());
  if (repetido) throw new ErrorApi(409, `Ya existe un local llamado «${repetido.nombre}».`, 'local_repetido');

  const id = nuevoId();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO locales (id, nombre, tipo, sede, direccion, telefono) VALUES (?, ?, ?, ?, ?, ?)').bind(id, limpio.nombre, limpio.tipo, limpio.sede, limpio.direccion, limpio.telefono),
    ...sentenciasCambio(env.DB, ['locales'], null),
  ]);
  const creado = (await cargarLocales(env)).find((l) => l.id === id);
  if (!creado) throw new ErrorApi(500, 'No se pudo leer el local recién creado.', 'error_interno');
  return creado;
}
