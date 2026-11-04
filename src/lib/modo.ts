// Modo de datos de la interfaz: con PUBLIC_USAR_API=true todo va al servidor (Cloudflare Worker + D1);
// sin esa variable el sistema funciona con LocalStorage (modo demo, sin servidor ni cuentas reales).
export const modoServidor: boolean = import.meta.env.PUBLIC_USAR_API === 'true';
