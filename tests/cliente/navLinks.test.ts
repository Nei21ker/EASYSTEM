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
    for (const tipo of ['accesorios', 'vidrios', 'servicio_tecnico'] as const) {
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
