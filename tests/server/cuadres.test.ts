import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { subirArchivoPrivado } from '../../src/server/servicios/archivos';
import { calcularEsperadoCuadre, guardarCuadre, listarCuadresDelDia, obtenerCuadre, reabrirCuadre } from '../../src/server/servicios/cuadres';
import { guardarDevolucion, guardarVenta } from '../../src/server/servicios/ventas';
import type { NuevaVenta } from '../../src/types/database.types';

const env = crearEntornoDePrueba();
const { accesorios, vidrios } = IDS_LOCALES;
const DIA = '2026-10-20';
// Caracas = UTC-4: el día 3 va de 2026-10-20T04:00Z a 2026-10-21T04:00Z
const MEDIODIA = '2026-10-20T16:00:00.000Z';

let admin: UsuarioDePrueba, gerente: UsuarioDePrueba, encargadoAcc: UsuarioDePrueba, encargadoVid: UsuarioDePrueba, vendedor: UsuarioDePrueba, tecnico: UsuarioDePrueba, contador: UsuarioDePrueba;
let sA: Sesion, sG: Sesion, sEA: Sesion, sEV: Sesion, sV: Sesion, sT: Sesion, sC: Sesion;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
  gerente = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null });
  encargadoAcc = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: accesorios, nombre: 'Elena Encargada' });
  encargadoVid = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: vidrios });
  vendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
  tecnico = await crearUsuarioDePrueba(env, { rol: 'tecnico', localId: accesorios });
  contador = await crearUsuarioDePrueba(env, { rol: 'contador', localId: null });
  [sA, sG, sEA, sEV, sV, sT, sC] = await Promise.all([admin, gerente, encargadoAcc, encargadoVid, vendedor, tecnico, contador].map(sesionDe));
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

const venta = (localId: string, fecha: string, extra: Partial<NuevaVenta>): NuevaVenta => ({
  fecha, local_id: localId, cliente_cedula: 'V-12345678', cliente_nombre: 'Ana Pérez', cliente_telefono: '0414-1234567',
  metodo_pago: 'USD_EFECTIVO', pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 12, monto_bs: null }], vuelto: null, total: 12,
  items: [{ producto_id: 'p1', nombre: 'Forro', codigo_barras: '2000000000015', cantidad: 2, precio_unitario: 6 }], tasa_cambio: 36.5, total_bs: null, ...extra,
});

/** Ventas del día en Accesorios: $12 en efectivo $, Bs 365 por pago móvil ($10) y una mixta con vuelto. */
let capturas = 0;
/** Un cobro por pago móvil exige la captura del comprobante: se sube una al almacenamiento privado antes de vender. */
async function capturaPagoMovil(): Promise<string> {
  const ruta = `comprobantes-pago-movil/${accesorios}/1730000000000-${++capturas}.jpg`;
  await subirArchivoPrivado(env, sV, ruta, new Uint8Array(8).fill(3).buffer, 'image/jpeg');
  return ruta;
}

async function venderEnAccesorios() {
  await guardarVenta(env, sV, venta(accesorios, MEDIODIA, {}));
  await guardarVenta(env, sV, venta(accesorios, MEDIODIA, { comprobante_path: await capturaPagoMovil(), metodo_pago: 'BS_PAGO_MOVIL', pagos: [{ metodo: 'BS_PAGO_MOVIL', monto_usd: 10, monto_bs: 365 }], total: 10, total_bs: 365 }));
  await guardarVenta(env, sV, venta(accesorios, MEDIODIA, {
    metodo_pago: 'MIXTO', total: 20, pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 25, monto_bs: null }], vuelto: { metodo: 'USD_EFECTIVO', monto_usd: 5, monto_bs: null },
  }));
}

const fotoCuadre = (tipo: 'PAGO_MOVIL' | 'BINANCE' | 'EFECTIVO' | 'CIERRE_PUNTO', local: string = accesorios, n = 1) => ({ tipo, path: `cuadres-caja/${local}/${DIA}/${tipo}-1730000000000-${n}.jpg` });

