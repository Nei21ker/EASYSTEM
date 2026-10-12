import type { Rol } from './auth';

export interface EnlaceNav {
  href: string;
  etiqueta: string;
  icono: string;
  /** Si se define, el enlace solo se muestra a ese rol (los demás lo ven oculto). */
  rolMinimo?: Rol;
}

export const enlacesNav: EnlaceNav[] = [
  { href: '/', etiqueta: 'Dashboard', icono: 'M3 12l9-9 9 9M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10' },
  {
    href: '/ventas',
    etiqueta: 'Nueva Venta (POS)',
    icono: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13 5.4 5M7 13l-2.29 2.29c-.63.63-.18 1.71.71 1.71H17M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM20 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  },
  { href: '/productos', etiqueta: 'Productos', icono: 'M20 7 12 3 4 7m16 0-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' },
  {
    href: '/modelos',
    etiqueta: 'Modelos de teléfono',
    icono: 'M17 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2ZM12 18h.01',
  },
  { href: '/movimientos', etiqueta: 'Movimientos', icono: 'M3 3h18v4H3zM3 21V9h18v12M9 13h6' },
  {
    href: '/reportes',
    etiqueta: 'Reportes & Métricas',
    icono: 'M3 3v18h18M7 15v3M11 10v8M15 6v12M19 12v6',
    rolMinimo: 'administrador',
  },
  {
    href: '/usuarios',
    etiqueta: 'Usuarios',
    icono: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    rolMinimo: 'administrador',
  },
];
