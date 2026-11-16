import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { exigirOrigenPropio, leerJson } from '../../src/server/http';
import { ErrorApi } from '../../src/server/errores';

const esquema = z.object({ nombre: z.string().min(2), cantidad: z.number().int().positive() });
const peticion = (cuerpo: string) => new Request('http://localhost:8787/api/x', { method: 'POST', body: cuerpo, headers: { 'content-type': 'application/json' } });

describe('leerJson', () => {
  it('devuelve el cuerpo validado', async () => {
    expect(await leerJson(peticion('{"nombre":"Ana","cantidad":3}'), esquema)).toEqual({ nombre: 'Ana', cantidad: 3 });
  });

  it('un cuerpo que no es JSON responde 400 json_invalido', async () => {
    await expect(leerJson(peticion('esto no es json'), esquema)).rejects.toMatchObject({ status: 400, codigo: 'json_invalido' });
  });

  it('un cuerpo que no cumple el esquema responde 400 con el campo que falló', async () => {
    const error = (await leerJson(peticion('{"nombre":"A","cantidad":0}'), esquema).catch((e) => e)) as ErrorApi;
    expect(error).toBeInstanceOf(ErrorApi);
    expect(error.status).toBe(400);
    expect(error.codigo).toBe('datos_invalidos');
    expect(error.message).toContain('nombre');
    expect(error.message).toContain('cantidad');
  });
});

describe('exigirOrigenPropio (defensa extra contra peticiones desde otros sitios)', () => {
  const pedir = (metodo: string, cabeceras: Record<string, string> = {}) =>
    new Request('https://easystem.example.workers.dev/api/ventas', { method: metodo, headers: cabeceras });

  it('una escritura que dice venir de OTRO sitio se rechaza con 403 origen_invalido', () => {
    expect(() => exigirOrigenPropio(pedir('POST', { origin: 'https://sitio-malo.example' }))).toThrowError(
      expect.objectContaining({ status: 403, codigo: 'origen_invalido' })
    );
    expect(() => exigirOrigenPropio(pedir('DELETE', { 'sec-fetch-site': 'cross-site' }))).toThrowError(expect.objectContaining({ status: 403 }));
  });

  it('el mismo sitio, las lecturas y las llamadas sin cabecera de origen (scripts, pruebas) pasan', () => {
    expect(() => exigirOrigenPropio(pedir('POST', { origin: 'https://easystem.example.workers.dev' }))).not.toThrow();
    expect(() => exigirOrigenPropio(pedir('POST', { 'sec-fetch-site': 'same-origin' }))).not.toThrow();
    expect(() => exigirOrigenPropio(pedir('POST'))).not.toThrow();
    expect(() => exigirOrigenPropio(pedir('GET', { origin: 'https://sitio-malo.example' }))).not.toThrow();
  });

  it('un origen mal formado se rechaza', () => {
    expect(() => exigirOrigenPropio(pedir('PATCH', { origin: 'no es una url' }))).toThrowError(expect.objectContaining({ status: 403 }));
  });
});
