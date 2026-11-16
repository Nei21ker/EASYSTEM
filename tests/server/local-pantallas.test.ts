import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { actualizarUsuario, crearUsuario } from '../../src/server/servicios/usuarios';
import { actualizarOrden, crearOrden, listarTecnicosDeLocal } from '../../src/server/servicios/ordenes';
import { LOCAL_PANTALLAS_ID } from '../../src/lib/constantes-locales';

const env = crearEntornoDePrueba();
const ORIGEN = IDS_LOCALES.servicio;
const entorno = env as unknown as { MIGRACIONES: { name: string; queries: string[] }[] };

/** Corre las sentencias de la migración 0031 (la base de pruebas ya la aplicó vacía; aquí se repite con datos). */
async function correrMigracion(nombre = '0031_local_pantallas'): Promise<void> {
  const m = entorno.MIGRACIONES.find((x) => x.name.startsWith(nombre));
  if (!m) throw new Error(`No se encontró la migración ${nombre}`);
  for (const q of m.queries) await env.DB.prepare(q).run();
}

async function producto(id: string, nombre: string, categoria: string, stock: number): Promise<void> {
  await env.DB
    .prepare('INSERT INTO productos (id, codigo_barras, nombre, categoria, precio_venta, stock_actual) VALUES (?, ?, ?, ?, 10, ?)')
    .bind(id, `20000000${id.padStart(5, '0')}`, nombre, categoria, stock)
    .run();
}
async function piezas(productoId: string, prefijo: string, estados: string[], local = ORIGEN): Promise<void> {
  let n = 0;
  for (const estado of estados) {
    n += 1;
    await env.DB
      .prepare('INSERT INTO unidades_producto (id, producto_id, local_id, codigo, estado) VALUES (?, ?, ?, ?, ?)')
      .bind(`u-${prefijo}${n}`, productoId, local, `${prefijo}00000${n}`, estado)
      .run();
  }
}
const stockEn = async (local: string, prod: string) =>
  (await env.DB.prepare('SELECT stock_actual s, stock_minimo m FROM inventario_local WHERE local_id = ? AND producto_id = ?').bind(local, prod).first<{ s: number; m: number }>());

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  // Origen: 2 pantallas con stock, 1 con 0 (solo una pieza vendida), 1 en la categoría «Pantallas» y 1 batería que NO se toca
  await producto('1', 'Pnt Samsung A07', 'Pantalla', 3);
  await producto('2', 'Pnt Tecno spk 2024', 'Pantallas', 2);
  await producto('3', 'Pantalla Hot 30i', 'Pantalla', 0);
  await producto('4', 'Batería BL-49', 'Batería', 4);
  await piezas('1', 'INF', ['DISPONIBLE', 'DISPONIBLE', 'DISPONIBLE']);
  await piezas('2', 'TEC', ['DISPONIBLE', 'DISPONIBLE', 'VENDIDA']);
  await piezas('3', 'HOT', ['VENDIDA']);
  await piezas('4', 'BAT', ['DISPONIBLE', 'DISPONIBLE', 'DISPONIBLE', 'DISPONIBLE']);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO inventario_local (local_id, producto_id, stock_actual, stock_minimo) VALUES (?, ?, ?, ?)').bind(ORIGEN, '1', 3, 2),
    env.DB.prepare('INSERT INTO inventario_local (local_id, producto_id, stock_actual, stock_minimo) VALUES (?, ?, ?, ?)').bind(ORIGEN, '2', 2, 0),
    env.DB.prepare('INSERT INTO inventario_local (local_id, producto_id, stock_actual, stock_minimo) VALUES (?, ?, ?, ?)').bind(ORIGEN, '3', 0, 1),
    env.DB.prepare('INSERT INTO inventario_local (local_id, producto_id, stock_actual, stock_minimo) VALUES (?, ?, ?, ?)').bind(ORIGEN, '4', 4, 0),
  ]);
});

