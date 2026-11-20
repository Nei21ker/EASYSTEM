import { expect, it } from 'vitest';
import { usaInicioCompacto } from '../../src/lib/inicio';
import { LOCAL_ACCESORIOS_ID, LOCAL_CONTROLES_ID } from '../../src/lib/constantes-locales';

it.each(['administrador', 'gerente'] as const)('muestra el inicio completo en Accesorios para %s', (rol) => {
  expect(usaInicioCompacto(LOCAL_ACCESORIOS_ID, rol)).toBe(false);
});

it.each(['supervisor', 'encargado', 'vendedor'] as const)('mantiene el inicio compacto de Accesorios para %s', (rol) => {
  expect(usaInicioCompacto(LOCAL_ACCESORIOS_ID, rol)).toBe(true);
  expect(usaInicioCompacto(LOCAL_CONTROLES_ID, rol)).toBe(false);
});
