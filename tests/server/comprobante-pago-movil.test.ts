// Comprobante del pago móvil: toda venta del POS con un cobro "Bs pago móvil" exige la referencia de 4 dígitos (ya no se pide foto).
// Las capturas de ventas anteriores siguen guardadas en el almacenamiento PRIVADO y solo las ve la gerencia del local.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { borrarArchivosPrivados, leerArchivoPrivado, subirArchivoPrivado } from '../../src/server/servicios/archivos';
import { guardarVenta, listarVentas } from '../../src/server/servicios/ventas';
import type { NuevaVenta } from '../../src/types/database.types';

const env = crearEntornoDePrueba();
const { accesorios, vidrios } = IDS_LOCALES;

let admin: UsuarioDePrueba, gerente: UsuarioDePrueba, encargadoAcc: UsuarioDePrueba, encargadoVid: UsuarioDePrueba, vendedor: UsuarioDePrueba, contador: UsuarioDePrueba;
let sA: Sesion, sG: Sesion, sEA: Sesion, sEV: Sesion, sV: Sesion, sC: Sesion;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
  gerente = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null });
  encargadoAcc = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: accesorios });
  encargadoVid = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: vidrios });
  vendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
  contador = await crearUsuarioDePrueba(env, { rol: 'contador', localId: null });
  [sA, sG, sEA, sEV, sV, sC] = await Promise.all([admin, gerente, encargadoAcc, encargadoVid, vendedor, contador].map(sesionDe));
  const lista = await env.FOTOS_PRIVADAS.list();
  await Promise.all(lista.objects.map((o) => env.FOTOS_PRIVADAS.delete(o.key)));
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

let contador_ = 0;
const rutaCaptura = (local: string = accesorios) => `comprobantes-pago-movil/${local}/1730000000000-${++contador_}.jpg`;
const bytes = () => new Uint8Array(12).fill(9).buffer;
const subir = async (sesion: Sesion, local: string = accesorios) => {
  const ruta = rutaCaptura(local);
  await subirArchivoPrivado(env, sesion, ruta, bytes(), 'image/jpeg');
  return ruta;
};

const ventaPagoMovil = (extra: Partial<NuevaVenta> = {}): NuevaVenta => ({
  fecha: '2026-11-03T15:00:00.000Z',
  local_id: accesorios,
  cliente_cedula: 'V-12345678',
  cliente_nombre: 'Ana Pérez',
  cliente_telefono: '0414-1234567',
  metodo_pago: 'BS_PAGO_MOVIL',
  pagos: [{ metodo: 'BS_PAGO_MOVIL', monto_usd: 12, monto_bs: 438 }],
  vuelto: null,
  total: 12,
  items: [{ producto_id: 'p1', nombre: 'Forro', codigo_barras: '2000000000015', cantidad: 2, precio_unitario: 6 }],
  tasa_cambio: 36.5,
  total_bs: 438,
  ...extra,
});