describe('migración 0031: Local de pantallas', () => {
  it('crea el local (tipo accesorios, sede Cosmos) y pasa las pantallas con sus códigos y su stock mínimo', async () => {
    await correrMigracion();

    const local = await env.DB.prepare('SELECT nombre, tipo, sede, activo, subscription_status FROM locales WHERE id = ?').bind(LOCAL_PANTALLAS_ID).first();
    expect(local).toMatchObject({ nombre: 'Local de pantallas', tipo: 'accesorios', sede: 'Cosmos', activo: 1, subscription_status: 'ACTIVE' });

    // Stock: 3 + 2 = 5 piezas disponibles pasaron al destino; el stock mínimo viaja; la de 0 también queda registrada
    expect(await stockEn(LOCAL_PANTALLAS_ID, '1')).toEqual({ s: 3, m: 2 });
    expect(await stockEn(LOCAL_PANTALLAS_ID, '2')).toEqual({ s: 2, m: 0 });
    expect(await stockEn(LOCAL_PANTALLAS_ID, '3')).toEqual({ s: 0, m: 1 });
    // El origen ya no maneja las pantallas, pero sí la batería (no se toca)
    expect(await stockEn(ORIGEN, '1')).toBeNull();
    expect(await stockEn(ORIGEN, '2')).toBeNull();
    expect(await stockEn(ORIGEN, '3')).toBeNull();
    expect(await stockEn(ORIGEN, '4')).toEqual({ s: 4, m: 0 });
    expect(await stockEn(LOCAL_PANTALLAS_ID, '4')).toBeNull();
    // El total del producto no cambia (sale de uno, entra al otro)
    const total = await env.DB.prepare('SELECT stock_actual s FROM productos WHERE id = ?').bind('1').first<{ s: number }>();
    expect(total?.s).toBe(3);

    // Piezas: las disponibles cambian de local con el MISMO código; la vendida se queda donde se vendió
    const piezasDestino = await env.DB.prepare('SELECT codigo FROM unidades_producto WHERE local_id = ? AND estado = ? ORDER BY codigo').bind(LOCAL_PANTALLAS_ID, 'DISPONIBLE').all<{ codigo: string }>();
    expect(piezasDestino.results.map((x) => x.codigo)).toEqual(['INF000001', 'INF000002', 'INF000003', 'TEC000001', 'TEC000002']);
    const vendida = await env.DB.prepare("SELECT local_id FROM unidades_producto WHERE codigo = 'TEC000003'").first<{ local_id: string }>();
    expect(vendida?.local_id).toBe(ORIGEN);
    const baterias = await env.DB.prepare("SELECT count(*) n FROM unidades_producto WHERE local_id = ? AND estado = 'DISPONIBLE' AND codigo LIKE 'BAT%'").bind(ORIGEN).first<{ n: number }>();
    expect(baterias?.n).toBe(4);
  });

  it('deja un traslado #0001 ya recibido y los movimientos de traslado de cada producto en cada local', async () => {
    await correrMigracion();

    const t = await env.DB.prepare('SELECT folio, estado, origen_local_id o, destino_local_id d, recibido_en FROM traslados').first<{ folio: number; estado: string; o: string; d: string; recibido_en: string }>();
    expect(t).toMatchObject({ folio: 1, estado: 'RECIBIDO', o: ORIGEN, d: LOCAL_PANTALLAS_ID });
    const unidades = await env.DB.prepare('SELECT codigo FROM traslado_unidades WHERE recibida_en IS NOT NULL ORDER BY codigo').all<{ codigo: string }>();
    expect(unidades.results).toHaveLength(5);

    const movs = await env.DB.prepare('SELECT producto_id p, tipo, cantidad, local_id l, motivo, unidad_codigos FROM movimientos_inventario ORDER BY producto_id, tipo').all<{ p: string; tipo: string; cantidad: number; l: string; motivo: string; unidad_codigos: string }>();
    expect(movs.results).toHaveLength(4); // 2 productos con piezas × (salida + entrada); el de 0 piezas no mueve nada
    const salida1 = movs.results.find((m) => m.p === '1' && m.tipo === 'TRASLADO_SALIDA')!;
    expect(salida1).toMatchObject({ cantidad: 3, l: ORIGEN });
    expect(salida1.motivo).toBe('Traslado #0001 → Local de pantallas');
    expect(JSON.parse(salida1.unidad_codigos).sort()).toEqual(['INF000001', 'INF000002', 'INF000003']);
    const entrada2 = movs.results.find((m) => m.p === '2' && m.tipo === 'TRASLADO_ENTRADA')!;
    expect(entrada2).toMatchObject({ cantidad: 2, l: LOCAL_PANTALLAS_ID });
    expect(entrada2.motivo).toBe('Traslado #0001 desde Local Servicio Técnico');
    // Ni ventas ni compras: los reportes no cuentan nada de esto
    expect(movs.results.some((m) => m.tipo === 'ENTRADA' || m.tipo === 'SALIDA')).toBe(false);
  });

  it('sube las versiones en vivo y repetirla no mueve nada más', async () => {
    await correrMigracion();
    const v = await env.DB.prepare("SELECT version FROM cambios WHERE tabla = 'unidades_producto' AND local_id = ?").bind(LOCAL_PANTALLAS_ID).first<{ version: number }>();
    expect(v?.version).toBeGreaterThanOrEqual(1);

    await correrMigracion();
    expect((await env.DB.prepare('SELECT count(*) n FROM movimientos_inventario').first<{ n: number }>())?.n).toBe(4);
    expect((await env.DB.prepare('SELECT count(*) n FROM traslados').first<{ n: number }>())?.n).toBe(1);
    expect(await stockEn(LOCAL_PANTALLAS_ID, '1')).toEqual({ s: 3, m: 2 });
  });

  it('sin pantallas que pasar solo crea el local (no gasta un folio de traslado)', async () => {
    await env.DB.prepare("DELETE FROM unidades_producto WHERE producto_id IN ('1', '2', '3')").run();
    await env.DB.prepare("DELETE FROM inventario_local WHERE producto_id IN ('1', '2', '3')").run();
    await correrMigracion();
    expect((await env.DB.prepare('SELECT count(*) n FROM traslados').first<{ n: number }>())?.n).toBe(0);
    expect((await env.DB.prepare('SELECT count(*) n FROM locales WHERE id = ?').bind(LOCAL_PANTALLAS_ID).first<{ n: number }>())?.n).toBe(1);
  });
});

