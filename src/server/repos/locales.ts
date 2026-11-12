import type { Entorno } from '../entorno';
import type { Local } from '../../types/database.types';

interface FilaLocal {
  id: string;
  nombre: string;
  tipo: Local['tipo'];
  sede: string | null;
  direccion: string | null;
  telefono: string | null;
  activo: number;
  created_at: string;
  subscription_status: NonNullable<Local['subscription_status']>;
  subscription_expires_at: string | null;
}

/** Todos los locales con la forma del tipo `Local` del cliente (activo como booleano). */
export async function cargarLocales(env: Entorno): Promise<Local[]> {
  const filas = await env.DB.prepare('SELECT * FROM locales ORDER BY created_at, nombre').all<FilaLocal>();
  return filas.results.map((f) => ({ ...f, activo: f.activo === 1 }));
}
