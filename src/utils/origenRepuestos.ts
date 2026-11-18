import { LOCAL_PANTALLAS_ID, LOCAL_SERVICIO_TECNICO_ID } from '../lib/constantes-locales';

export function otroLocalDeRepuestos(localId: string): string | null {
  if (localId === LOCAL_SERVICIO_TECNICO_ID) return LOCAL_PANTALLAS_ID;
  if (localId === LOCAL_PANTALLAS_ID) return LOCAL_SERVICIO_TECNICO_ID;
  return null;
}

export function permiteOrigenRepuesto(localOrden: string, origen: string, categoria: string): boolean {
  if (localOrden === origen) return true;
  if (otroLocalDeRepuestos(localOrden) !== origen) return false;
  if (localOrden === LOCAL_SERVICIO_TECNICO_ID) return true;
  const tipo = categoria.trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return tipo === 'bateria' || tipo === 'baterias';
}
