// Ayudantes compartidos por las pruebas del servidor.
import { env } from 'cloudflare:workers';
import type { Entorno } from '../../src/server/entorno';

export function crearEntornoDePrueba(): Entorno {
  return env as unknown as Entorno;
}
