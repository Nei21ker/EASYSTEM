import { describe, expect, it } from 'vitest';
import { calcularEstado, dispositivoDe, GRACIA_SALIDA_S, textoHace, UMBRAL_EN_LINEA_S, UMBRAL_INACTIVO_S } from '../../src/utils/presencia';

describe('calcularEstado: 🟢 < 45 s, 🟡 45 s a 2 min, 🔴 más de 2 min', () => {
  it('en línea hasta 44 s', () => {
    expect(calcularEstado(0)).toBe('en_linea');
    expect(calcularEstado(UMBRAL_EN_LINEA_S - 1)).toBe('en_linea');
  });
  it('inactivo de 45 s a 120 s (incluidos)', () => {
    expect(calcularEstado(UMBRAL_EN_LINEA_S)).toBe('inactivo');
    expect(calcularEstado(UMBRAL_INACTIVO_S)).toBe('inactivo');
  });
  it('desconectado pasados 2 minutos', () => {
    expect(calcularEstado(UMBRAL_INACTIVO_S + 1)).toBe('desconectado');
    expect(calcularEstado(86_400)).toBe('desconectado');
  });
  it('un segundo negativo (reloj adelantado) cuenta como recién visto', () => {
    expect(calcularEstado(-3)).toBe('en_linea');
  });
  it('al salir (cerrar sesión / cerrar la pestaña) pasa a desconectado, pero con una gracia para el cambio de página', () => {
    expect(calcularEstado(2, 1)).toBe('en_linea'); // acaba de salir: puede ser solo navegar a otra pantalla
    expect(calcularEstado(2, GRACIA_SALIDA_S)).toBe('desconectado');
    expect(calcularEstado(2, null)).toBe('en_linea');
  });
});

describe('textoHace', () => {
  it('segundos, minutos, horas y días', () => {
    expect(textoHace(0)).toBe('ahora mismo');
    expect(textoHace(12)).toBe('hace 12 s');
    expect(textoHace(59)).toBe('hace 59 s');
    expect(textoHace(60)).toBe('hace 1 min');
    expect(textoHace(150)).toBe('hace 2 min');
    expect(textoHace(3600)).toBe('hace 1 h');
    expect(textoHace(7300)).toBe('hace 2 h');
    expect(textoHace(200_000)).toBe('hace 2 d');
  });
});

describe('dispositivoDe: navegador y sistema en pocas palabras', () => {
  it('reconoce los comunes', () => {
    expect(dispositivoDe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')).toBe('Chrome · Windows');
    expect(dispositivoDe('Mozilla/5.0 (Linux; Android 13; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36')).toBe('Chrome · Android');
    expect(dispositivoDe('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')).toBe('Safari · iPhone');
    expect(dispositivoDe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0')).toBe('Edge · Windows');
    expect(dispositivoDe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0')).toBe('Firefox · Mac');
  });
  it('sin dato o desconocido', () => {
    expect(dispositivoDe(null)).toBe('Desconocido');
    expect(dispositivoDe('')).toBe('Desconocido');
    expect(dispositivoDe('curl/8.0')).toBe('Desconocido');
  });
});
