// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { configurarBusquedaRepuestos } from '../../src/utils/busquedaRepuestos';

it('mantiene el buscador arriba al enfocar una cantidad y vuelve a los repuestos usados al terminar', () => {
  document.body.innerHTML = '<dialog open><input type="search"><input type="number"><button>Volver</button><p tabindex="-1">Repuestos usados</p></dialog>';
  const dialogo = document.querySelector('dialog')!;
  const [buscar, cantidad] = dialogo.querySelectorAll('input');
  const volver = dialogo.querySelector('button')!;
  const titulo = dialogo.querySelector('p')!;
  titulo.scrollIntoView = vi.fn();
  const completar = configurarBusquedaRepuestos(dialogo, buscar, volver, titulo, () => true);

  buscar.focus();
  expect(dialogo.dataset.buscandoRepuesto).toBe('true');
  cantidad.focus();
  expect(dialogo.dataset.buscandoRepuesto).toBe('true');
  completar();
  expect(dialogo.dataset.buscandoRepuesto).toBeUndefined();
  expect(document.activeElement).toBe(titulo);
  expect(titulo.scrollIntoView).toHaveBeenCalled();
});

it('con ratón conserva el formulario completo', () => {
  document.body.innerHTML = '<dialog open><input type="search"><button>Volver</button><p>Repuestos usados</p></dialog>';
  const dialogo = document.querySelector('dialog')!;
  const buscar = dialogo.querySelector('input')!;
  configurarBusquedaRepuestos(dialogo, buscar, dialogo.querySelector('button')!, dialogo.querySelector('p')!, () => false);
  buscar.focus();
  expect(dialogo.dataset.buscandoRepuesto).toBeUndefined();
});
