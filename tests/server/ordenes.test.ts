import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { actualizarOrden, crearOrden, listarOrdenes, obtenerOrden } from '../../src/server/servicios/ordenes';

const env = crearEntornoDePrueba();
const { accesorios, servicio } = IDS_LOCALES;

let admin: UsuarioDePrueba, tecnico: UsuarioDePrueba, encargadoServ: UsuarioDePrueba, vendedorAcc: UsuarioDePrueba, contador: UsuarioDePrueba;
let sA: Sesion, sT: Sesion, sES: Sesion, sVA: Sesion, sC: Sesion;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
  tecnico = await crearUsuarioDePrueba(env, { rol: 'tecnico', localId: servicio, nombre: 'Tito Técnico' });
  encargadoServ = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: servicio });
  vendedorAcc = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
  contador = await crearUsuarioDePrueba(env, { rol: 'contador', localId: null });
  [sA, sT, sES, sVA, sC] = await Promise.all([admin, tecnico, encargadoServ, vendedorAcc, contador].map(sesionDe));
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

const nueva = (localId: string = servicio, extra: Record<string, unknown> = {}) => ({
  local_id: localId,
  cliente_cedula: 'V-12345678',
  cliente_nombre: 'Ana Pérez',
  cliente_telefono: '0414-1234567',
  equipo_marca: 'Apple',
  equipo_modelo: 'iPhone 11',
  equipo_imei: null,
  accesorios_recibidos: 'Cargador',
  falla_reportada: 'No enciende',
  ...extra,
});

const repuesto = (cantidad: number, precio: number) => ({ producto_id: 'p1', nombre: 'Pantalla', codigo_barras: '2000000000015', cantidad, precio_unitario: precio });

describe('crear órdenes', () => {
  it('el técnico registra un equipo: queda pendiente, con folio y su nombre', async () => {
    const o = await crearOrden(env, sT, nueva());
    expect(o).toMatchObject({ folio: 1, estado: 'pendiente', local_id: servicio, equipo_modelo: 'iPhone 11', repuestos: [], mano_de_obra_usd: 0, total_usd: 0, listo_en: null, entregada_en: null, registrado_nombre: 'Tito Técnico' });
    expect((await crearOrden(env, sES, nueva())).folio).toBe(2);
  });

  it('solo en un local de servicio técnico', async () => {
    await rechazo(crearOrden(env, sA, nueva(accesorios)), 400, 'Las órdenes de servicio solo se registran en un local de servicio técnico');
  });

  it('cada quien en su local; el contador no', async () => {
    await rechazo(crearOrden(env, sVA, nueva(servicio)), 403);
    await rechazo(crearOrden(env, sC, nueva(servicio)), 403);
    await crearOrden(env, sA, nueva(servicio));
  });

  it('valida cliente, equipo y falla', async () => {
    await rechazo(crearOrden(env, sT, nueva(servicio, { cliente_nombre: '' })), 400, /Faltan datos del cliente/);
    await rechazo(crearOrden(env, sT, nueva(servicio, { equipo_marca: ' ' })), 400, 'Indica la marca y el modelo del equipo.');
    await rechazo(crearOrden(env, sT, nueva(servicio, { falla_reportada: 'a' })), 400, 'Describe la falla que reporta el cliente.');
  });
});

describe('leer órdenes', () => {
  it('los de ese local las ven (más nuevas primero); los de otro local y el contador no', async () => {
    const a = await crearOrden(env, sT, nueva());
    await new Promise((r) => setTimeout(r, 5));
    const b = await crearOrden(env, sT, nueva());
    expect((await listarOrdenes(env, sES, {})).map((o) => o.id)).toEqual([b.id, a.id]);
    expect(await listarOrdenes(env, sVA, {})).toEqual([]);
    expect((await listarOrdenes(env, sA, { localId: servicio, limite: 1 })).map((o) => o.id)).toEqual([b.id]);
    await rechazo(listarOrdenes(env, sC, {}), 403);
  });

  it('obtenerOrden devuelve null si es de un local al que no se accede', async () => {
    const o = await crearOrden(env, sT, nueva());
    expect((await obtenerOrden(env, sES, o.id))?.id).toBe(o.id);
    expect(await obtenerOrden(env, sVA, o.id)).toBeNull();
    expect(await obtenerOrden(env, sT, 'no-existe')).toBeNull();
  });
});

describe('actualizar órdenes', () => {
  it('pasar a listo y a entregado anota las fechas; entregada ya no se modifica', async () => {
    const o = await crearOrden(env, sT, nueva());
    const lista = await actualizarOrden(env, sT, o.id, { estado: 'listo', diagnostico: 'Pantalla rota' });
    expect(lista).toMatchObject({ estado: 'listo', diagnostico: 'Pantalla rota' });
    expect(lista.listo_en).toMatch(/^\d{4}-\d\d-\d\dT/);
    const entregada = await actualizarOrden(env, sT, o.id, { estado: 'entregado' });
    expect(entregada.entregada_en).toMatch(/^\d{4}-\d\d-\d\dT/);
    await rechazo(actualizarOrden(env, sT, o.id, { diagnostico: 'otra cosa' }), 409, 'Esa orden ya fue entregada y no se puede modificar.');
  });

  it('el total siempre es repuestos + mano de obra (se ignora el que mande el cliente)', async () => {
    const o = await crearOrden(env, sT, nueva());
    const a = await actualizarOrden(env, sT, o.id, { repuestos: [repuesto(2, 25), repuesto(1, 3)], mano_de_obra_usd: 10, total_usd: 999 });
    expect(a.total_usd).toBe(63);
    const b = await actualizarOrden(env, sT, o.id, { mano_de_obra_usd: 20 });
    expect(b.total_usd).toBe(73);
    expect(b.repuestos).toHaveLength(2);
  });

  it('asigna técnico y valida estado y mano de obra', async () => {
    const o = await crearOrden(env, sT, nueva());
    const a = await actualizarOrden(env, sES, o.id, { tecnico_id: tecnico.id, tecnico_nombre: 'Tito Técnico', estado: 'en_reparacion' });
    expect(a).toMatchObject({ tecnico_id: tecnico.id, tecnico_nombre: 'Tito Técnico', estado: 'en_reparacion' });
    await rechazo(actualizarOrden(env, sT, o.id, { estado: 'perdido' as never }), 400);
    await rechazo(actualizarOrden(env, sT, o.id, { mano_de_obra_usd: -5 }), 400);
  });

  it('una orden de otro local o inexistente responde 404; el contador 403', async () => {
    const o = await crearOrden(env, sT, nueva());
    await rechazo(actualizarOrden(env, sVA, o.id, { diagnostico: 'x' }), 404);
    await rechazo(actualizarOrden(env, sT, 'no-existe', { diagnostico: 'x' }), 404);
    await rechazo(actualizarOrden(env, sC, o.id, { diagnostico: 'x' }), 403);
  });

  it('el local de una orden no se cambia', async () => {
    const o = await crearOrden(env, sT, nueva());
    const a = await actualizarOrden(env, sT, o.id, { local_id: accesorios, diagnostico: 'ok' } as never);
    expect(a.local_id).toBe(servicio);
  });

  it('sube la versión de ordenes_servicio en ese local', async () => {
    await env.DB.prepare('DELETE FROM cambios').run();
    await crearOrden(env, sT, nueva());
    expect(await env.DB.prepare('SELECT tabla, local_id, version FROM cambios').all()).toMatchObject({ results: [{ tabla: 'ordenes_servicio', local_id: servicio, version: 1 }] });
  });
});
