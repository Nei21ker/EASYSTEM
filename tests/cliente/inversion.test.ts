// Inversión: reglas puras (validación, tasa por fecha, totales, gráfico, CSV) y el modo demo (LocalStorage) con las mismas reglas del servidor.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_ACCESORIOS_ID, LOCAL_VIDRIOS_ID } from '../../src/lib/constantes-locales';
import {
  bsDeInversion, comprasPorDia, comprasPorProveedor, csvInversiones, diaSiguiente, limpiarNombreProveedor, lunesDeSemana, primerDiaDelMes, tasaParaFecha, totalizar, totalizarPorLocal,
  validarDatosInversion,
} from '../../src/utils/inversion';
import type { DatosInversion, Inversion } from '../../src/types/database.types';

const fila = (extra: Partial<Inversion> = {}): Inversion => ({
  id: Math.random().toString(36).slice(2), local_id: LOCAL_VIDRIOS_ID, tipo: 'COMPRA', fecha: '2026-11-10', descripcion: 'Vidrios', proveedor_id: null, proveedor_nombre: null,
  monto_usd: 100, tasa_bcv: 50, creado_por_nombre: 'Gaby', created_at: '2026-11-10T12:00:00.000Z', updated_at: '2026-11-10T12:00:00.000Z', ...extra,
});

