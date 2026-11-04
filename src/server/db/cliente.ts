import { drizzle } from 'drizzle-orm/d1';
import type { Entorno } from '../entorno';
import * as schema from './schema';

/** Cliente Drizzle sobre el binding D1 del Worker. */
export function bd(env: Entorno) {
  return drizzle(env.DB, { schema });
}

export type Bd = ReturnType<typeof bd>;
