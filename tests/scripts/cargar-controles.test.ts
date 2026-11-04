import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error módulos .mjs sin tipos (scripts operativos)
import { leerInventario } from '../../scripts/lib/leer-inventario.mjs';
// @ts-expect-error módulos .mjs sin tipos (scripts operativos)
import { cargarControles, reducirFoto, LOCAL_CONTROLES } from '../../scripts/lib/cargar.mjs';
import { esCodigoInterno } from '../../src/utils/codigos';

let carpeta: string;

beforeEach(async () => {
  carpeta = await mkdtemp(join(tmpdir(), 'easystem-controles-'));
  await mkdir(join(carpeta, 'fotos'));
});
afterEach(() => rm(carpeta, { recursive: true, force: true }));

/** Una imagen de verdad (el reductor la decodifica), de 1600×1200 por defecto. */
async function foto(nombre: string, ancho = 1600, alto = 1200) {
  const buffer = await sharp({ create: { width: ancho, height: alto, channels: 3, background: '#2266aa' } }).jpeg().toBuffer();
  await writeFile(join(carpeta, 'fotos', nombre), buffer);
}
const csv = (...lineas: string[]) => writeFile(join(carpeta, 'inventario.csv'), ['nombre,precio_venta,cantidad,foto', ...lineas].join('\n'), 'utf8');

describe('leerInventario', () => {
  it('lee un CSV válido con coma o con punto y coma, precios con coma decimal y la columna de foto', async () => {
    await foto('a.jpg');
    await foto('b.png');
    await writeFile(
      join(carpeta, 'inventario.csv'),
      '﻿Modelo;Precio;Cantidad;Foto;Código;Costo;Mínimo\r\nCargador 20W USB-C;"5,50";12;a.jpg;7501234567890;3,2;4\r\nCargador carro;$ 4;8;b.png;;;\r\n',
      'utf8'
    );
    const { filas, problemas } = await leerInventario(carpeta);
    expect(problemas).toEqual([]);
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ nombre: 'Cargador 20W USB-C', precio_venta: 5.5, cantidad: 12, foto: 'a.jpg', codigo_fabrica: '7501234567890', precio_compra: 3.2, stock_minimo: 4, categoria: 'Cargadores' });
    expect(filas[1]).toMatchObject({ nombre: 'Cargador carro', precio_venta: 4, cantidad: 8, foto: 'b.png' });
    expect(filas[1].codigo_fabrica).toBeUndefined();
  });

  it('detecta una foto que no existe (nombrando la línea y el archivo)', async () => {
    await csv('Cargador 20W,5,3,no-existe.jpg');
    const { problemas } = await leerInventario(carpeta);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toMatch(/Línea 2/);
    expect(problemas[0]).toMatch(/no-existe\.jpg/);
  });

  it('detecta un precio que no es número o es negativo', async () => {
    await foto('a.jpg');
    await csv('Uno,abc,3,a.jpg', 'Dos,-5,3,a.jpg', 'Tres,,3,a.jpg');
    const { problemas } = await leerInventario(carpeta);
    expect(problemas).toHaveLength(3);
    expect(problemas.every((p: string) => /precio/i.test(p))).toBe(true);
  });

  it('detecta una cantidad que no es un entero (decimal, negativa o texto)', async () => {
    await foto('a.jpg');
    await csv('Uno,5,2.5,a.jpg', 'Dos,5,-1,a.jpg', 'Tres,5,muchos,a.jpg');
    const { problemas } = await leerInventario(carpeta);
    expect(problemas).toHaveLength(3);
    expect(problemas.every((p: string) => /cantidad/i.test(p))).toBe(true);
  });

  it('detecta nombres repetidos sin distinguir mayúsculas ni espacios, y códigos de fábrica repetidos', async () => {
    await foto('a.jpg');
    await writeFile(
      join(carpeta, 'inventario.csv'),
      'nombre,precio_venta,cantidad,foto,codigo\nCargador 20W,5,1,a.jpg,111\n  cargador   20w ,5,1,a.jpg,222\nOtro,5,1,a.jpg,111\n',
      'utf8'
    );
    const { problemas } = await leerInventario(carpeta);
    expect(problemas.some((p: string) => /repetido/i.test(p) && /Cargador 20W/i.test(p))).toBe(true);
    expect(problemas.some((p: string) => /c[oó]digo.*111/i.test(p))).toBe(true);
  });

  it('avisa si falta una columna obligatoria, si no hay CSV o si no hay filas', async () => {
    await writeFile(join(carpeta, 'inventario.csv'), 'nombre,precio_venta\nUno,5\n', 'utf8');
    expect((await leerInventario(carpeta)).problemas.join(' ')).toMatch(/columna.*cantidad/i);
    await rm(join(carpeta, 'inventario.csv'));
    expect((await leerInventario(carpeta)).problemas.join(' ')).toMatch(/inventario\.csv/i);
    await csv();
    expect((await leerInventario(carpeta)).problemas.join(' ')).toMatch(/no hay productos/i);
  });

  it('acepta cantidad 0 (producto sin existencias todavía) y rechaza un nombre vacío', async () => {
    await foto('a.jpg');
    await csv('Cero,5,0,a.jpg', ',5,1,a.jpg');
    const { filas, problemas } = await leerInventario(carpeta);
    expect(filas.find((f: { nombre: string }) => f.nombre === 'Cero')?.cantidad).toBe(0);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toMatch(/nombre/i);
  });
});

