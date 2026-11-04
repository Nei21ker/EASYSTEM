import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { crearProducto, crearModelo } from '../../src/server/servicios/catalogo';
import { versionesVisibles, type VersionCambio } from '../../src/server/servicios/cambios';
import { guardarCuadre } from '../../src/server/servicios/cuadres';
import { registrarMovimiento } from '../../src/server/servicios/movimientos';
import { crearEmpleado } from '../../src/server/servicios/nomina';
import { registrarTasa } from '../../src/server/servicios/tasas';
import { cambiarSuscripcionLocal, crearUsuario } from '../../src/server/servicios/usuarios';
import { guardarVenta } from '../../src/server/servicios/ventas';

const env = crearEntornoDePrueba();
const { accesorios, vidrios } = IDS_LOCALES;

let sA: Sesion, sG: Sesion, sEV: Sesion, sV: Sesion, sC: Sesion, sT: Sesion;
const sesionDe = async (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));
let P: string;
let cedulas = 0;

/** "tabla@local" (local vacío = global) de todo lo que la sesión puede ver, ordenado. */
async function visibles(sesion: Sesion): Promise<string[]> {
  return (await versionesVisibles(env, sesion)).map((v: VersionCambio) => `${v.tabla}@${v.local_id ?? ''}`).sort();
}

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  const admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
  const gerente = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null });
  const encargadoVidrios = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: vidrios });
  const vendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
  const contador = await crearUsuarioDePrueba(env, { rol: 'contador', localId: null });
  const tecnico = await crearUsuarioDePrueba(env, { rol: 'tecnico', localId: accesorios });
  [sA, sG, sEV, sV, sC, sT] = await Promise.all([admin, gerente, encargadoVidrios, vendedor, contador, tecnico].map(sesionDe));
  P = (await crearProducto(env, sA, { codigo_barras: '2000000000015', nombre: 'Forro', categoria: 'Forros', precio_venta: 6 })).id;
  await env.DB.prepare('DELETE FROM cambios').run(); // línea base limpia: lo que sigue lo escribe cada prueba
});

const entrada = (localId: string) => registrarMovimiento(env, sA, { productoId: P, tipo: 'ENTRADA', cantidad: 2, localId, motivo: 'Prueba' });
const ventaEn = (sesion: Sesion, localId: string) =>
  guardarVenta(env, sesion, {
    fecha: '2026-10-20T15:00:00.000Z', local_id: localId, cliente_cedula: 'V-12345678', cliente_nombre: 'Ana', cliente_telefono: '0414-1234567',
    metodo_pago: 'USD_EFECTIVO', pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 6, monto_bs: null }], vuelto: null, total: 6,
    items: [{ producto_id: P, nombre: 'Forro', codigo_barras: '2000000000015', cantidad: 1, precio_unitario: 6, unidades: [] }],
    tasa_cambio: 36.5, total_bs: null,
  });
const empleado = (localId: string) =>
  crearEmpleado(env, sA, { local_id: localId, nombre: 'Luis', apellido: 'Mora', cedula: `V-${1000000 + ++cedulas}`, cargo: 'Cajero', salario_base: 200 });

describe('qué escrituras suben qué versiones', () => {
  it('un ingreso de mercancía sube movimientos, inventario y unidades de ESE local, y el catálogo', async () => {
    await entrada(accesorios);
    expect(await visibles(sA)).toEqual([
      `inventario_local@${accesorios}`, `movimientos_inventario@${accesorios}`, 'productos@', `unidades_producto@${accesorios}`,
    ]);
  });

  it('una venta sube las ventas del local donde se hizo, no las de otro', async () => {
    await ventaEn(sV, accesorios);
    expect(await visibles(sA)).toEqual([`ventas@${accesorios}`]);
  });

  it('crear un producto, un modelo o una tasa sube su tabla global', async () => {
    await crearProducto(env, sA, { codigo_barras: '2000000000022', nombre: 'Cable', categoria: 'Cables', precio_venta: 5 });
    await crearModelo(env, sA, { marca: 'Prueba', modelo: 'Modelo X' });
    await registrarTasa(env, sA, { fecha: '2026-10-20', tasa: 36.5 });
    expect(await visibles(sA)).toEqual(['modelos_telefono@', 'productos@', 'tasas_cambio@']);
  });

  it('una versión sube cada vez que se escribe (la consulta periódica detecta el cambio)', async () => {
    await registrarTasa(env, sA, { fecha: '2026-10-20', tasa: 36.5 });
    const antes = (await versionesVisibles(env, sA)).find((v) => v.tabla === 'tasas_cambio')!.version;
    await registrarTasa(env, sA, { fecha: '2026-10-21', tasa: 37 });
    const despues = (await versionesVisibles(env, sA)).find((v) => v.tabla === 'tasas_cambio')!.version;
    expect(despues).toBe(antes + 1);
  });

  it('crear un usuario sube perfiles y cambiar la suscripción sube locales', async () => {
    await crearUsuario(env, sA, { email: 'nuevo@prueba.test', nombre: 'Nuevo', clave: 'clave-segura-1', rol: 'vendedor', localId: vidrios });
    await cambiarSuscripcionLocal(env, sA, vidrios, 'SUSPENDED', null, false);
    expect(await visibles(sA)).toEqual(['locales@', 'perfiles@']);
  });
});

