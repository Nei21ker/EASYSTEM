import { describe, expect, it } from 'vitest';
// @ts-expect-error módulos .mjs sin tipos (scripts operativos)
import { categoriaSugerida, parsearInventarioServicioTecnico } from '../../scripts/lib/leer-servicio-tecnico.mjs';
// @ts-expect-error módulos .mjs sin tipos (scripts operativos)
import { cargarServicioTecnico, LOCAL_SERVICIO_TECNICO } from '../../scripts/lib/cargar-servicio-tecnico.mjs';
import { esCodigoInterno } from '../../src/utils/codigos';

const leer = (texto: string) => parsearInventarioServicioTecnico(texto) as {
  filas: { linea: number; nombre: string; cantidad: number; categoria: string }[];
  dudosas: { linea: number; texto: string; motivo: string }[];
  ignoradas: { linea: number; texto: string }[];
  fusionados: { nombre: string; lineas: number[]; cantidades: number[] }[];
};

describe('parsearInventarioServicioTecnico', () => {
  it('lee «NN nombre», salta líneas vacías y quita «(und)»', () => {
    const r = leer('02 Audífono inalámbrico M90 Pro\n\n15 Cable USB 5 color super DATA NYW-D10 (3A)\n- 121 (und) Watch Onn\n');
    expect(r.filas.map((f) => [f.nombre, f.cantidad])).toEqual([
      ['Audífono inalámbrico M90 Pro', 2],
      ['Cable USB 5 color super DATA NYW-D10 (3A)', 15],
      ['Watch Onn', 121],
    ]);
  });

  it('las notas no son productos: se devuelven como ignoradas', () => {
    const r = leer('01 Taco Tecno blanco\n- Nota: Se dio de obsequio un adaptador\n- El señor Edward se lleva 03 unds\nNota: se hizo entrega de un módem\n(Salida DC UPS Blanco 12.000) Bgcntr\n');
    expect(r.filas).toHaveLength(1);
    expect(r.ignoradas.map((i) => i.linea)).toEqual([2, 3, 4, 5]);
  });

  it('los guiones junto al número y las cantidades de 100 o más quedan como dudosas, con el número sin signo', () => {
    const r = leer('-10 Set de cable data 60W\n1-02 Mini UPS POE-431P\n1-3- Modem Router Tenda\n10- Wireless Car Sparta\n-15- Battery Pack\n303 Mini UPS POE-1018\n02 Normal');
    expect(r.filas.map((f) => f.cantidad)).toEqual([10, 1, 1, 10, 15, 303, 2]);
    expect(r.dudosas.map((d) => d.linea)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.dudosas[5].motivo).toMatch(/303/);
  });

  it('un nombre cortado («...») y una observación «(Se llevaron …)» se avisan; la observación sale del nombre', () => {
    const r = leer('01 Protector de tablet fuxia p...\n01 Control de juego P4 (Se llevaron 01 Barquisimeto 17/10)');
    expect(r.filas[1].nombre).toBe('Control de juego P4');
    expect(r.dudosas.map((d) => d.linea)).toEqual([1, 2]);
    expect(r.dudosas[0].motivo).toMatch(/cortado/);
  });

  it('suma los nombres repetidos (sin importar mayúsculas, acentos ni espacios) y lo informa', () => {
    const r = leer('02 Kit de grabación AY-49\n01 Cable X\n01 kit  de grabacion ay-49');
    expect(r.filas).toHaveLength(2);
    expect(r.filas[0]).toMatchObject({ nombre: 'Kit de grabación AY-49', cantidad: 3 });
    expect(r.fusionados).toEqual([{ nombre: 'Kit de grabación AY-49', lineas: [1, 3], cantidades: [2, 1] }]);
  });

  it('sugiere categoría por el nombre', () => {
    expect(categoriaSugerida('Power Bank 30.000mAh BSM')).toBe('Power banks y UPS');
    expect(categoriaSugerida('Taco Samsung 15 voltios')).toBe('Cargadores');
    expect(categoriaSugerida('Cable USB-Iphone')).toBe('Cables y adaptadores');
    expect(categoriaSugerida('Audífono inalámbrico TUNE K63')).toBe('Audífonos');
    expect(categoriaSugerida('Pendrive 64GB Samsung')).toBe('Memorias y pendrives');
    expect(categoriaSugerida('Manguera 15 metros')).toBe('Otros');
  });
});