describe('calcularEsperadoCuadre (lo calcula el servidor)', () => {
  it('suma lo cobrado por tipo de cobro, neto de vuelto, solo de ese local y de ese día', async () => {
    await venderEnAccesorios();
    await guardarVenta(env, sA, venta(vidrios, MEDIODIA, {})); // otro local
    const esperado = await calcularEsperadoCuadre(env, sEA, accesorios, DIA);
    const efectivo = esperado.find((e) => e.metodo === 'USD_EFECTIVO')!;
    const movil = esperado.find((e) => e.metodo === 'BS_PAGO_MOVIL')!;
    expect(efectivo).toMatchObject({ ventas: 2, usd: 32 }); // 12 + (25 - 5 de vuelto)
    expect(movil).toMatchObject({ ventas: 1, usd: 10, bs: 365 });
    expect(esperado).toHaveLength(5);
  });

  it('el día es el del negocio (Caracas), no el de UTC', async () => {
    await guardarVenta(env, sV, venta(accesorios, '2026-10-21T02:00:00.000Z', {})); // 22:00 del día 3 en Caracas
    await guardarVenta(env, sV, venta(accesorios, '2026-10-21T04:00:00.000Z', {})); // ya es el día 4
    await guardarVenta(env, sV, venta(accesorios, '2026-10-20T03:59:00.000Z', {})); // todavía es el día 2
    expect((await calcularEsperadoCuadre(env, sEA, accesorios, DIA)).find((e) => e.metodo === 'USD_EFECTIVO')!.ventas).toBe(1);
  });

  it('resta los reembolsos de las devoluciones hechas ese día', async () => {
    const v = await guardarVenta(env, sV, venta(accesorios, MEDIODIA, {}));
    await guardarDevolucion(env, sEA, {
      fecha: '2026-10-20T18:00:00.000Z', local_id: accesorios, venta_id: v.id, venta_folio: v.folio, motivo: 'No le quedó',
      items_devueltos: v.items.map((i) => ({ ...i, cantidad: 1 })), items_nuevos: [], total_devuelto: 6, total_nuevo: 0, diferencia: -6, tasa_cambio: 36.5,
      pagos: null, vuelto: null, reembolso: { metodo: 'USD_EFECTIVO', monto_usd: 6, monto_bs: null },
    });
    expect((await calcularEsperadoCuadre(env, sEA, accesorios, DIA)).find((e) => e.metodo === 'USD_EFECTIVO')!.usd).toBe(6);
  });

  it('quién puede consultarlo', async () => {
    await calcularEsperadoCuadre(env, sG, vidrios, DIA);
    await rechazo(calcularEsperadoCuadre(env, sEV, accesorios, DIA), 403);
    await rechazo(calcularEsperadoCuadre(env, sV, accesorios, DIA), 403);
    await rechazo(calcularEsperadoCuadre(env, sC, accesorios, DIA), 403);
  });

  it('una fecha inválida se rechaza', async () => {
    await rechazo(calcularEsperadoCuadre(env, sA, accesorios, '03/11/2026'), 400);
  });
});

describe('guardar el borrador', () => {
  it('crea el cuadre con lo esperado calculado por el servidor y lo contado por la persona', async () => {
    await venderEnAccesorios();
    const c = await guardarCuadre(env, sEA, { localId: accesorios, fecha: DIA, contado: [{ metodo: 'USD_EFECTIVO', monto: 30 }], fotos: [], notas: '  faltó $2  ', cerrar: false });
    expect(c).toMatchObject({ local_id: accesorios, fecha: DIA, estado: 'ABIERTO', notas: 'faltó $2', registrado_nombre: 'Elena Encargada', cerrado_en: null, cerrado_por: null });
    expect(c.contado).toEqual([{ metodo: 'USD_EFECTIVO', monto: 30 }]);
    expect(c.esperado.find((e) => e.metodo === 'USD_EFECTIVO')!.usd).toBe(32);
  });

  it('un segundo guardado el mismo día actualiza el mismo cuadre', async () => {
    const a = await guardarCuadre(env, sEA, { localId: accesorios, fecha: DIA, contado: [], fotos: [], notas: null, cerrar: false });
    const b = await guardarCuadre(env, sG, { localId: accesorios, fecha: DIA, contado: [{ metodo: 'BINANCE_USDT', monto: 5 }], fotos: [], notas: 'revisado', cerrar: false });
    expect(b.id).toBe(a.id);
    expect(b.registrado_nombre).toBe('Elena Encargada');
    expect(b.contado).toEqual([{ metodo: 'BINANCE_USDT', monto: 5 }]);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM cuadres_caja').first<{ n: number }>())?.n).toBe(1);
  });

  it('valida fechas futuras, montos y notas', async () => {
    const base = { localId: accesorios, fecha: DIA, contado: [], fotos: [], notas: null, cerrar: false };
    await rechazo(guardarCuadre(env, sEA, { ...base, fecha: '2099-01-01' }), 400, /día futuro/);
    await rechazo(guardarCuadre(env, sEA, { ...base, contado: [{ metodo: 'USD_EFECTIVO', monto: -1 }] }), 400, /negativos/);
    await rechazo(guardarCuadre(env, sEA, { ...base, contado: [{ metodo: 'CHEQUE' as never, monto: 1 }] }), 400);
    await rechazo(guardarCuadre(env, sEA, { ...base, notas: 'x'.repeat(1001) }), 400);
  });

  it('las fotos solo pueden ser de ese local y ese día', async () => {
    const base = { localId: accesorios, fecha: DIA, contado: [], notas: null, cerrar: false };
    await rechazo(guardarCuadre(env, sEA, { ...base, fotos: [fotoCuadre('EFECTIVO', vidrios)] }), 400, /fotos/i);
    await rechazo(guardarCuadre(env, sEA, { ...base, fotos: [{ tipo: 'EFECTIVO', path: `cuadres-caja/${accesorios}/2026-11-02/EFECTIVO-1-1.jpg` }] }), 400, /fotos/i);
    await rechazo(guardarCuadre(env, sEA, { ...base, fotos: [{ tipo: 'OTRA' as never, path: fotoCuadre('EFECTIVO').path }] }), 400);
    const ok = await guardarCuadre(env, sEA, { ...base, fotos: [fotoCuadre('EFECTIVO')] });
    expect(ok.fotos).toEqual([fotoCuadre('EFECTIVO')]);
  });

  it('sube la versión de cuadres_caja en ese local', async () => {
    await env.DB.prepare('DELETE FROM cambios').run();
    await guardarCuadre(env, sEA, { localId: accesorios, fecha: DIA, contado: [], fotos: [], notas: null, cerrar: false });
    expect(await env.DB.prepare('SELECT tabla, local_id, version FROM cambios').all()).toMatchObject({ results: [{ tabla: 'cuadres_caja', local_id: accesorios, version: 1 }] });
  });
});