describe('qué ve cada rol', () => {
  beforeEach(async () => {
    await entrada(accesorios);
    await entrada(vidrios);
    await ventaEn(sA, vidrios);
    await empleado(accesorios);
    await guardarCuadre(env, sA, { localId: vidrios, fecha: '2026-10-20', contado: [], fotos: [], notas: null, cerrar: false });
    await registrarTasa(env, sA, { fecha: '2026-10-20', tasa: 36.5 });
  });

  it('el administrador ve todo', async () => {
    const v = await visibles(sA);
    expect(v).toEqual(expect.arrayContaining([
      `ventas@${vidrios}`, `movimientos_inventario@${accesorios}`, `cuadres_caja@${vidrios}`, `empleados@${accesorios}`, 'tasas_cambio@', 'productos@',
    ]));
  });

  it('el vendedor solo ve lo de su local y nunca nómina, empleados ni cuadres', async () => {
    const v = await visibles(sV);
    expect(v).toEqual(expect.arrayContaining([`movimientos_inventario@${accesorios}`, `inventario_local@${accesorios}`, 'productos@', 'tasas_cambio@']));
    expect(v.filter((x) => x.endsWith(`@${vidrios}`))).toEqual([]);
    expect(v.some((x) => /^(nominas|nomina_reventas|empleados|cuadres_caja)@/.test(x))).toBe(false);
  });

  it('el técnico tampoco ve nómina ni cuadres', async () => {
    expect((await visibles(sT)).some((x) => /^(nominas|nomina_reventas|empleados|cuadres_caja)@/.test(x))).toBe(false);
  });

  it('el encargado ve solo su local, con sus cuadres, y nada de nómina', async () => {
    const v = await visibles(sEV);
    expect(v).toEqual(expect.arrayContaining([`ventas@${vidrios}`, `cuadres_caja@${vidrios}`, `movimientos_inventario@${vidrios}`]));
    expect(v.filter((x) => x.endsWith(`@${accesorios}`))).toEqual([]);
    expect(v.some((x) => /^(nominas|nomina_reventas|empleados)@/.test(x))).toBe(false);
  });

  it('el contador solo ve nómina y los avisos de cuenta: ni catálogo, ni ventas, ni stock', async () => {
    await cambiarSuscripcionLocal(env, sA, vidrios, 'ACTIVE', null, false);
    const v = await visibles(sC);
    expect(v).toContain(`empleados@${accesorios}`);
    expect(v).toContain('locales@');
    expect(v.some((x) => /^(productos|tasas_cambio|ventas|movimientos_inventario|inventario_local|unidades_producto|cuadres_caja|modelos_telefono)@/.test(x))).toBe(false);
  });

  it('un local suspendido deja de verse para el gerente, pero el administrador lo sigue viendo', async () => {
    await cambiarSuscripcionLocal(env, sA, vidrios, 'SUSPENDED', null, false);
    const g = await visibles(sG);
    expect(g.some((x) => x.endsWith(`@${vidrios}`))).toBe(false);
    expect(g).toContain(`movimientos_inventario@${accesorios}`);
    expect(await visibles(sA)).toContain(`ventas@${vidrios}`);
  });

  it('si todos los locales están suspendidos, el gerente solo ve los avisos de cuenta (locales)', async () => {
    for (const id of Object.values(IDS_LOCALES)) await cambiarSuscripcionLocal(env, sA, id, 'SUSPENDED', null, false);
    expect(await visibles(sG)).toEqual(['locales@']);
  });
});