/** API simulada: guarda cada llamada y responde lo mínimo que el script necesita. */
function apiSimulada(existentes: object[] = []) {
  const llamadas: { metodo: string; ruta: string; cuerpo?: any }[] = [];
  const subidas: { ruta: string; bytes: Buffer; tipo: string }[] = [];
  let n = 0;
  const api = {
    llamadas,
    subidas,
    async get(ruta: string) {
      llamadas.push({ metodo: 'GET', ruta });
      if (ruta === '/api/productos') return existentes;
      throw new Error(`GET inesperado ${ruta}`);
    },
    async post(ruta: string, cuerpo: any) {
      llamadas.push({ metodo: 'POST', ruta, cuerpo });
      if (ruta === '/api/productos/lote') return cuerpo.filas.map((f: any) => ({ id: `id-${++n}`, codigo_barras: f.codigo_barras }));
      return { ok: true };
    },
    async patch(ruta: string, cuerpo: any) {
      llamadas.push({ metodo: 'PATCH', ruta, cuerpo });
      return {};
    },
    async subir(ruta: string, bytes: Buffer, tipo: string) {
      llamadas.push({ metodo: 'PUT', ruta });
      subidas.push({ ruta, bytes, tipo });
      return `/api/archivos/publico/${ruta.split('/').pop()}.jpg`;
    },
  };
  return api;
}
const opciones = (api: ReturnType<typeof apiSimulada>, confirmar = async () => true) => ({ carpeta, api, confirmar, log: () => {} });

