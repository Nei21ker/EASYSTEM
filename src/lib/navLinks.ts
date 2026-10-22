import type { Rol } from './auth';
import type { TipoLocal } from '../types/database.types';

export interface EnlaceNav {
  href: string;
  etiqueta: string;
  icono: string;
  /** Roles que ven el enlace (el resto lo tiene oculto). La página vuelve a exigirlo con protegerPagina. */
  roles: Rol[];
  /** Si se define, el enlace solo se muestra cuando el local activo es de ese tipo (el administrador, que ve "Todos", también lo ve). */
  soloTipoLocal?: TipoLocal;
}

const TODOS: Rol[] = ['administrador', 'gerente', 'encargado', 'vendedor', 'tecnico'];
/** Todo menos el vendedor (no ve Ventas realizadas ni Movimientos) */
const SIN_VENDEDOR: Rol[] = ['administrador', 'gerente', 'encargado', 'tecnico'];
const GERENCIA: Rol[] = ['administrador', 'gerente', 'encargado'];
const CAJA: Rol[] = ['administrador', 'gerente', 'encargado', 'vendedor'];

export const enlacesNav: EnlaceNav[] = [
  { href: '/', etiqueta: 'Dashboard', icono: 'M3 12l9-9 9 9M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10', roles: TODOS },
  {
    href: '/ventas',
    etiqueta: 'Nueva Venta (POS)',
    icono: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13 5.4 5M7 13l-2.29 2.29c-.63.63-.18 1.71.71 1.71H17M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM20 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
    roles: CAJA,
  },
  {
    href: '/historial-ventas',
    etiqueta: 'Ventas realizadas',
    icono: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5h6M9 12h6M9 16h4',
    roles: GERENCIA,
  },
  {
    href: '/servicio-tecnico',
    etiqueta: 'Servicio técnico',
    icono: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
    roles: TODOS,
    soloTipoLocal: 'servicio_tecnico',
  },
  {
    href: '/ingreso',
    etiqueta: 'Ingreso de mercancía',
    icono: 'M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
    roles: GERENCIA,
  },
  { href: '/productos', etiqueta: 'Productos', icono: 'M20 7 12 3 4 7m16 0-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', roles: TODOS },
  {
    href: '/modelos',
    etiqueta: 'Modelos de teléfono',
    icono: 'M17 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2ZM12 18h.01',
    roles: TODOS,
  },
  { href: '/movimientos', etiqueta: 'Movimientos', icono: 'M3 3h18v4H3zM3 21V9h18v12M9 13h6', roles: SIN_VENDEDOR },
  {
    href: '/reportes',
    etiqueta: 'Reportes y cuadre',
    icono: 'M3 3v18h18M7 15v3M11 10v8M15 6v12M19 12v6',
    roles: ['administrador', 'gerente'],
  },
  {
    // El encargado solo ve el cuadre de su local (sin reportes); administrador y gerente lo tienen dentro de Reportes y cuadre
    href: '/cuadre',
    etiqueta: 'Cuadre de caja',
    icono: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM8 7h8M8 11h2m4 0h2M8 15h2m4 0h2',
    roles: ['encargado'],
  },
  {
    href: '/usuarios',
    etiqueta: 'Usuarios',
    icono: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    roles: ['administrador', 'gerente'],
  },
  {
    href: '/payroll',
    etiqueta: 'Nómina',
    icono: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
    roles: ['administrador', 'gerente', 'contador'],
  },
  {
    href: '/admin/subscriptions',
    etiqueta: 'Suscripciones',
    icono: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Zm-3.5-10 2.5 2.5 4.5-5',
    roles: ['administrador'],
  },
];
