import { describe, expect, it } from 'vitest';
import { LOCAL_ACCESORIOS_ID, LOCAL_CONTROLES_ID, agregarLocalesFaltantes, localesPorDefecto } from '../../src/lib/constantes-locales';

describe('locales del modo demo', () => {
  it('son 4, con el Local de controles de tipo controles', () => {
    const locales = localesPorDefecto();
    expect(locales).toHaveLength(4);
    expect(locales.find((l) => l.id === LOCAL_CONTROLES_ID)).toMatchObject({ nombre: 'Local de controles', tipo: 'controles', activo: true });
  });

  it('un navegador con solo 3 locales recibe el cuarto sin perder el estado de las suscripciones de los demás', () => {
    const guardados = localesPorDefecto()
      .slice(0, 3)
      .map((l) => (l.id === LOCAL_ACCESORIOS_ID ? { ...l, subscription_status: 'SUSPENDED' as const } : l));
    const { locales, cambio } = agregarLocalesFaltantes(guardados);
    expect(cambio).toBe(true);
    expect(locales.map((l) => l.id)).toEqual(localesPorDefecto().map((l) => l.id));
    expect(locales[0].subscription_status).toBe('SUSPENDED');
  });

  it('con los 4 locales ya presentes no cambia nada', () => {
    const { locales, cambio } = agregarLocalesFaltantes(localesPorDefecto());
    expect(cambio).toBe(false);
    expect(locales).toHaveLength(4);
  });
});