describe('cerrar el cuadre', () => {
  it('exige contar cada tipo de cobro con movimiento y una foto de cada grupo con movimiento', async () => {
    await venderEnAccesorios(); // efectivo $ y pago móvil
    const base = { localId: accesorios, fecha: DIA, notas: null, cerrar: true };
    await rechazo(guardarCuadre(env, sEA, { ...base, contado: [], fotos: [] }), 400, 'Escribe cuánto hay en "Bolívares · Pago móvil" (el sistema esperaba Bs. 365.00).');
    const contado = [{ metodo: 'BS_PAGO_MOVIL' as const, monto: 365 }, { metodo: 'USD_EFECTIVO' as const, monto: 32 }];
    await rechazo(guardarCuadre(env, sEA, { ...base, contado, fotos: [] }), 400, 'Falta al menos una foto en "Capturas de pagos móviles".');
    await rechazo(guardarCuadre(env, sEA, { ...base, contado, fotos: [fotoCuadre('PAGO_MOVIL')] }), 400, 'Falta al menos una foto en "Efectivo".');
    const cerrado = await guardarCuadre(env, sEA, { ...base, contado, fotos: [fotoCuadre('PAGO_MOVIL'), fotoCuadre('EFECTIVO'), fotoCuadre('EFECTIVO', accesorios, 2)] });
    expect(cerrado).toMatchObject({ estado: 'CERRADO', cerrado_por: 'Elena Encargada' });
    expect(cerrado.cerrado_en).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(cerrado.fotos).toHaveLength(3);
  });

  it('un día sin ventas se cierra sin fotos (nada que respaldar), aunque haya diferencia', async () => {
    const c = await guardarCuadre(env, sEV, { localId: vidrios, fecha: DIA, contado: [{ metodo: 'USD_EFECTIVO', monto: 3 }], fotos: [], notas: 'sobraron $3', cerrar: true });
    expect(c.estado).toBe('CERRADO');
  });

  it('un cuadre cerrado ya no se modifica ni por el administrador (hay que reabrirlo)', async () => {
    await guardarCuadre(env, sEV, { localId: vidrios, fecha: DIA, contado: [], fotos: [], notas: null, cerrar: true });
    await rechazo(guardarCuadre(env, sEV, { localId: vidrios, fecha: DIA, contado: [], fotos: [], notas: 'otra', cerrar: false }), 409, 'Este cuadre ya está cerrado y no se puede modificar.');
    await rechazo(guardarCuadre(env, sA, { localId: vidrios, fecha: DIA, contado: [], fotos: [], notas: 'otra', cerrar: false }), 409, 'Este cuadre ya está cerrado y no se puede modificar.');
  });

  it('el cuadre cerrado conserva lo que el sistema esperaba al cerrarlo, aunque haya ventas después', async () => {
    await venderEnAccesorios();
    const contado = [{ metodo: 'BS_PAGO_MOVIL' as const, monto: 365 }, { metodo: 'USD_EFECTIVO' as const, monto: 32 }];
    await guardarCuadre(env, sEA, { localId: accesorios, fecha: DIA, contado, fotos: [fotoCuadre('PAGO_MOVIL'), fotoCuadre('EFECTIVO')], notas: null, cerrar: true });
    await guardarVenta(env, sV, venta(accesorios, '2026-10-20T20:00:00.000Z', {}));
    const guardado = await obtenerCuadre(env, sEA, accesorios, DIA);
    expect(guardado!.esperado.find((e) => e.metodo === 'USD_EFECTIVO')!.usd).toBe(32);
  });
});

