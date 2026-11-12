/**
 * Ventas sin datos del cliente (cobro rápido del Local Vidrios).
 *
 * La tabla `ventas` exige cédula, nombre y teléfono con un largo mínimo (CHECK de la migración 0001), así que una venta sin datos
 * guarda estos valores fijos en vez de campos vacíos: no hace falta tocar la base y todo lo que lee las ventas sigue funcionando.
 * Nunca se recuerdan en `clientes` ni se usan para WhatsApp.
 */
export const CLIENTE_SIN_DATOS = {
  cedula: 'SIN-DATOS',
  nombre: 'Cliente sin datos',
  apellido: '',
  telefono: 'SIN-DATOS',
} as const;

/** ¿La venta se guardó sin datos del cliente? */
export function esClienteSinDatos(venta: { cliente_cedula?: string | null }): boolean {
  return (venta.cliente_cedula ?? '') === CLIENTE_SIN_DATOS.cedula;
}

/** ¿El cliente que llega no trae nada escrito (los tres campos vacíos)? */
export function clienteVacio(c: { cedula?: string | null; nombre?: string | null; telefono?: string | null }): boolean {
  if ((c.cedula ?? '').trim() === CLIENTE_SIN_DATOS.cedula) return true; // ya marcado como «sin datos» (cola sin conexión, demo)
  return !(c.cedula ?? '').trim() && !(c.nombre ?? '').trim() && !(c.telefono ?? '').trim();
}

/** Texto del cliente para mostrar en listas y tickets. */
export function textoCliente(venta: { cliente_nombre: string; cliente_cedula?: string | null }): string {
  return esClienteSinDatos(venta) ? 'Sin datos del cliente' : venta.cliente_nombre;
}