describe('cargarControles', () => {
  it('con problemas NO escribe nada: la API no recibe ninguna llamada ni se pide confirmación', async () => {
    await csv('Cargador,5,3,falta.jpg');
    const api = apiSimulada();
    let preguntó = false;
    const r = await cargarControles({ ...opciones(api), confirmar: async () => { preguntó = true; return true; } });
    expect(r.escrito).toBe(false);
    expect(api.llamadas).toEqual([]);
    expect(preguntó).toBe(false);
  });

  it('si no se confirma, tampoco escribe', async () => {
    await foto('a.jpg');
    await csv('Cargador,5,3,a.jpg');
    const api = apiSimulada();
    const r = await cargarControles({ ...opciones(api), confirmar: async () => false });
    expect(r.escrito).toBe(false);
    expect(api.llamadas).toEqual([]);
  });

  it('con datos válidos crea los productos, sube las fotos reducidas a ≤720 px y deja el stock como movimiento "Carga inicial (importación)" en el Local de controles', async () => {
    await foto('a.jpg', 1600, 1200);
    await foto('b.jpg', 400, 300);
    await csv('Cargador 20W,5.5,12,a.jpg', 'Cargador carro,4,0,b.jpg');
    const api = apiSimulada();
    const r = await cargarControles(opciones(api));
    expect(r).toMatchObject({ escrito: true, creados: 2, unidades: 12 });

    const lote = api.llamadas.find((l) => l.ruta === '/api/productos/lote')!;
    expect(lote.cuerpo.filas).toHaveLength(2);
    expect(lote.cuerpo.filas[0]).toMatchObject({ nombre: 'Cargador 20W', categoria: 'Cargadores', precio_venta: 5.5, precio_compra: 0 });
    expect(lote.cuerpo.filas.every((f: { codigo_barras: string }) => esCodigoInterno(f.codigo_barras))).toBe(true);
    expect(new Set(lote.cuerpo.filas.map((f: { codigo_barras: string }) => f.codigo_barras)).size).toBe(2);

    // Fotos: una por producto, JPEG, lado máximo 720
    expect(api.subidas.map((s) => s.ruta)).toEqual(['/api/archivos/producto/id-1', '/api/archivos/producto/id-2']);
    for (const s of api.subidas) {
      expect(s.tipo).toBe('image/jpeg');
      const meta = await sharp(s.bytes).metadata();
      expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(720);
    }
    expect((await sharp(api.subidas[1].bytes).metadata()).width).toBe(400); // no agranda las pequeñas
    expect(api.llamadas.filter((l) => l.metodo === 'PATCH').map((l) => l.cuerpo)).toEqual([
      { imagen_url: '/api/archivos/publico/id-1.jpg' },
      { imagen_url: '/api/archivos/publico/id-2.jpg' },
    ]);

    // Alta en el local de controles (con su mínimo) y stock solo como movimiento de ENTRADA
    const minimos = api.llamadas.find((l) => l.ruta === `/api/locales/${LOCAL_CONTROLES}/inventario/minimos`)!;
    expect(minimos.cuerpo.filas.map((f: any) => f.producto_id)).toEqual(['id-1', 'id-2']);
    const movimientos = api.llamadas.filter((l) => l.ruta === '/api/movimientos/lote').flatMap((l) => l.cuerpo.movimientos);
    expect(movimientos).toEqual([{ productoId: 'id-1', tipo: 'ENTRADA', cantidad: 12, localId: LOCAL_CONTROLES, motivo: 'Carga inicial (importación)' }]);
    expect(LOCAL_CONTROLES).toBe('00000000-0000-4000-8000-000000000004');
    // Nunca escribe stock directamente en los productos
    expect(lote.cuerpo.filas.some((f: any) => 'stock_actual' in f)).toBe(false);
  });

  it('respeta el código de fábrica cuando lo hay y no choca con los códigos que ya existen', async () => {
    await foto('a.jpg');
    await foto('b.jpg');
    await writeFile(join(carpeta, 'inventario.csv'), 'nombre,precio_venta,cantidad,foto,codigo\nUno,5,1,a.jpg,7501234567890\nDos,5,1,b.jpg,\n', 'utf8');
    const api = apiSimulada([{ id: 'x', nombre: 'Otro producto', codigo_barras: '2000000000015', inventario: [] }]);
    await cargarControles(opciones(api));
    const filas = api.llamadas.find((l) => l.ruta === '/api/productos/lote')!.cuerpo.filas;
    expect(filas[0].codigo_barras).toBe('7501234567890');
    expect(esCodigoInterno(filas[1].codigo_barras)).toBe(true);
    expect(filas[1].codigo_barras).not.toBe('2000000000015');
  });

  it('un movimiento de más de 500 unidades se parte en varios lotes sin perder unidades', async () => {
    await foto('a.jpg');
    await csv('Cargador,5,1200,a.jpg');
    const api = apiSimulada();
    await cargarControles(opciones(api));
    const lotes = api.llamadas.filter((l) => l.ruta === '/api/movimientos/lote').map((l) => l.cuerpo.movimientos.map((m: any) => m.cantidad));
    expect(lotes.flat().reduce((a: number, b: number) => a + b, 0)).toBe(1200);
    expect(lotes.every((l: number[]) => l.reduce((a, b) => a + b, 0) <= 500)).toBe(true);
  });

  it('volver a ejecutarlo no duplica: un producto que ya existe con stock en el local se omite', async () => {
    await foto('a.jpg');
    await foto('b.jpg');
    await csv('Cargador 20W,5,12,a.jpg', 'Cargador carro,4,6,b.jpg');
    const api = apiSimulada([
      { id: 'viejo', nombre: 'cargador 20w', codigo_barras: '2000000000015', imagen_url: '/x.jpg', inventario: [{ local_id: LOCAL_CONTROLES, producto_id: 'viejo', stock_actual: 12, stock_minimo: 0 }] },
    ]);
    const r = await cargarControles(opciones(api));
    expect(r).toMatchObject({ escrito: true, creados: 1, omitidos: 1, unidades: 6 });
    expect(api.llamadas.find((l) => l.ruta === '/api/productos/lote')!.cuerpo.filas.map((f: any) => f.nombre)).toEqual(['Cargador carro']);
    expect(api.llamadas.some((l) => JSON.stringify(l.cuerpo ?? '').includes('viejo'))).toBe(false);
  });

  it('si el producto ya existe pero sin stock en el local (carga interrumpida), completa foto y stock sin crearlo de nuevo', async () => {
    await foto('a.jpg');
    await csv('Cargador 20W,5,12,a.jpg');
    const api = apiSimulada([{ id: 'viejo', nombre: 'Cargador 20W', codigo_barras: '2000000000015', imagen_url: null, inventario: [] }]);
    const r = await cargarControles(opciones(api));
    expect(r).toMatchObject({ escrito: true, creados: 0, completados: 1, unidades: 12 });
    expect(api.llamadas.some((l) => l.ruta === '/api/productos/lote')).toBe(false);
    expect(api.subidas.map((s) => s.ruta)).toEqual(['/api/archivos/producto/viejo']);
    expect(api.llamadas.filter((l) => l.ruta === '/api/movimientos/lote').flatMap((l) => l.cuerpo.movimientos)).toEqual([
      { productoId: 'viejo', tipo: 'ENTRADA', cantidad: 12, localId: LOCAL_CONTROLES, motivo: 'Carga inicial (importación)' },
    ]);
  });
});

describe('reducirFoto', () => {
  it('convierte a JPEG, respeta la orientación y limita el lado mayor a 720', async () => {
    await foto('grande.jpg', 3000, 1000);
    const bytes = await reducirFoto(join(carpeta, 'fotos', 'grande.jpg'));
    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(720);
    expect(meta.height).toBe(240);
  });
});
