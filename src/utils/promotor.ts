// Datos opcionales del promotor de una venta con precio de promotor. El promotor NO es un usuario ni un empleado registrado: muchas
// veces solo acompaña al cliente a la tienda y vuelve después a cobrar, así que quien vende anota lo que sepa (cédula, nombre,
// apellido y teléfono; todo es opcional). Lo comparten el POS, el modo demo y el servidor para validar igual.
import type { DatosPromotor } from '../types/database.types';

export interface PromotorNormalizado {
  /** "V-12345678" / "E-12345678", o null si no se dio */
  cedula: string | null;
  /** Nombre y apellido juntos, o null si no se dio ninguno */
  nombre: string | null;
  /** Por separado (el directorio de promotores los guarda en dos campos) */
  nombrePropio: string;
  apellido: string;
  telefono: string | null;
  /** Banco receptor donde se le paga la comisión, o null */
  banco: string | null;
  /** Texto canónico con todo lo anterior: la autorización firmada se ata a él, para que no se cambie el promotor después de autorizar */
  clave: string;
}

export type ResultadoPromotor = { ok: true; promotor: PromotorNormalizado } | { ok: false; mensaje: string };

const PATRON_NOMBRE = /^[\p{L}][\p{L} '.-]*$/u;
const PATRON_BANCO = /^[\p{L}\p{N}][\p{L}\p{N} '.&()/-]*$/u;
/** Bancos más comunes para sugerir al escribir (el campo es libre: se puede anotar cualquier otro) */
export const BANCOS_SUGERIDOS = [
  'Banesco', 'Banco de Venezuela', 'Mercantil', 'Provincial', 'BNC', 'Bancamiga', 'Banco del Tesoro', 'Bicentenario', 'Exterior', 'Bancaribe', 'Banplus', 'Banco Caroní', 'Venezolano de Crédito', 'Binance (USDT)', 'Zelle',
];
const limpiar = (texto: string | null | undefined): string => (texto ?? '').trim().replace(/\s+/g, ' ');

export function normalizarPromotor(datos: DatosPromotor | null | undefined): ResultadoPromotor {
  let cedula: string | null = null;
  const cedulaTexto = limpiar(datos?.cedula).toUpperCase();
  if (cedulaTexto) {
    const m = /^([VE])-?(\d{5,9})$/.exec(cedulaTexto) ?? /^(\d{5,9})$/.exec(cedulaTexto);
    if (!m) return { ok: false, mensaje: 'La cédula del promotor no es válida: de 5 a 9 dígitos (puedes anteponer V- o E-).' };
    cedula = m.length === 3 ? `${m[1]}-${m[2]}` : `V-${m[1]}`;
  }

  const nombre = limpiar(datos?.nombre);
  const apellido = limpiar(datos?.apellido);
  for (const [texto, etiqueta] of [[nombre, 'nombre'], [apellido, 'apellido']] as const) {
    if (texto && (texto.length < 2 || texto.length > 60 || !PATRON_NOMBRE.test(texto))) return { ok: false, mensaje: `El ${etiqueta} del promotor no es válido (solo letras).` };
  }

  const telefono = limpiar(datos?.telefono);
  const digitos = telefono.replace(/\D/g, '');
  if (telefono && (!/^[\d\s+()-]+$/.test(telefono) || digitos.length < 10 || digitos.length > 13)) {
    return { ok: false, mensaje: 'El teléfono del promotor debe tener entre 10 y 13 dígitos (ej. 0414-1234567).' };
  }

  const banco = limpiar(datos?.banco);
  if (banco && (banco.length < 2 || banco.length > 60 || !PATRON_BANCO.test(banco))) {
    return { ok: false, mensaje: 'El banco receptor no es válido (letras y números, máximo 60 caracteres).' };
  }

  const completo = [nombre, apellido].filter(Boolean).join(' ') || null;
  // El banco NO entra en `clave`: es un dato de pago, no de identidad, y corregirlo no debe invalidar la autorización ya dada
  return {
    ok: true,
    promotor: { cedula, nombre: completo, nombrePropio: nombre, apellido, telefono: telefono || null, banco: banco || null, clave: [cedula ?? '', (completo ?? '').toLowerCase(), digitos].join('|') },
  };
}