describe('reglas puras de inversión', () => {
  const datos = (extra: Partial<DatosInversion> = {}): DatosInversion => ({ localId: LOCAL_VIDRIOS_ID, tipo: 'COMPRA', fecha: '2026-11-10', descripcion: '  Vidrios   blindados ', monto_usd: 10.456, proveedor: '  Tecno   Import ', ...extra });

  it('validarDatosInversion limpia los textos, redondea y rechaza lo inválido', () => {
    expect(validarDatosInversion(datos(), '2026-11-11')).toMatchObject({ descripcion: 'Vidrios blindados', proveedor: 'Tecno Import', monto_usd: 10.46 });
    expect(validarDatosInversion(datos({ proveedor: '   ' }), '2026-11-11').proveedor).toBeNull();
    expect(() => validarDatosInversion(datos({ monto_usd: 0 }), '2026-11-11')).toThrow(/mayor a 0/);
    expect(() => validarDatosInversion(datos({ fecha: '2026-12-25' }), '2026-11-11')).toThrow(/futura/);
    expect(() => validarDatosInversion(datos({ fecha: '2026-02-30' }), '2026-11-11')).toThrow(/fecha/);
    expect(() => validarDatosInversion(datos({ descripcion: 'ab' }), '2026-11-11')).toThrow(/Describe/);
    expect(() => validarDatosInversion(datos({ tipo: 'X' as 'COMPRA' }), '2026-11-11')).toThrow(/compra o una pérdida/);
    // un día de margen por la zona horaria
    expect(() => validarDatosInversion(datos({ fecha: '2026-11-12' }), '2026-11-11')).not.toThrow();
  });

  it('tasaParaFecha toma la última tasa de ese día o anterior; antes de la primera, la primera; sin tasas, null', () => {
    const tasas = [
      { fecha: '2026-11-01', tasa: 40, created_at: '2026-11-01T10:00:00Z' },
      { fecha: '2026-11-05', tasa: 45, created_at: '2026-11-05T10:00:00Z' },
      { fecha: '2026-11-05', tasa: 46, created_at: '2026-11-05T18:00:00Z' },
    ];
    expect(tasaParaFecha(tasas, '2026-11-03')).toBe(40);
    expect(tasaParaFecha(tasas, '2026-11-05')).toBe(46);
    expect(tasaParaFecha(tasas, '2026-11-30')).toBe(46);
    expect(tasaParaFecha(tasas, '2026-10-01')).toBe(40);
    expect(tasaParaFecha([], '2026-11-05')).toBeNull();
  });

  it('bsDeInversion multiplica por la tasa de su fecha y es null sin tasa', () => {
    expect(bsDeInversion(fila({ monto_usd: 12.5, tasa_bcv: 40 }))).toBe(500);
    expect(bsDeInversion(fila({ tasa_bcv: null }))).toBeNull();
  });

  it('totalizar separa compras y pérdidas, en $ y en Bs, y cuenta los registros sin tasa', () => {
    const t = totalizar([fila(), fila({ monto_usd: 50, tasa_bcv: 40 }), fila({ tipo: 'PERDIDA', monto_usd: 10 }), fila({ monto_usd: 5, tasa_bcv: null })]);
    expect(t).toMatchObject({ compras_usd: 155, compras_bs: 7000, perdidas_usd: 10, perdidas_bs: 500, n_compras: 3, n_perdidas: 1, sin_tasa: 1 });
  });

  it('totalizarPorLocal incluye todos los locales aunque no tengan registros', () => {
    const m = totalizarPorLocal([fila({ local_id: LOCAL_VIDRIOS_ID })], [LOCAL_ACCESORIOS_ID, LOCAL_VIDRIOS_ID]);
    expect(m.get(LOCAL_ACCESORIOS_ID)).toMatchObject({ compras_usd: 0, n_compras: 0 });
    expect(m.get(LOCAL_VIDRIOS_ID)).toMatchObject({ compras_usd: 100, n_compras: 1 });
  });

  it('comprasPorDia rellena los días sin compras y no cuenta pérdidas; comprasPorProveedor agrupa y ordena', () => {
    const filas = [fila({ fecha: '2026-11-09', monto_usd: 30 }), fila({ fecha: '2026-11-11', monto_usd: 20 }), fila({ fecha: '2026-11-11', tipo: 'PERDIDA', monto_usd: 99 })];
    expect(comprasPorDia(filas, '2026-11-09', '2026-11-11')).toEqual([{ fecha: '2026-11-09', usd: 30 }, { fecha: '2026-11-10', usd: 0 }, { fecha: '2026-11-11', usd: 20 }]);
    const p = comprasPorProveedor([fila({ proveedor_nombre: 'Álvarez', monto_usd: 10 }), fila({ proveedor_nombre: 'alvarez', monto_usd: 15 }), fila({ proveedor_nombre: 'Sur', monto_usd: 100 }), fila({ monto_usd: 1 })]);
    expect(p.map((x) => [x.proveedor, x.usd, x.n])).toEqual([['Sur', 100, 1], ['Álvarez', 25, 2], ['Sin proveedor', 1, 1]]);
  });

  it('fechas: día siguiente, lunes de la semana y primer día del mes', () => {
    expect(diaSiguiente('2026-12-31')).toBe('2027-01-01');
    expect(lunesDeSemana('2026-11-11')).toBe('2026-11-09'); // miércoles
    expect(lunesDeSemana('2026-11-15')).toBe('2026-11-09'); // domingo
    expect(lunesDeSemana('2026-11-09')).toBe('2026-11-09');
    expect(primerDiaDelMes('2026-11-11')).toBe('2026-11-01');
    expect(limpiarNombreProveedor('  a   b ')).toBe('a b');
    expect(limpiarNombreProveedor(' ')).toBeNull();
  });

  it('csvInversiones escapa comas y comillas y trae el monto en Bs', () => {
    const csv = csvInversiones([fila({ descripcion: 'Vidrios, "premium"', proveedor_nombre: 'Álvarez', monto_usd: 12.5, tasa_bcv: 40 })], () => 'Local Vidrios');
    const [cab, linea] = csv.split('\n');
    expect(cab).toContain('Monto Bs');
    expect(linea).toBe('2026-11-10,Local Vidrios,Compra,Álvarez,"Vidrios, ""premium""",12.50,40,500,Gaby');
  });
});

function almacenSimulado() {
  const datos = new Map<string, string>();
  return {
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => void datos.set(k, v),
    removeItem: (k: string) => void datos.delete(k),
    clear: () => datos.clear(),
    get length() {
      return datos.size;
    },
    key: (i: number) => [...datos.keys()][i] ?? null,
  };
}

async function comoUsuario(correo: string, clave: string) {
  vi.resetModules();
  vi.stubEnv('PUBLIC_USAR_API', 'false');
  const auth = await import('../../src/lib/auth');
  await auth.iniciarSesion(correo, clave);
  return import('../../src/lib/inventoryService');
}

