import { describe, expect, it } from 'vitest';
import { claseTipoMovimiento, etiquetaTipoMovimiento, filtroDeTipo, signoMovimiento } from '../../src/utils/movimientos';

describe('tipos de movimiento de inventario', () => {
  it('cada tipo tiene su etiqueta en español', () => {
    expect(etiquetaTipoMovimiento('ENTRADA')).toBe('Entrada');
    expect(etiquetaTipoMovimiento('SALIDA')).toBe('Salida');
    expect(etiquetaTipoMovimiento('TRASLADO_SALIDA')).toBe('Traslado enviado');
    expect(etiquetaTipoMovimiento('TRASLADO_ENTRADA')).toBe('Traslado recibido');
    expect(etiquetaTipoMovimiento('BAJA')).toBe('Baja');
  });

  it('un traslado cuyo motivo es de un cambio de mercancía se muestra como «Cambio entregado / recibido»', () => {
    expect(etiquetaTipoMovimiento('TRASLADO_SALIDA', 'Cambio #0001 con Local Centro')).toBe('Cambio entregado');
    expect(etiquetaTipoMovimiento('TRASLADO_ENTRADA', 'Cambio #0001 con Local Centro')).toBe('Cambio recibido');
    expect(etiquetaTipoMovimiento('TRASLADO_ENTRADA', 'Reversión del cambio #0001 con Local Centro')).toBe('Cambio recibido');
    expect(etiquetaTipoMovimiento('TRASLADO_SALIDA', 'Traslado #0003 → Local Vidrios')).toBe('Traslado enviado');
    expect(etiquetaTipoMovimiento('TRASLADO_SALIDA')).toBe('Traslado enviado');
  });

  it('suman al stock la entrada y el traslado recibido; restan la salida, el traslado enviado y la baja', () => {
    expect(signoMovimiento('ENTRADA')).toBe('+');
    expect(signoMovimiento('TRASLADO_ENTRADA')).toBe('+');
    expect(signoMovimiento('SALIDA')).toBe('-');
    expect(signoMovimiento('TRASLADO_SALIDA')).toBe('-');
    expect(signoMovimiento('BAJA')).toBe('-');
  });

  it('el filtro "traslados y bajas" agrupa los tres tipos nuevos y deja fuera las compras y las ventas', () => {
    expect(filtroDeTipo('TRASLADO_SALIDA')).toBe('TRASLADOS');
    expect(filtroDeTipo('TRASLADO_ENTRADA')).toBe('TRASLADOS');
    expect(filtroDeTipo('BAJA')).toBe('TRASLADOS');
    expect(filtroDeTipo('ENTRADA')).toBe('ENTRADA');
    expect(filtroDeTipo('SALIDA')).toBe('SALIDA');
  });

  it('los tipos nuevos no se pintan como una venta ni como una compra', () => {
    expect(claseTipoMovimiento('TRASLADO_SALIDA')).not.toBe(claseTipoMovimiento('SALIDA'));
    expect(claseTipoMovimiento('BAJA')).not.toBe(claseTipoMovimiento('SALIDA'));
    expect(claseTipoMovimiento('TRASLADO_ENTRADA')).not.toBe(claseTipoMovimiento('ENTRADA'));
  });

  it('un tipo desconocido no rompe la pantalla', () => {
    expect(etiquetaTipoMovimiento('OTRO' as never)).toBe('OTRO');
    expect(typeof claseTipoMovimiento('OTRO' as never)).toBe('string');
  });
});
