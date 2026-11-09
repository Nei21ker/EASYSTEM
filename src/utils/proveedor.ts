// Proveedor (opcional) de una mercancía que ingresa: queda en el motivo del movimiento de entrada, que es lo que muestran el
// historial y los reportes. No hay tabla de proveedores: es solo el texto que escribe quien recibe la mercancía.
export const MOTIVO_INGRESO_SIN_PROVEEDOR = 'Ingreso de mercancía';
export const MAX_PROVEEDOR = 120;

/** El motivo que se guarda en el movimiento: con proveedor ("Compra a proveedor: X") o el texto general si no se escribió ninguno. */
export function motivoDeIngreso(proveedor: string | null | undefined): string {
  const nombre = (proveedor ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_PROVEEDOR).trim();
  return nombre ? `Compra a proveedor: ${nombre}` : MOTIVO_INGRESO_SIN_PROVEEDOR;
}
