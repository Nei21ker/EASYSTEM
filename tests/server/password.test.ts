import { describe, expect, it } from 'vitest';
import { hashearClave, verificarClave, ITERACIONES_PBKDF2 } from '../../src/server/password';

describe('contraseñas con PBKDF2', () => {
  it('verifica la misma clave (ida y vuelta)', async () => {
    const hash = await hashearClave('Clave-Segura-123');
    expect(await verificarClave('Clave-Segura-123', hash)).toBe(true);
  });

  it('rechaza una clave incorrecta', async () => {
    const hash = await hashearClave('Clave-Segura-123');
    expect(await verificarClave('clave-segura-123', hash)).toBe(false);
  });

  it('usa una sal distinta cada vez', async () => {
    const a = await hashearClave('igual');
    const b = await hashearClave('igual');
    expect(a).not.toBe(b);
    expect(await verificarClave('igual', a)).toBe(true);
    expect(await verificarClave('igual', b)).toBe(true);
  });

  it('guarda el hash con el formato pbkdf2$iteraciones$sal$hash', async () => {
    const hash = await hashearClave('x');
    expect(hash).toMatch(/^pbkdf2\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(hash.split('$')[1]).toBe(String(ITERACIONES_PBKDF2));
  });

  it('devuelve false (sin lanzar) con un hash mal formado', async () => {
    expect(await verificarClave('x', '')).toBe(false);
    expect(await verificarClave('x', 'bcrypt$2b$10$abc')).toBe(false);
    expect(await verificarClave('x', 'pbkdf2$no-numero$AAAA$BBBB')).toBe(false);
  });

  it('rechaza un hash con un número de iteraciones absurdo (evita gastar CPU del servidor)', async () => {
    expect(await verificarClave('x', 'pbkdf2$999999999$AAAAAAAAAAAAAAAAAAAAAA==$AAAA')).toBe(false);
  });

  it('mide cuánto tarda hashear (informativo para la fase 0)', async () => {
    const inicio = performance.now();
    await hashearClave('medicion');
    const ms = performance.now() - inicio;
    console.log(`PBKDF2 ${ITERACIONES_PBKDF2} iteraciones: ${ms.toFixed(1)} ms (reloj de pared en local)`);
    expect(ms).toBeLessThan(2000);
  });
});