function apiSimulada(existentes: object[] = []) {
  const llamadas: { metodo: string; ruta: string; cuerpo?: any }[] = [];
  let n = 0;
  return {
    llamadas,
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
  };
}
const TEXTO = '03 Cable USB micro\n02 Taco Samsung\n00 Sin existencias aún\n- Nota: algo\n';

describe('cargarServicioTecnico', () => {
  it('si no se confirma no escribe nada', async () => {
    const api = apiSimulada();
    const r = await cargarServicioTecnico({ texto: TEXTO, api, confirmar: async () => false, log: () => {} });
    expect(r.escrito).toBe(false);
    expect(api.llamadas).toEqual([]);
  });

  it('crea los productos SIN precio ni foto, los da de alta en el local y deja la cantidad con el endpoint de carga inicial (nunca un movimiento)', async () => {
    const api = apiSimulada();
    const r = await cargarServicioTecnico({ texto: TEXTO, api, confirmar: async () => true, log: () => {} });
    expect(r).toMatchObject({ escrito: true, creados: 3, unidades: 5 });

    const lote = api.llamadas.find((l) => l.ruta === '/api/productos/lote')!;
    expect(lote.cuerpo.filas).toHaveLength(3);
    for (const f of lote.cuerpo.filas) {
      expect(f).toMatchObject({ precio_venta: 0, precio_compra: 0, stock_minimo: 0 });
      expect(f.imagen_url).toBeUndefined();
      expect(esCodigoInterno(f.codigo_barras)).toBe(true);
    }
    expect(lote.cuerpo.filas[0]).toMatchObject({ nombre: 'Cable USB micro', categoria: 'Cables y adaptadores' });
    expect(new Set(lote.cuerpo.filas.map((f: { codigo_barras: string }) => f.codigo_barras)).size).toBe(3);

    const altas = api.llamadas.find((l) => l.ruta === `/api/locales/${LOCAL_SERVICIO_TECNICO}/inventario/minimos`)!;
    expect(altas.cuerpo.filas).toHaveLength(3);

    const cantidades = api.llamadas.filter((l) => /\/api\/productos\/id-\d+\/cantidad$/.test(l.ruta));
    expect(cantidades.map((c) => [c.ruta, c.cuerpo])).toEqual([
      ['/api/productos/id-1/cantidad', { localId: LOCAL_SERVICIO_TECNICO, cantidad: 3 }],
      ['/api/productos/id-2/cantidad', { localId: LOCAL_SERVICIO_TECNICO, cantidad: 2 }],
    ]);
    // Jamás se registra un movimiento
    expect(api.llamadas.some((l) => l.ruta.includes('/api/movimientos'))).toBe(false);
  });

  it('al volver a ejecutarlo no duplica: omite lo que ya tiene stock y completa lo que quedó sin cantidad', async () => {
    const existentes = [
      { id: 'a', nombre: 'cable usb MICRO', codigo_barras: '2000000000001', inventario: [{ local_id: LOCAL_SERVICIO_TECNICO, stock_actual: 7 }] },
      { id: 'b', nombre: 'Taco Samsung', codigo_barras: '2000000000002', inventario: [] },
    ];
    const api = apiSimulada(existentes);
    const r = await cargarServicioTecnico({ texto: TEXTO, api, confirmar: async () => true, log: () => {} });
    expect(r).toMatchObject({ escrito: true, creados: 1, completados: 1, omitidos: 1, unidades: 2 });
    const lote = api.llamadas.find((l) => l.ruta === '/api/productos/lote')!;
    expect(lote.cuerpo.filas.map((f: { nombre: string }) => f.nombre)).toEqual(['Sin existencias aún']);
    expect(api.llamadas.filter((l) => l.ruta.endsWith('/cantidad')).map((l) => l.ruta)).toEqual(['/api/productos/b/cantidad']);
    expect(esCodigoInterno(lote.cuerpo.filas[0].codigo_barras)).toBe(true);
    expect(lote.cuerpo.filas[0].codigo_barras).not.toBe('2000000000001');
  });
});
