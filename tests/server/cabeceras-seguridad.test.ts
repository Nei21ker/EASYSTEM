import { describe, expect, it } from 'vitest';
import { conCabecerasDeSeguridad, CABECERAS_API } from '../../src/server/cabeceras';

describe('conCabecerasDeSeguridad (respuestas del Worker)', () => {
  it('agrega las cabeceras de seguridad sin tocar el cuerpo, el estado ni las cookies', async () => {
    const original = new Response('{"ok":true}', {
      status: 201,
      headers: { 'content-type': 'application/json', 'set-cookie': 'sesion=abc; HttpOnly; Secure' },
    });
    const r = conCabecerasDeSeguridad(original);
    expect(r.status).toBe(201);
    expect(await r.text()).toBe('{"ok":true}');
    expect(r.headers.get('set-cookie')).toContain('HttpOnly');
    expect(r.headers.get('content-type')).toBe('application/json');
    for (const [nombre, valor] of Object.entries(CABECERAS_API)) expect(r.headers.get(nombre)).toBe(valor);
  });

  it('impide el sniffing, el marco en otros sitios y el envío del referente, y fuerza HTTPS', () => {
    const r = conCabecerasDeSeguridad(new Response('x'));
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(r.headers.get('referrer-policy')).toBe('same-origin');
    expect(r.headers.get('strict-transport-security')).toMatch(/max-age=\d{7,}/);
    expect(r.headers.get('permissions-policy')).toContain('camera=(self)');
    expect(r.headers.get('permissions-policy')).toContain('geolocation=()');
  });

  it('no pisa una cabecera que la ruta ya puso (p. ej. el nosniff de los archivos)', () => {
    const r = conCabecerasDeSeguridad(new Response('x', { headers: { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' } }));
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('una respuesta de redirección con cuerpo nulo sigue funcionando', () => {
    const r = conCabecerasDeSeguridad(new Response(null, { status: 302, headers: { location: '/login' } }));
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/login');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
  });
});
