import { describe, expect, it } from 'vitest';
import { enlaceVisible, enlacesNav } from '../../src/lib/navLinks';

const enlace = (href: string) => enlacesNav.find((e) => e.href === href)!;
const modelos = enlace('/modelos');

describe('Modelos de teléfono en el local de controles', () => {
  it('el encargado y el vendedor del Local de controles no lo ven', () => {
    expect(enlaceVisible(modelos, 'encargado', 'controles', false)).toBe(false);
    expect(enlaceVisible(modelos, 'vendedor', 'controles', false)).toBe(false);
  });

  it('en los demás locales el encargado y el vendedor siguen viéndolo', () => {
    for (const tipo of ['accesorios', 'servicio_tecnico'] as const) {
      expect(enlaceVisible(modelos, 'encargado', tipo, false)).toBe(true);
      expect(enlaceVisible(modelos, 'vendedor', tipo, false)).toBe(true);
    }
  });

  it('el administrador y el gerente lo ven siempre, también al mirar el Local de controles', () => {
    expect(enlaceVisible(modelos, 'administrador', 'controles', false)).toBe(true);
    expect(enlaceVisible(modelos, 'gerente', 'controles', false)).toBe(true);
    expect(enlaceVisible(modelos, 'administrador', null, true)).toBe(true);
  });
});

describe('Local Vidrios: Pendientes en lugar de Modelos de teléfono', () => {
  const pendientes = enlace('/pendientes');

  it('en el Local Vidrios nadie ve Modelos de teléfono (ni el administrador ni el gerente mientras lo miran)', () => {
    for (const rol of ['administrador', 'gerente', 'encargado', 'vendedor', 'tecnico'] as const) {
      expect(enlaceVisible(modelos, rol, 'vidrios', false)).toBe(false);
    }
  });

  it('el administrador y el gerente siguen viendo Modelos en la vista de todos los locales y en los demás locales', () => {
    expect(enlaceVisible(modelos, 'administrador', null, true)).toBe(true);
    expect(enlaceVisible(modelos, 'gerente', null, true)).toBe(true);
    expect(enlaceVisible(modelos, 'gerente', 'accesorios', false)).toBe(true);
  });

  it('Pendientes lo ven el encargado, el gerente y el administrador en el Local Vidrios (o en "Todos"); nadie más ni en otro local', () => {
    for (const rol of ['administrador', 'gerente', 'encargado'] as const) expect(enlaceVisible(pendientes, rol, 'vidrios', false)).toBe(true);
    expect(enlaceVisible(pendientes, 'administrador', null, true)).toBe(true);
    expect(enlaceVisible(pendientes, 'vendedor', 'vidrios', false)).toBe(false);
    expect(enlaceVisible(pendientes, 'tecnico', 'vidrios', false)).toBe(false);
    expect(enlaceVisible(pendientes, 'contador', 'vidrios', false)).toBe(false);
    expect(enlaceVisible(pendientes, 'encargado', 'accesorios', false)).toBe(false);
    expect(enlaceVisible(pendientes, 'gerente', 'controles', false)).toBe(false);
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

  it('el vendedor no ve ninguno de los dos y el técnico solo Movimientos', () => {
    expect(visibles('vendedor')).not.toContain('/historial-ventas');
    expect(visibles('vendedor')).not.toContain('/movimientos');
    expect(visibles('tecnico')).toContain('/movimientos');
    expect(visibles('tecnico')).not.toContain('/historial-ventas');
  });
});
