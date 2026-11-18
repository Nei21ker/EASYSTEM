import { describe, expect, it } from 'vitest';
import { enlaceVisible, enlacesNav } from '../../src/lib/navLinks';

const enlace = (href: string) => enlacesNav.find((e) => e.href === href)!;
it('Modelos de teléfono no aparece en el menú de ningún usuario', () => {
  expect(enlacesNav.map((e) => e.href)).not.toContain('/modelos');
});

describe('Pendientes e Inversión', () => {
  const pendientes = enlace('/pendientes');

  it('Inversión solo la ven el administrador y el gerente, en cualquier local', () => {
    const inversion = enlace('/inversion');
    for (const rol of ['administrador', 'gerente'] as const) {
      expect(enlaceVisible(inversion, rol, 'vidrios', false)).toBe(true);
      expect(enlaceVisible(inversion, rol, null, true)).toBe(true);
    }
    for (const rol of ['encargado', 'vendedor', 'tecnico', 'contador'] as const) expect(enlaceVisible(inversion, rol, 'vidrios', false)).toBe(false);
  });

  it('Pendientes lo ven el encargado, el gerente y el administrador en TODOS los locales (y en "Todos"); el vendedor, el técnico y el contador no', () => {
    for (const rol of ['administrador', 'gerente', 'encargado'] as const) {
      for (const tipo of ['vidrios', 'accesorios', 'servicio_tecnico', 'controles'] as const) expect(enlaceVisible(pendientes, rol, tipo, false)).toBe(true);
    }
    expect(enlaceVisible(pendientes, 'administrador', null, true)).toBe(true);
    expect(enlaceVisible(pendientes, 'vendedor', 'vidrios', false)).toBe(false);
    expect(enlaceVisible(pendientes, 'tecnico', 'vidrios', false)).toBe(false);
    expect(enlaceVisible(pendientes, 'contador', 'vidrios', false)).toBe(false);
    expect(enlaceVisible(pendientes, 'vendedor', 'accesorios', false)).toBe(false);
  });
});

describe('enlaceVisible: reglas que ya existían', () => {
  it('oculta lo que el rol no puede ver', () => {
    expect(enlaceVisible(enlace('/usuarios'), 'vendedor', 'accesorios', false)).toBe(false);
    expect(enlaceVisible(enlace('/usuarios'), 'gerente', null, true)).toBe(true);
  });

  it('Servicio técnico solo aparece en un local de ese tipo (o en "Todos")', () => {
    const st = enlace('/servicio-tecnico');
    expect(enlaceVisible(st, 'tecnico', 'servicio_tecnico', false)).toBe(true);
    expect(enlaceVisible(st, 'encargado', 'accesorios', false)).toBe(false);
    expect(enlaceVisible(st, 'administrador', null, true)).toBe(true);
  });
});

describe('Historial: ventas y movimientos en un solo módulo', () => {
  const visibles = (rol: Parameters<typeof enlaceVisible>[1]) => enlacesNav.filter((e) => enlaceVisible(e, rol, 'accesorios', false)).map((e) => e.href);

  it('el menú tiene un solo enlace "Historial" para la gerencia, que también queda activo en Movimientos', () => {
    const historial = enlace('/historial-ventas');
    expect(historial.etiqueta).toBe('Historial');
    expect(historial.tambienActivoEn).toContain('/movimientos');
    for (const rol of ['administrador', 'gerente', 'encargado'] as const) {
      expect(visibles(rol)).toContain('/historial-ventas');
      expect(visibles(rol)).not.toContain('/movimientos'); // ya no es un enlace aparte
    }
  });

  it('el vendedor y el técnico no ven ninguno de los dos', () => {
    for (const rol of ['vendedor', 'tecnico'] as const) {
      expect(visibles(rol)).not.toContain('/historial-ventas');
      expect(visibles(rol)).not.toContain('/movimientos');
    }
  });
});

describe('Técnico: acceso mínimo, solo el módulo de Servicio técnico', () => {
  it('en su local solo ve Servicio técnico (nada de página principal, productos, movimientos, etc.)', () => {
    const visibles = enlacesNav.filter((e) => enlaceVisible(e, 'tecnico', 'servicio_tecnico', false)).map((e) => e.href);
    expect(visibles).toEqual(['/servicio-tecnico']);
  });
});

describe('Supervisor: los módulos del encargado, en todos los locales', () => {
  const visibles = (rol: Parameters<typeof enlaceVisible>[1], tipo: Parameters<typeof enlaceVisible>[2] = 'accesorios', todos = false) =>
    enlacesNav.filter((e) => enlaceVisible(e, rol, tipo, todos)).map((e) => e.href);

  it('ve exactamente los mismos enlaces que el encargado en cada tipo de local', () => {
    for (const tipo of ['accesorios', 'vidrios', 'servicio_tecnico', 'controles'] as const) expect(visibles('supervisor', tipo)).toEqual(visibles('encargado', tipo));
  });

  it('tiene Mercancía, Pendientes, Historial y Cuadre de caja, y no Reportes, Inversión, Usuarios, Nómina, Suscripciones ni Tiempo real', () => {
    const v = visibles('supervisor', null, true);
    for (const href of ['/', '/ventas', '/historial-ventas', '/ingreso', '/productos', '/pendientes', '/cuadre']) expect(v).toContain(href);
    for (const href of ['/reportes', '/inversion', '/usuarios', '/payroll', '/admin/subscriptions', '/admin/monitoreo']) expect(v).not.toContain(href);
  });

  it('en la vista «Todos» ve Servicio técnico como el administrador', () => {
    expect(enlaceVisible(enlace('/servicio-tecnico'), 'supervisor', null, true)).toBe(true);
  });
});