describe('demo (LocalStorage): inversión con las mismas reglas del servidor', () => {
  beforeEach(() => {
    const almacen = almacenSimulado();
    vi.stubGlobal('localStorage', almacen);
    vi.stubGlobal('window', { localStorage: almacen, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const hoy = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const compra = (extra: Partial<DatosInversion> = {}): DatosInversion => ({ localId: LOCAL_VIDRIOS_ID, tipo: 'COMPRA', fecha: hoy(), descripcion: 'Vidrios blindados', monto_usd: 80, proveedor: 'Tecno Import', ...extra });

  it('administrador y gerente anotan; vendedor, encargado, técnico y contador no pueden ni verlo', async () => {
    const s = await comoUsuario('gerente@edwardaccesorios.com', 'gerente123');
    const i = await s.crearInversion(compra());
    expect(i).toMatchObject({ local_id: LOCAL_VIDRIOS_ID, tipo: 'COMPRA', monto_usd: 80, proveedor_nombre: 'Tecno Import' });
    expect(await s.listarInversiones()).toHaveLength(1);
    for (const [correo, clave] of [['vendedor@edwardaccesorios.com', 'vendedor123'], ['encargado@edwardaccesorios.com', 'encargado123'], ['tecnico@edwardaccesorios.com', 'tecnico123'], ['contador@edwardaccesorios.com', 'contador123']]) {
      const otro = await comoUsuario(correo, clave);
      await expect(otro.listarInversiones()).rejects.toThrow(/administrador y el gerente/);
      await expect(otro.crearInversion(compra())).rejects.toThrow(/administrador y el gerente/);
    }
  });

  it('el proveedor nuevo se agrega a la lista una sola vez y el nombre cambia en sus registros al corregirlo', async () => {
    const s = await comoUsuario('admin@edwardaccesorios.com', 'admin123');
    const a = await s.crearInversion(compra({ proveedor: 'Tecno Import' }));
    await s.crearInversion(compra({ proveedor: ' tecno  import ', localId: LOCAL_ACCESORIOS_ID, monto_usd: 20 }));
    const lista = await s.listarProveedores();
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ nombre: 'Tecno Import', n_compras: 2, total_usd: 100 });
    await s.actualizarProveedor(a.proveedor_id!, { nombre: 'Tecno Import C.A.' });
    expect((await s.listarInversiones()).every((x) => x.proveedor_nombre === 'Tecno Import C.A.')).toBe(true);
    await expect(s.crearProveedor({ nombre: 'TECNO IMPORT C.A.' })).rejects.toThrow(/Ya existe/);
    await s.eliminarProveedor(a.proveedor_id!);
    expect((await s.listarInversiones())[0]).toMatchObject({ proveedor_id: null, proveedor_nombre: 'Tecno Import C.A.' });
  });

  it('guarda la tasa BCV de la fecha, filtra por período y tipo, corrige y borra', async () => {
    const s = await comoUsuario('admin@edwardaccesorios.com', 'admin123');
    await s.registrarTasa(40, 'Prueba');
    const x = await s.crearInversion(compra({ fecha: '2026-01-15' })); // antes de la primera tasa registrada se usa la primera
    expect(x.tasa_bcv).toBe(40);
    await s.crearInversion(compra({ tipo: 'PERDIDA', descripcion: 'Vidrios rotos', proveedor: null, monto_usd: 5 }));
    expect(await s.listarInversiones({ tipo: 'PERDIDA' })).toHaveLength(1);
    expect(await s.listarInversiones({ desde: '2026-01-01', hasta: '2026-01-31' })).toHaveLength(1);
    expect(await s.listarInversiones({ localId: LOCAL_ACCESORIOS_ID })).toHaveLength(0);
    expect((await s.actualizarInversion(x.id, compra({ fecha: '2026-01-15', monto_usd: 90 }))).monto_usd).toBe(90);
    await expect(s.crearInversion(compra({ monto_usd: 0 }))).rejects.toThrow(/mayor a 0/);
    await expect(s.crearInversion(compra({ fecha: '2099-01-01' }))).rejects.toThrow(/futura/);
    await s.eliminarInversion(x.id);
    await expect(s.eliminarInversion(x.id)).rejects.toThrow(/no existe/);
  });
});
