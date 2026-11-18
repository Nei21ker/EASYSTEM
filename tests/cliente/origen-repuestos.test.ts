import { expect, it } from 'vitest';
import { LOCAL_PANTALLAS_ID as pantallas, LOCAL_SERVICIO_TECNICO_ID as servicio } from '../../src/lib/constantes-locales';
import { permiteOrigenRepuesto } from '../../src/utils/origenRepuestos';

it('comparte en una dirección todo el stock y en la otra solo baterías', () => {
  expect(permiteOrigenRepuesto(servicio, pantallas, 'Pantallas')).toBe(true);
  expect(permiteOrigenRepuesto(pantallas, servicio, ' Baterías ')).toBe(true);
  expect(permiteOrigenRepuesto(pantallas, servicio, 'Batería')).toBe(true);
  expect(permiteOrigenRepuesto(pantallas, servicio, 'Cargadores de batería')).toBe(false);
  expect(permiteOrigenRepuesto('otro', pantallas, 'Baterías')).toBe(false);
  expect(permiteOrigenRepuesto('otro', 'otro', 'Micas')).toBe(true);
});
