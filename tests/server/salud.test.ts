import { describe, expect, it } from 'vitest';
import { GET } from '../../src/pages/api/salud';

describe('GET /api/salud', () => {
  it('responde ok comprobando D1 y R2', async () => {
    const respuesta = await GET({} as never);
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ ok: true, d1: true, r2: true });
  });
});
