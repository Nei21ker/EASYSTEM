// La semilla (migrations/0002_seed.sql) deja el sistema listo para usarse: 4 locales y el catálogo de modelos, sin productos.
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { catalogoModelos } from '../../src/lib/catalogo-modelos';
import { crearEntornoDePrueba, reiniciarBase } from './ayudas';

const { DB } = crearEntornoDePrueba();
const migraciones = (env as unknown as { MIGRACIONES: { name: string; queries: string[] }[] }).MIGRACIONES;

/** Vacía la base y vuelve a ejecutar SOLO la semilla (las demás pruebas dejan datos propios). */
async function aplicarSemilla() {
  await reiniciarBase(DB);
  const semilla = migraciones.find((m) => m.name.includes('0002_seed'));
  expect(semilla, 'falta la migración 0002_seed').toBeDefined();
  for (const consulta of semilla!.queries) await DB.prepare(consulta).run();
}

beforeEach(aplicarSemilla);

describe('semilla', () => {
  it('crea los 4 locales con sus ids y tipos, todos con suscripción ACTIVE', async () => {
    const filas = await DB.prepare('SELECT id, nombre, tipo, subscription_status, activo FROM locales ORDER BY id').all<{
      id: string; nombre: string; tipo: string; subscription_status: string; activo: number;
    }>();
    expect(filas.results).toEqual([
      { id: '00000000-0000-4000-8000-000000000001', nombre: 'Local Accesorios', tipo: 'accesorios', subscription_status: 'ACTIVE', activo: 1 },
      { id: '00000000-0000-4000-8000-000000000002', nombre: 'Local Vidrios', tipo: 'vidrios', subscription_status: 'ACTIVE', activo: 1 },
      { id: '00000000-0000-4000-8000-000000000003', nombre: 'Local Servicio Técnico', tipo: 'servicio_tecnico', subscription_status: 'ACTIVE', activo: 1 },
      { id: '00000000-0000-4000-8000-000000000004', nombre: 'Local de controles', tipo: 'controles', subscription_status: 'ACTIVE', activo: 1 },
    ]);
  });

  it('carga todos los modelos de src/lib/catalogo-modelos.ts', async () => {
    const esperados = Object.entries(catalogoModelos).flatMap(([marca, modelos]) => modelos.map((m) => `${marca}|${m}`)).sort();
    const filas = await DB.prepare('SELECT marca, modelo FROM modelos_telefono').all<{ marca: string; modelo: string }>();
    expect(filas.results.map((f) => `${f.marca}|${f.modelo}`).sort()).toEqual(esperados);
  });

  it('no trae ningún producto, movimiento, unidad ni tasa', async () => {
    for (const tabla of ['productos', 'inventario_local', 'movimientos_inventario', 'unidades_producto', 'ventas', 'tasas_cambio', 'perfiles', 'user']) {
      const fila = await DB.prepare(`SELECT count(*) AS n FROM ${tabla}`).first<{ n: number }>();
      expect(fila?.n, tabla).toBe(0);
    }
  });

  it('deja los contadores de folios y de códigos de unidad en cero', async () => {
    const filas = await DB.prepare('SELECT nombre, valor FROM contadores ORDER BY nombre').all<{ nombre: string; valor: number }>();
    expect(filas.results).toEqual([
      { nombre: 'devoluciones', valor: 0 },
      { nombre: 'ordenes_servicio', valor: 0 },
      { nombre: 'unidades', valor: 0 },
      { nombre: 'ventas', valor: 0 },
    ]);
  });

  it('los ids de los modelos son estables entre ejecuciones (se generan a partir de marca y modelo)', async () => {
    const fila = await DB.prepare("SELECT id FROM modelos_telefono WHERE marca = 'Apple' AND modelo = 'iPhone 11'").first<{ id: string }>();
    expect(fila?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
