// Teléfono del cliente en el formato de WhatsApp. El ticket en sí se manda como imagen (ticketImagen.ts); aquí solo se arma el enlace al chat.

/** Código de país por defecto de los teléfonos que se escriben sin él (Venezuela). */
export const CODIGO_PAIS_POR_DEFECTO = '58';

/**
 * El teléfono como lo pide WhatsApp: solo dígitos, con el código de país y sin ceros de marcación (584141234567).
 * Acepta "0414-1234567", "(0414) 123 4567", "+58 414 1234567", "4141234567"… Un número con "+" o "00" de otro país se respeta.
 * Devuelve null si no parece un teléfono válido (menos de 10 o más de 15 dígitos).
 */
export function telefonoParaWhatsApp(telefono: string, codigoPais: string = CODIGO_PAIS_POR_DEFECTO): string | null {
  const limpio = telefono.trim();
  let digitos = limpio.replace(/\D/g, '');
  if (!digitos) return null;

  if (limpio.startsWith('+')) {
    // Ya viene con su código de país
  } else if (digitos.startsWith('00')) {
    digitos = digitos.slice(2);
  } else if (digitos.startsWith('0')) {
    digitos = codigoPais + digitos.replace(/^0+/, ''); // 0414… → 58414…
  } else if (!digitos.startsWith(codigoPais) || digitos.length <= 10) {
    digitos = codigoPais + digitos; // 4141234567 → 584141234567
  }
  return digitos.length >= 10 && digitos.length <= 15 ? digitos : null;
}

/** Enlace que abre WhatsApp en el chat de ese número (sin texto: el ticket va como imagen); null si el teléfono no sirve. */
export function urlWhatsApp(telefono: string): string | null {
  const numero = telefonoParaWhatsApp(telefono);
  return numero ? `https://wa.me/${numero}` : null;
}
