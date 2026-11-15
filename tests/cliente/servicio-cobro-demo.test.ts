// Modo demo (LocalStorage): cobro de reparaciones con reparto, técnico con acceso mínimo y pago al técnico.
// Mismas reglas que el servidor (tests/server/servicio-cobro.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_SERVICIO_TECNICO_ID } from '../../src/lib/constantes-locales';

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

async function cargarComo(email: string, clave: string, localActivo: string = LOCAL_SERVICIO_TECNICO_ID) {
  vi.resetModules();
  vi.stubEnv('PUBLIC_USAR_API', 'false');
  localStorage.setItem('easystem:local-activo', localActivo);
  const auth = await import('../../src/lib/auth');
  await auth.iniciarSesion(email, clave);
  return { s: await import('../../src/lib/inventoryService'), auth };
}

const equipo = { cliente_cedula: 'V-12345678', cliente_nombre: 'Ana Pérez', cliente_telefono: '0414-1234567', equipo_marca: 'Apple', equipo_modelo: 'iPhone 11', falla_reportada: 'Pantalla rota' };
const efectivo = (usd: number) => [{ metodo: 'USD_EFECTIVO' as const, monto_usd: usd, monto_bs: null }];

beforeEach(() => {
  const almacen = almacenSimulado();
  vi.stubGlobal('localStorage', almacen);
  vi.stubGlobal('window', { localStorage: almacen, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** El administrador registra un equipo, le da el trabajo al técnico demo y lo deja en reparación con una pantalla de $10 anotada. */
async function ordenEnReparacion() {
  const { s } = await cargarComo('admin@edwardaccesorios.com', 'admin123');
  const tecnicos = await s.listarTecnicosDeLocal(LOCAL_SERVICIO_TECNICO_ID);
  const orden = await s.crearOrdenServicio(equipo);
  const repuestos = [{ producto_id: 'p1', nombre: 'Pantalla', codigo_barras: '1', cantidad: 1, precio_unitario: 10 }];
  // Los repuestos del demo se anotan con agregarRepuestoOrden; aquí se fijan directo en la orden guardada
  const db = JSON.parse(localStorage.getItem('easystem:db:v1') ?? '{}');
  db.ordenes.find((o: { id: string }) => o.id === orden.id).repuestos = repuestos;
  localStorage.setItem('easystem:db:v1', JSON.stringify(db));
  await s.actualizarOrdenServicio(orden.id, { tecnico_id: tecnicos[0].id, estado: 'en_reparacion' });
  return { s, id: orden.id, tecnico: tecnicos[0] };
}

describe('demo: técnicos asignables', () => {
  it('lista los técnicos activos del local y el nombre sale del perfil', async () => {
    const { s } = await cargarComo('admin@edwardaccesorios.com', 'admin123');
    const lista = await s.listarTecnicosDeLocal(LOCAL_SERVICIO_TECNICO_ID);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ nombre: 'Técnico de Servicio', local_id: LOCAL_SERVICIO_TECNICO_ID });
    const orden = await s.crearOrdenServicio(equipo);
    const a = await s.actualizarOrdenServicio(orden.id, { tecnico_id: lista[0].id, tecnico_nombre: 'Falso' });
    expect(a).toMatchObject({ tecnico_id: lista[0].id, tecnico_nombre: 'Técnico de Servicio' });
    await expect(s.actualizarOrdenServicio(orden.id, { tecnico_id: 'no-es-tecnico' })).rejects.toThrow(/técnico activo/);
  });

  it('«entregado» solo se alcanza cobrando', async () => {
    const { s } = await cargarComo('admin@edwardaccesorios.com', 'admin123');
    const orden = await s.crearOrdenServicio(equipo);
    await expect(s.actualizarOrdenServicio(orden.id, { estado: 'entregado' })).rejects.toThrow(/cobrar/);
  });
});

describe('demo: cobrar una reparación', () => {
  it('ejemplo del dueño: pantalla $10, cobro $25 y 20 % → tienda $3, técnico $12', async () => {
    const { s, id } = await ordenEnReparacion();
    const o = await s.cobrarOrdenServicio(id, { total_usd: 25, porcentaje_local: 20, pagos: efectivo(25) });
    expect(o).toMatchObject({ estado: 'entregado', total_usd: 25, mano_de_obra_usd: 15, comision_local_usd: 3, pago_tecnico_usd: 12, tecnico_pagado_en: null });
    expect(o.cobrado_en).toBeTruthy();
    expect(o.entregada_en).toBeTruthy();
    expect(o.cobrado_nombre).toBe('Administrador');
  });

  it('rechaza pagos que no suman, porcentaje inválido, total menor a los repuestos y orden sin técnico', async () => {
    const { s, id } = await ordenEnReparacion();
    await expect(s.cobrarOrdenServicio(id, { total_usd: 25, porcentaje_local: 20, pagos: efectivo(20) })).rejects.toThrow(/pagos/i);
    await expect(s.cobrarOrdenServicio(id, { total_usd: 25, porcentaje_local: 120, pagos: efectivo(25) })).rejects.toThrow(/porcentaje/i);
    await expect(s.cobrarOrdenServicio(id, { total_usd: 8, porcentaje_local: 20, pagos: efectivo(8) })).rejects.toThrow(/repuestos/i);
    const sinTecnico = await s.crearOrdenServicio(equipo);
    await s.actualizarOrdenServicio(sinTecnico.id, { estado: 'en_reparacion' });
    await expect(s.cobrarOrdenServicio(sinTecnico.id, { total_usd: 5, porcentaje_local: 20, pagos: efectivo(5) })).rejects.toThrow(/técnico/i);
    await s.cobrarOrdenServicio(id, { total_usd: 25, porcentaje_local: 20, pagos: efectivo(25) });
    await expect(s.cobrarOrdenServicio(id, { total_usd: 25, porcentaje_local: 20, pagos: efectivo(25) })).rejects.toThrow(/entregada/i);
  });

  it('lo cobrado entra a lo esperado del cuadre del día del local', async () => {
    const { s, id } = await ordenEnReparacion();
    await s.cobrarOrdenServicio(id, { total_usd: 25, porcentaje_local: 20, pagos: efectivo(25) });
    const hoy = new Date();
    const fecha = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    const esperado = await s.calcularEsperadoCuadre(LOCAL_SERVICIO_TECNICO_ID, fecha);
    expect(esperado.find((e) => e.metodo === 'USD_EFECTIVO')).toMatchObject({ ventas: 1, usd: 25 });
  });
});

describe('demo: pagarle al técnico', () => {
  it('marca pagadas las órdenes cobradas; las ya pagadas no se repiten', async () => {
    const { s, id } = await ordenEnReparacion();
    await s.cobrarOrdenServicio(id, { total_usd: 25, porcentaje_local: 20, pagos: efectivo(25) });
    expect(await s.pagarTecnicosOrdenes([id])).toEqual({ pagadas: 1, total_usd: 12 });
    const o = (await s.listarOrdenesServicio()).find((x) => x.id === id)!;
    expect(o.tecnico_pagado_en).toBeTruthy();
    await expect(s.pagarTecnicosOrdenes([id])).rejects.toThrow(/por pagar/i);
  });
});

describe('demo: el técnico con acceso mínimo', () => {
  it('solo ve sus trabajos, anota diagnóstico y avanza a «listo»; no cobra, no paga ni registra equipos', async () => {
    const { id, tecnico } = await ordenEnReparacion();
    // otra orden de nadie
    const { s: admin } = await cargarComo('admin@edwardaccesorios.com', 'admin123');
    await admin.crearOrdenServicio(equipo);

    const { s } = await cargarComo('tecnico@edwardaccesorios.com', 'tecnico123');
    const mias = await s.listarOrdenesServicio();
    expect(mias.map((o) => o.id)).toEqual([id]);
    expect(mias[0].tecnico_id).toBe(tecnico.id);
    const a = await s.actualizarOrdenServicio(id, { diagnostico: 'Cambio de pantalla', estado: 'listo' });
    expect(a).toMatchObject({ diagnostico: 'Cambio de pantalla', estado: 'listo' });
    await expect(s.actualizarOrdenServicio(id, { mano_de_obra_usd: 50 })).rejects.toThrow(/técnico solo/i);
    await expect(s.cobrarOrdenServicio(id, { total_usd: 25, porcentaje_local: 20, pagos: efectivo(25) })).rejects.toThrow(/permiso|encargada/i);
    await expect(s.pagarTecnicosOrdenes([id])).rejects.toThrow(/permiso/i);
    await expect(s.crearOrdenServicio(equipo)).rejects.toThrow(/encargada/i);
  });
});

describe('el técnico solo entra a Servicio técnico', () => {
  it('protegerPagina lo manda a /servicio-tecnico desde cualquier otra página y lo deja en la suya', async () => {
    const { auth } = await cargarComo('tecnico@edwardaccesorios.com', 'tecnico123');
    const ventana = { location: { href: '' } };
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' });
    vi.stubGlobal('window', { ...(globalThis as { window: object }).window, ...ventana });
    await expect(auth.protegerPagina({ roles: ['administrador', 'encargado'] })).rejects.toThrow('EASYSTEM_REDIRECT');
    expect(ventana.location.href).toBe('/servicio-tecnico');
    await expect(auth.protegerPagina()).rejects.toThrow('EASYSTEM_REDIRECT'); // páginas sin lista de roles tampoco
    ventana.location.href = '';
    const sesion = await auth.protegerPagina({ roles: ['administrador', 'tecnico'] });
    expect(sesion.rol).toBe('tecnico');
    expect(ventana.location.href).toBe('');
  });
});