describe('Local de pantallas: lo opera la gerencia, con su propio servicio técnico', () => {
  let admin: UsuarioDePrueba, gerente: UsuarioDePrueba, supervisor: UsuarioDePrueba, encargado: UsuarioDePrueba;
  const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));
  const orden = {
    local_id: LOCAL_PANTALLAS_ID, cliente_cedula: 'V-12345678', cliente_nombre: 'Ana Pérez', cliente_telefono: '0414-1234567',
    equipo_marca: 'Samsung', equipo_modelo: 'A07', equipo_imei: null, accesorios_recibidos: null, falla_reportada: 'Pantalla rota',
  };

  beforeEach(async () => {
    await correrMigracion('0031_local_pantallas');
    await correrMigracion('0032_pantallas_servicio_tecnico');
    admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
    gerente = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null });
    supervisor = await crearUsuarioDePrueba(env, { rol: 'supervisor', localId: null });
    encargado = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: IDS_LOCALES.vidrios });
  });

  async function rechazo(promesa: Promise<unknown>, texto = /solo la gerencia/): Promise<void> {
    try {
      await promesa;
    } catch (err) {
      expect(err).toBeInstanceOf(ErrorApi);
      expect((err as ErrorApi).status).toBe(400);
      expect((err as ErrorApi).message).toMatch(texto);
      return;
    }
    throw new Error('Debía rechazarse');
  }

  it('es de tipo servicio técnico (módulo de órdenes), sin cambiar nada de lo movido', async () => {
    const l = await env.DB.prepare('SELECT tipo FROM locales WHERE id = ?').bind(LOCAL_PANTALLAS_ID).first<{ tipo: string }>();
    expect(l?.tipo).toBe('servicio_tecnico');
    expect(await stockEn(LOCAL_PANTALLAS_ID, '1')).toEqual({ s: 3, m: 2 });
  });

  it('no se puede asignar un encargado ni un vendedor a ese local (ni el administrador ni el gerente)', async () => {
    for (const rol of ['encargado', 'vendedor'] as const) {
      await rechazo(crearUsuario(env, await sesionDe(admin), { email: `${rol}@pantallas.com`, nombre: `Ana ${rol}`, clave: 'Clave-nueva-123', rol, localId: LOCAL_PANTALLAS_ID }));
    }
    await rechazo(crearUsuario(env, await sesionDe(gerente), { email: 'g@pantallas.com', nombre: 'Gina Gerencia', clave: 'Clave-nueva-123', rol: 'encargado', localId: LOCAL_PANTALLAS_ID }));
  });

  it('no se puede mover a un encargado a ese local, ni dejar a un técnico allí al subirlo de rol', async () => {
    await rechazo(actualizarUsuario(env, await sesionDe(admin), encargado.id, { localId: LOCAL_PANTALLAS_ID }));
    const tec = await crearUsuarioDePrueba(env, { rol: 'tecnico', localId: LOCAL_PANTALLAS_ID });
    await rechazo(actualizarUsuario(env, await sesionDe(admin), tec.id, { rol: 'vendedor' }));
  });

  it('los técnicos sí: se crean ahí, aparecen para asignar y la gerencia registra, asigna y avanza las órdenes', async () => {
    const id = await crearUsuario(env, await sesionDe(gerente), { email: 'julio@pantallas.com', nombre: 'Julio Técnico', clave: 'Clave-nueva-123', rol: 'tecnico', localId: LOCAL_PANTALLAS_ID });
    const sS = await sesionDe(supervisor);
    expect((await listarTecnicosDeLocal(env, sS, LOCAL_PANTALLAS_ID)).map((x) => x.nombre)).toEqual(['Julio Técnico']);
    const o = await crearOrden(env, sS, orden);
    expect(o.local_id).toBe(LOCAL_PANTALLAS_ID);
    const a = await actualizarOrden(env, sS, o.id, { tecnico_id: id, estado: 'en_reparacion' });
    expect(a).toMatchObject({ tecnico_id: id, tecnico_nombre: 'Julio Técnico', estado: 'en_reparacion' });
  });

  it('administrador, gerente y supervisor ven el local entre sus locales', async () => {
    for (const u of [admin, gerente, supervisor]) {
      const { alcanceDe } = await import('../../src/server/authz');
      const alcance = await alcanceDe(env, await sesionDe(u));
      // El administrador ve todo; gerente y supervisor, los locales vigentes (entre ellos el de pantallas)
      expect(alcance.tipo === 'todos' || alcance.ids.includes(LOCAL_PANTALLAS_ID)).toBe(true);
    }
  });
});