describe('reabrir', () => {
  it('solo el administrador y el gerente; el cuadre vuelve a borrador y se puede corregir', async () => {
    await guardarCuadre(env, sEV, { localId: vidrios, fecha: DIA, contado: [], fotos: [], notas: null, cerrar: true });
    await rechazo(reabrirCuadre(env, sEV, vidrios, DIA), 403);
    const r = await reabrirCuadre(env, sG, vidrios, DIA);
    expect(r).toMatchObject({ estado: 'ABIERTO', cerrado_en: null, cerrado_por: null });
    const corregido = await guardarCuadre(env, sEV, { localId: vidrios, fecha: DIA, contado: [], fotos: [], notas: 'corregido', cerrar: true });
    expect(corregido).toMatchObject({ estado: 'CERRADO', notas: 'corregido' });
  });

  it('un cuadre que no existe o no está cerrado se rechaza', async () => {
    await rechazo(reabrirCuadre(env, sA, vidrios, DIA), 404);
    await guardarCuadre(env, sEV, { localId: vidrios, fecha: DIA, contado: [], fotos: [], notas: null, cerrar: false });
    await rechazo(reabrirCuadre(env, sA, vidrios, DIA), 409, /no está cerrado/);
  });
});

describe('quién ve y quién hace cada cuadre', () => {
  const borrador = (localId: string) => ({ localId, fecha: DIA, contado: [], fotos: [], notas: null, cerrar: false });

  it('el encargado hace el de SU local, no el de otro; vendedor, técnico y contador ninguno', async () => {
    await guardarCuadre(env, sEA, borrador(accesorios));
    await rechazo(guardarCuadre(env, sEA, borrador(vidrios)), 403);
    await rechazo(guardarCuadre(env, sV, borrador(accesorios)), 403);
    await rechazo(guardarCuadre(env, sT, borrador(accesorios)), 403);
    await rechazo(guardarCuadre(env, sC, borrador(accesorios)), 403);
  });

  it('el administrador y el gerente hacen y ven los de todos los locales', async () => {
    await guardarCuadre(env, sA, borrador(accesorios));
    await guardarCuadre(env, sG, borrador(vidrios));
    expect((await listarCuadresDelDia(env, sA, DIA)).map((c) => c.local_id).sort()).toEqual([accesorios, vidrios].sort());
    expect(await listarCuadresDelDia(env, sG, DIA)).toHaveLength(2);
  });

  it('el encargado solo ve el de su local; los demás roles reciben 403', async () => {
    await guardarCuadre(env, sA, borrador(accesorios));
    await guardarCuadre(env, sA, borrador(vidrios));
    expect((await listarCuadresDelDia(env, sEA, DIA)).map((c) => c.local_id)).toEqual([accesorios]);
    expect(await obtenerCuadre(env, sEA, accesorios, DIA)).not.toBeNull();
    await rechazo(obtenerCuadre(env, sEA, vidrios, DIA), 403);
    await rechazo(listarCuadresDelDia(env, sV, DIA), 403);
    await rechazo(listarCuadresDelDia(env, sC, DIA), 403);
  });

  it('un día sin cuadre devuelve null', async () => {
    expect(await obtenerCuadre(env, sA, accesorios, DIA)).toBeNull();
    expect(await listarCuadresDelDia(env, sA, DIA)).toEqual([]);
  });

  it('un local suspendido bloquea al encargado y al gerente, no al administrador', async () => {
    await env.DB.prepare("UPDATE locales SET subscription_status = 'SUSPENDED' WHERE id = ?").bind(accesorios).run();
    await rechazo(guardarCuadre(env, sEA, borrador(accesorios)), 403);
    await rechazo(guardarCuadre(env, sG, borrador(accesorios)), 403);
    await guardarCuadre(env, sA, borrador(accesorios));
  });
});
