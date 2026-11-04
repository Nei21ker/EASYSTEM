import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearSondeo, type VersionCambio } from '../../src/lib/sondeo';

const v = (tabla: string, version: number, local_id: string | null = null): VersionCambio => ({ tabla, local_id, version });

let respuesta: VersionCambio[];
let visible: boolean;
let consultas: number;
let emitidas: string[];
let falla: boolean;

function nuevo(opciones: { inactividadMs?: number } = {}) {
  return crearSondeo({
    consultar: async () => {
      consultas++;
      if (falla) throw new Error('Failed to fetch');
      return respuesta;
    },
    emitir: (tabla) => emitidas.push(tabla),
    visible: () => visible,
    ...opciones,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  respuesta = [v('ventas', 1, 'L1'), v('productos', 1)];
  visible = true;
  consultas = 0;
  emitidas = [];
  falla = false;
});
afterEach(() => vi.useRealTimers());

describe('sondeo de cambios', () => {
  it('la primera consulta fija la línea base y NO emite nada', async () => {
    const s = nuevo();
    s.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    expect(consultas).toBe(1);
    expect(emitidas).toEqual([]);
    s.detener();
  });

  it('consulta cada 5 segundos con la pestaña visible', async () => {
    const s = nuevo();
    s.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(consultas).toBe(3);
    s.detener();
  });

  it('emite el evento solo para las tablas cuya versión cambió (una vez por tabla)', async () => {
    const s = nuevo();
    s.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    respuesta = [v('ventas', 2, 'L1'), v('ventas', 1, 'L2'), v('productos', 1)];
    await vi.advanceTimersByTimeAsync(5000);
    expect(emitidas).toEqual(['ventas']); // 'ventas@L1' subió y 'ventas@L2' apareció: una sola emisión de la tabla
    await vi.advanceTimersByTimeAsync(5000);
    expect(emitidas).toEqual(['ventas']); // sin cambios nuevos no vuelve a emitir
    s.detener();
  });

  it('una tabla nueva (aparece una fila de versión) también cuenta como cambio', async () => {
    const s = nuevo();
    s.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    respuesta = [...respuesta, v('nominas', 1, 'L1')];
    await vi.advanceTimersByTimeAsync(5000);
    expect(emitidas).toEqual(['nominas']);
    s.detener();
  });

  it('no consulta con la pestaña oculta y, al volver a verse, consulta de inmediato y emite lo que cambió mientras tanto', async () => {
    const s = nuevo();
    s.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    visible = false;
    respuesta = [v('ventas', 5, 'L1'), v('productos', 1)];
    await vi.advanceTimersByTimeAsync(30_000);
    expect(consultas).toBe(1);
    visible = true;
    s.alVolverAVerse();
    await vi.advanceTimersByTimeAsync(0);
    expect(consultas).toBe(2);
    expect(emitidas).toEqual(['ventas']);
    s.detener();
  });

  it('tras 3 minutos sin actividad deja de consultar; con actividad vuelve a consultar de inmediato', async () => {
    const s = nuevo();
    s.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3 * 60_000 + 6000);
    const antes = consultas;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(consultas).toBe(antes); // inactivo: ya no consulta
    respuesta = [v('ventas', 9, 'L1'), v('productos', 1)];
    s.registrarActividad();
    await vi.advanceTimersByTimeAsync(0);
    expect(consultas).toBe(antes + 1);
    expect(emitidas).toEqual(['ventas']);
    s.detener();
  });

  it('la actividad frecuente mantiene viva la consulta pasados los 3 minutos', async () => {
    const s = nuevo();
    s.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 8; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
      s.registrarActividad();
    }
    expect(consultas).toBeGreaterThan(40); // 4 minutos a una consulta cada 5 s
    s.detener();
  });

  it('un fallo de red no rompe el sondeo ni borra la línea base: al volver la red detecta los cambios', async () => {
    const s = nuevo();
    s.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    falla = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(emitidas).toEqual([]);
    falla = false;
    respuesta = [v('ventas', 2, 'L1'), v('productos', 1)];
    await vi.advanceTimersByTimeAsync(5000);
    expect(emitidas).toEqual(['ventas']);
    s.detener();
  });

  it('nunca hay dos consultas a la vez aunque una tarde más que el intervalo', async () => {
    let enCurso = 0;
    let maxima = 0;
    const s = crearSondeo({
      consultar: async () => {
        enCurso++;
        maxima = Math.max(maxima, enCurso);
        await new Promise((r) => setTimeout(r, 12_000));
        enCurso--;
        return respuesta;
      },
      emitir: () => {},
      visible: () => true,
    });
    s.iniciar();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(maxima).toBe(1);
    s.detener();
  });

  it('detener corta las consultas', async () => {
    const s = nuevo();
    s.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    s.detener();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(consultas).toBe(1);
  });
});
