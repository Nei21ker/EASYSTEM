// Clientes que ya compraron: la próxima vez que se escribe su cédula en el POS, sus datos se rellenan solos.
// Se guardan (o actualizan) en el mismo lote atómico de cada venta (ver guardarVenta). Quien puede vender puede consultarlos.
import { alcanceDe, type Sesion } from '../authz';
import type { Entorno } from '../entorno';

export interface Cliente {
  cedula: string;
  nombre: string;
  apellido: string;
  telefono: string;
}

/** Cédula en su forma de guardado: sin espacios y con la nacionalidad en mayúscula (V-12345678). */
export const normalizarCedula = (cedula: string): string => cedula.trim().replace(/\s+/g, '').toUpperCase();

/**
 * El nombre y el apellido por separado a partir de lo que trae la venta: si viene el apellido y el nombre completo termina con él,
 * lo que queda delante es el nombre; si no, todo es el nombre (el cajero lo corrige al verlo).
 */
export function separarNombre(nombreCompleto: string, apellido?: string | null): { nombre: string; apellido: string } {
  const completo = nombreCompleto.trim().replace(/\s+/g, ' ');
  const ape = (apellido ?? '').trim().replace(/\s+/g, ' ');
  if (ape && completo.length > ape.length && completo.toLowerCase().endsWith(ape.toLowerCase())) {
    return { nombre: completo.slice(0, completo.length - ape.length).trim(), apellido: completo.slice(completo.length - ape.length) };
  }
  return { nombre: completo, apellido: '' };
}

export async function buscarCliente(env: Entorno, sesion: Sesion, cedula: string): Promise<Cliente | null> {
  await alcanceDe(env, sesion); // 403 si el rol no vende (contador) o si no hay local vigente
  const clave = normalizarCedula(cedula);
  if (clave.length < 5 || clave.length > 20) return null;
  return env.DB.prepare('SELECT cedula, nombre, apellido, telefono FROM clientes WHERE cedula = ?').bind(clave).first<Cliente>();
}
