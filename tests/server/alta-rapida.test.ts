// Alta rápida: crea muchos productos de una vez con solo nombre, categoría y precio. El código de barras interno lo genera el servidor.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { crearProducto, crearProductosRapidos, listarProductos } from '../../src/server/servicios/catalogo';
import { esCodigoInterno } from '../../src/utils/codigos';

const env = crearEntornoDePrueba();
const { accesorios } = IDS_LOCALES;

let admin: UsuarioDePrueba, gerente: UsuarioDePrueba, encargado: UsuarioDePrueba, vendedor: UsuarioDePrueba, contador: UsuarioDePrueba;
let sA: Sesion, sG: Sesion, sE: Sesion, sV: Sesion, sC: Sesion;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
  gerente = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null });
  encargado = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: accesorios });
  vendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
  contador = await crearUsuarioDePrueba(env, { rol: 'contador', localId: null });
  [sA, sG, sE, sV, sC] = await Promise.all([admin, gerente, encargado, vendedor, contador].map(sesionDe));
});

async function rechazo(promesa: Promise<unknown>, status: number, texto?: string | RegExp): Promise<void> {
  try {
    await promesa;
  } catch (err) {
    expect(err).toBeInstanceOf(ErrorApi);
    expect((err as ErrorApi).status).toBe(status);
    if (texto) expect((err as ErrorApi).message).toMatch(texto);
    return;
  }
  throw new Error('Debía rechazarse y no se rechazó');
}

const fila = (nombre: string, extra: Record<string, unknown> = {}) => ({ nombre, categoria: 'Controles', precio_venta: 8, ...extra });

describe('crearProductosRapidos', () => {
  it('crea todos los productos con código de barras interno válido, referencia y stock mínimo 0', async () => {
    const creados = await crearProductosRapidos(env, sA, [fila('Control A/C Samsung'), fila('Control A/C LG'), fila('Control Roku', { precio_venta: 12.5 })]);
    expect(creados).toHaveLength(3);
    expect(new Set(creados.map((c) => c.codigo_barras)).size).toBe(3);
    expect(creados.every((c) => esCodigoInterno(c.codigo_barras))).toBe(true);
    expect(creados.every((c) => /^[A-Z]{2,4}-\d{3,}$/.test(c.referencia))).toBe(true);

    const guardados = await listarProductos(env, sA);
    expect(guardados).toHaveLength(3);
    const roku = guardados.find((p) => p.nombre === 'Control Roku')!;
    expect(roku).toMatchObject({ categoria: 'Controles', precio_venta: 12.5, precio_compra: 0, stock_minimo: 0, stock_actual: 0 });
  });

  it('el prefijo indicado se aplica a todos y comparten la numeración; sin prefijo se sugiere', async () => {
    const creados = await crearProductosRapidos(env, sA, [fila('Control A/C Samsung', { prefijo_codigo: 'ctl' }), fila('Control A/C LG', { prefijo_codigo: 'CTL' })]);
    expect(creados.map((c) => c.prefijo_codigo)).toEqual(['CTL', 'CTL']);
    expect(creados.map((c) => c.referencia)).toEqual(['CTL-001', 'CTL-002']);
    const sugerido = await crearProductosRapidos(env, sA, [fila('Cable HDMI', { categoria: 'Cables' })]);
    expect(sugerido[0].prefijo_codigo).toBe('CAB');
  });

  it('los códigos siguen a continuación de los productos que ya existían (también en tandas sucesivas)', async () => {
    const previo = await crearProducto(env, sA, { codigo_barras: '2000000000015', nombre: 'Previo', categoria: 'Cables', precio_venta: 1 });
    const a = await crearProductosRapidos(env, sA, [fila('Control uno'), fila('Control dos')]);
    const b = await crearProductosRapidos(env, sA, [fila('Control tres')]);
    const todos = [previo.codigo_barras, ...a.map((c) => c.codigo_barras), ...b.map((c) => c.codigo_barras)];
    expect(new Set(todos).size).toBe(4);
    expect(a[0].codigo_barras).toBe('2000000000022');
  });

  it('el encargado también puede, pero el precio de compra siempre queda en 0', async () => {
    await crearProductosRapidos(env, sE, [fila('Control LG', { precio_compra: 3 })]);
    await crearProductosRapidos(env, sG, [fila('Control Sony', { precio_compra: 3 })]);
    const guardados = await listarProductos(env, sA);
    expect(guardados.find((p) => p.nombre === 'Control LG')!.precio_compra).toBe(0);
    expect(guardados.find((p) => p.nombre === 'Control Sony')!.precio_compra).toBe(3);
  });

  it('vendedor y contador no pueden crear productos', async () => {
    await rechazo(crearProductosRapidos(env, sV, [fila('Control LG')]), 403);
    await rechazo(crearProductosRapidos(env, sC, [fila('Control LG')]), 403);
  });

  it('valida: nombre y categoría obligatorios, precio ≥ 0, prefijo de 2 a 4 letras; si una fila falla no se crea ninguna', async () => {
    await rechazo(crearProductosRapidos(env, sA, [fila('Control bueno'), fila('   ')]), 400, /nombre/i);
    await rechazo(crearProductosRapidos(env, sA, [fila('Control LG', { categoria: ' ' })]), 400, /categor/i);
    await rechazo(crearProductosRapidos(env, sA, [fila('Control LG', { precio_venta: -1 })]), 400, /precio/i);
    await rechazo(crearProductosRapidos(env, sA, [fila('Control LG', { prefijo_codigo: 'C' })]), 400, /prefijo/i);
    await rechazo(crearProductosRapidos(env, sA, [fila('A'.repeat(121))]), 400, /largo/i);
    expect(await listarProductos(env, sA)).toEqual([]);
  });

  it('acepta hasta 100 por petición y rechaza más; una lista vacía no hace nada', async () => {
    const cien = Array.from({ length: 100 }, (_, i) => fila(`Control número ${i}`));
    expect(await crearProductosRapidos(env, sA, cien)).toHaveLength(100);
    await rechazo(crearProductosRapidos(env, sA, [...cien, fila('Uno más')]), 400, /hasta 100/i);
    expect(await crearProductosRapidos(env, sA, [])).toEqual([]);
  });
});