describe('guardarVenta con pago móvil: la referencia de 4 dígitos es obligatoria (ya no se pide foto)', () => {
  it('sin referencia no se registra la venta, ni siquiera si se manda una captura', async () => {
    await rechazo(guardarVenta(env, sV, ventaPagoMovil()), 400, /referencia/i);
    await rechazo(guardarVenta(env, sV, ventaPagoMovil({ referencia_pago_movil: '   ' })), 400, /referencia/i);
    await rechazo(guardarVenta(env, sV, ventaPagoMovil({ comprobante_path: await subir(sV) })), 400, /referencia/i);
    expect(await listarVentas(env, sA, {})).toEqual([]);
  });

  it('también en un pago mixto: basta que una de las formas sea pago móvil', async () => {
    const mixta = ventaPagoMovil({
      metodo_pago: 'MIXTO',
      pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 6, monto_bs: null }, { metodo: 'BS_PAGO_MOVIL', monto_usd: 6, monto_bs: 219 }],
      total_bs: 219,
    });
    await rechazo(guardarVenta(env, sV, mixta), 400, /referencia/i);
    expect((await guardarVenta(env, sV, { ...mixta, referencia_pago_movil: '0007' })).referencia_pago_movil).toBe('0007');
  });

  it('con la referencia se registra y queda guardada', async () => {
    const guardada = await guardarVenta(env, sV, ventaPagoMovil({ referencia_pago_movil: '4821' }));
    expect(guardada.referencia_pago_movil).toBe('4821');
    expect(guardada.comprobante_path).toBeNull();
    expect((await listarVentas(env, sA, {}))[0].referencia_pago_movil).toBe('4821');
  });

  it('la referencia debe tener exactamente 4 dígitos', async () => {
    for (const mala of ['123', '12345', '12a4', 'abcd']) {
      await rechazo(guardarVenta(env, sV, ventaPagoMovil({ referencia_pago_movil: mala })), 400, /4 dígitos/);
    }
    expect(await listarVentas(env, sA, {})).toEqual([]);
  });

  it('una captura enviada por un cliente anterior se ignora: no se guarda ni se valida', async () => {
    const guardada = await guardarVenta(env, sV, ventaPagoMovil({ referencia_pago_movil: '4821', comprobante_path: '../../etc/passwd' }));
    expect(guardada.comprobante_path).toBeNull();
  });

  it('sin pago móvil no se pide nada y lo enviado se ignora', async () => {
    const efectivo = ventaPagoMovil({ metodo_pago: 'USD_EFECTIVO', pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 12, monto_bs: null }], total_bs: null, referencia_pago_movil: '1234', comprobante_path: await subir(sV) });
    const guardada = await guardarVenta(env, sV, efectivo);
    expect(guardada.referencia_pago_movil).toBeNull();
    expect(guardada.comprobante_path).toBeNull();
  });
});

describe('archivos privados: capturas del pago móvil', () => {
  it('quien vende en el local sube la captura; el vendedor NO puede verla después', async () => {
    const ruta = await subir(sV);
    await rechazo(leerArchivoPrivado(env, sV, ruta), 403);
  });

  it('la gerencia del local la ve (encargado de ese local, gerente y administrador); el de otro local y el contador, no', async () => {
    const ruta = await subir(sV);
    for (const sesion of [sEA, sG, sA]) expect((await leerArchivoPrivado(env, sesion, ruta)).status).toBe(200);
    await rechazo(leerArchivoPrivado(env, sEV, ruta), 403);
    await rechazo(leerArchivoPrivado(env, sC, ruta), 403);
  });

  it('no se sube a un local ajeno ni lo sube el contador, y no se sobrescribe', async () => {
    await rechazo(subirArchivoPrivado(env, sV, rutaCaptura(vidrios), bytes(), 'image/jpeg'), 403);
    await rechazo(subirArchivoPrivado(env, sC, rutaCaptura(), bytes(), 'image/jpeg'), 403);
    const ruta = await subir(sV);
    await rechazo(subirArchivoPrivado(env, sV, ruta, bytes(), 'image/jpeg'), 409);
  });

  it('una captura sin usar se puede borrar; la de una venta registrada, no', async () => {
    const sinUsar = await subir(sV);
    await borrarArchivosPrivados(env, sV, [sinUsar]);
    expect(await env.FOTOS_PRIVADAS.head(sinUsar)).toBeNull();

    // Una venta anterior al cambio (con captura): se simula con la ruta guardada directamente en la venta
    const usada = await subir(sV);
    const venta = await guardarVenta(env, sV, ventaPagoMovil({ referencia_pago_movil: '4821' }));
    await env.DB.prepare('UPDATE ventas SET comprobante_path = ? WHERE id = ?').bind(usada, venta.id).run();
    await rechazo(borrarArchivosPrivados(env, sV, [usada]), 409, /venta ya registrada/i);
    expect(await env.FOTOS_PRIVADAS.head(usada)).not.toBeNull();
  });
});
