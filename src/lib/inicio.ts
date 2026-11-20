import { esGlobal, type Rol } from './auth';
import { LOCAL_ACCESORIOS_ID } from './constantes-locales';

export function usaInicioCompacto(localId?: string, rol?: Rol): boolean {
  return localId === LOCAL_ACCESORIOS_ID && !esGlobal(rol);
}
