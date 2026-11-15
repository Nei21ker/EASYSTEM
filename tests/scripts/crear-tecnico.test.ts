import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos
import { sentenciasAltaTecnico } from '../../scripts/lib/tecnico.mjs';

const LOCAL = '00000000-0000-4000-8000-000000000003';

describe('alta de técnico (scripts/crear-tecnico.mjs)', () => {
  it('crea user + cuenta + perfil «tecnico» del local, marcado para cambiar la clave, sin la clave en claro', async () => {
    const clave = 'ClaveDePrueba99';
    const sql: string[] = await sentenciasAltaTecnico({ correo: ' Ana@Correo.com ', nombre: 'Ana  Pérez', clave, localId: LOCAL });
    expect(sql).toHaveLength(3);
    expect(sql[0]).toContain("'ana@correo.com'");
    expect(sql[2]).toContain("'tecnico'");
    expect(sql[2]).toContain(`'${LOCAL}'`);
    expect(sql[2]).toMatch(/debe_cambiar_clave\)/);
    expect(sql[2]).toMatch(/, 1\)$/);
    expect(sql.join('\n')).not.toContain(clave);
    expect(sql[1]).toMatch(/'[^']+'/); // lleva el hash
  });

  it('rechaza correo inválido, nombre vacío, clave corta y local que no es un id', async () => {
    const base = { correo: 'a@b.com', nombre: 'Ana', clave: 'ClaveDePrueba99', localId: LOCAL };
    await expect(sentenciasAltaTecnico({ ...base, correo: 'no-es-correo' })).rejects.toThrow(/correo/i);
    await expect(sentenciasAltaTecnico({ ...base, nombre: ' ' })).rejects.toThrow(/nombre/i);
    await expect(sentenciasAltaTecnico({ ...base, clave: 'corta' })).rejects.toThrow(/8 caracteres/);
    await expect(sentenciasAltaTecnico({ ...base, localId: 'x' })).rejects.toThrow(/local/i);
  });
});
