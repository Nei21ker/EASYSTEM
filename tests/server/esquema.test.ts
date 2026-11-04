// Tarea 4: el esquema D1 conserva las reglas de la base de datos de Postgres (CHECK, UNIQUE y triggers de SQLite).
// Cada prueba inserta sus propias filas: la semilla (migración 0002) se prueba aparte en seed.test.ts.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, reiniciarBase } from './ayudas';

const { DB } = crearEntornoDePrueba();

const L1 = '00000000-0000-4000-8000-000000000001'; // accesorios
const L3 = '00000000-0000-4000-8000-000000000003'; // servicio técnico
const P1 = '11111111-1111-4111-8111-111111111111';
const E1 = '55555555-5555-4555-8555-555555555551';

const ejecutar = (sql: string, ...valores: unknown[]) => DB.prepare(sql).bind(...valores).run();
const uno = <T>(sql: string, ...valores: unknown[]) => DB.prepare(sql).bind(...valores).first<T>();

async function sembrarBase() {
  await ejecutar("INSERT INTO locales (id, nombre, tipo) VALUES (?, 'Local Accesorios', 'accesorios')", L1);
  await ejecutar("INSERT INTO locales (id, nombre, tipo) VALUES (?, 'Local Servicio Técnico', 'servicio_tecnico')", L3);
  await ejecutar("INSERT INTO productos (id, codigo_barras, nombre, categoria) VALUES (?, '2000000000015', 'Forro A', 'Forros')", P1);
}

async function insertarEmpleado(tipo = 'FIJO', frecuencia = 'QUINCENAL', salario = 400) {
  await ejecutar(
    "INSERT INTO empleados (id, local_id, nombre, apellido, cedula, cargo, salario_base, tipo, frecuencia_pago) VALUES (?, ?, 'Ana', 'Pérez', 'V-12345678', 'Cajera', ?, ?, ?)",
    E1, L1, salario, tipo, frecuencia
  );
}

async function insertarNomina(estado = 'PENDIENTE') {
  await ejecutar(
    "INSERT INTO nominas (id, empleado_id, local_id, periodo_inicio, periodo_fin, pago_base, bonos, deducciones, total_pagado, estado_pago) VALUES ('n1', ?, ?, '2026-11-01', '2026-11-15', 200, 10, 5, 205, ?)",
    E1, L1, estado
  );
}

async function insertarCuadre(estado = 'ABIERTO', fecha = '2026-11-03') {
  await ejecutar("INSERT INTO cuadres_caja (id, local_id, fecha, estado) VALUES ('c1', ?, ?, ?)", L1, fecha, estado);
}

beforeEach(async () => {
  await reiniciarBase(DB);
  await sembrarBase();
});

describe('esquema D1', () => {
  it('crea todas las tablas del sistema', async () => {
    const filas = await DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
    const nombres = new Set(filas.results.map((f) => f.name));
    const esperadas = [
      'locales', 'modelos_telefono', 'productos', 'compatibilidades', 'inventario_local', 'movimientos_inventario',
      'unidades_producto', 'ventas', 'devoluciones', 'tasas_cambio', 'ordenes_servicio', 'empleados', 'nominas',
      'nomina_reventas', 'cuadres_caja', 'traslados', 'traslado_unidades', 'suscripcion_eventos', 'perfiles', 'contadores', 'cambios',
      'user', 'session', 'account', 'verification',
    ];
    for (const tabla of esperadas) expect(nombres.has(tabla), `falta la tabla ${tabla}`).toBe(true);
  });
});

describe('movimientos y stock', () => {
  it('una ENTRADA sube el stock del local y el total del producto, y crea la fila de inventario si no existe', async () => {
    await ejecutar("INSERT INTO movimientos_inventario (id, producto_id, tipo, cantidad, local_id) VALUES ('m1', ?, 'ENTRADA', 5, ?)", P1, L1);
    const inventario = await uno<{ stock_actual: number }>('SELECT stock_actual FROM inventario_local WHERE local_id = ? AND producto_id = ?', L1, P1);
    const producto = await uno<{ stock_actual: number }>('SELECT stock_actual FROM productos WHERE id = ?', P1);
    expect(inventario?.stock_actual).toBe(5);
    expect(producto?.stock_actual).toBe(5);
  });

  it('una SALIDA mayor al stock del local se rechaza con "Stock insuficiente" y no cambia nada', async () => {
    await ejecutar("INSERT INTO movimientos_inventario (id, producto_id, tipo, cantidad, local_id) VALUES ('m1', ?, 'ENTRADA', 2, ?)", P1, L1);
    await expect(
      ejecutar("INSERT INTO movimientos_inventario (id, producto_id, tipo, cantidad, local_id) VALUES ('m2', ?, 'SALIDA', 3, ?)", P1, L1)
    ).rejects.toThrow(/Stock insuficiente/);
    const inventario = await uno<{ stock_actual: number }>('SELECT stock_actual FROM inventario_local WHERE local_id = ? AND producto_id = ?', L1, P1);
    expect(inventario?.stock_actual).toBe(2);
  });

  it('una SALIDA en un local que no maneja el producto se rechaza', async () => {
    await expect(
      ejecutar("INSERT INTO movimientos_inventario (id, producto_id, tipo, cantidad, local_id) VALUES ('m1', ?, 'SALIDA', 1, ?)", P1, L3)
    ).rejects.toThrow(/Stock insuficiente/);
  });

  it('el stock de cada local es independiente y el total del producto los suma', async () => {
    await ejecutar("INSERT INTO movimientos_inventario (id, producto_id, tipo, cantidad, local_id) VALUES ('m1', ?, 'ENTRADA', 4, ?)", P1, L1);
    await ejecutar("INSERT INTO movimientos_inventario (id, producto_id, tipo, cantidad, local_id) VALUES ('m2', ?, 'ENTRADA', 6, ?)", P1, L3);
    await ejecutar("INSERT INTO movimientos_inventario (id, producto_id, tipo, cantidad, local_id) VALUES ('m3', ?, 'SALIDA', 1, ?)", P1, L1);
    const total = await uno<{ stock_actual: number }>('SELECT stock_actual FROM productos WHERE id = ?', P1);
    expect(total?.stock_actual).toBe(9);
  });
});

describe('unidades con código único', () => {
  it('no admite dos unidades con el mismo código', async () => {
    await ejecutar("INSERT INTO unidades_producto (id, producto_id, local_id, codigo) VALUES ('u1', ?, ?, '2100000000012')", P1, L1);
    await expect(
      ejecutar("INSERT INTO unidades_producto (id, producto_id, local_id, codigo) VALUES ('u2', ?, ?, '2100000000012')", P1, L1)
    ).rejects.toThrow();
  });

  it('una unidad ya vendida no se puede vender otra vez (el lote se aborta y nada queda a medias)', async () => {
    await ejecutar("INSERT INTO unidades_producto (id, producto_id, local_id, codigo, estado) VALUES ('u1', ?, ?, '2100000000012', 'VENDIDA')", P1, L1);
    const lote = [
      DB.prepare("INSERT INTO tasas_cambio (id, fecha, tasa) VALUES ('t1', '2026-11-03', 36.5)"),
      DB.prepare("UPDATE unidades_producto SET estado = 'VENDIDA' WHERE codigo = '2100000000012'"),
    ];
    await expect(DB.batch(lote)).rejects.toThrow(/ya no está disponible/);
    const tasas = await uno<{ n: number }>('SELECT count(*) AS n FROM tasas_cambio');
    expect(tasas?.n).toBe(0);
  });

  it('marcar la etiqueta como impresa no dispara la regla de estados', async () => {
    await ejecutar("INSERT INTO unidades_producto (id, producto_id, local_id, codigo) VALUES ('u1', ?, ?, '2100000000012')", P1, L1);
    await ejecutar("UPDATE unidades_producto SET impresa_en = '2026-11-03T12:00:00.000Z' WHERE codigo = '2100000000012'");
    const fila = await uno<{ impresa_en: string }>("SELECT impresa_en FROM unidades_producto WHERE codigo = '2100000000012'");
    expect(fila?.impresa_en).toBe('2026-11-03T12:00:00.000Z');
  });
});

describe('cuadre de caja', () => {
  it('un cuadre cerrado no se puede modificar', async () => {
    await insertarCuadre('CERRADO');
    await expect(ejecutar("UPDATE cuadres_caja SET notas = 'otra' WHERE id = 'c1'")).rejects.toThrow('Este cuadre ya está cerrado y no se puede modificar.');
  });

  it('un cuadre cerrado se puede reabrir (el permiso de reabrir lo valida la API)', async () => {
    await insertarCuadre('CERRADO');
    await ejecutar("UPDATE cuadres_caja SET estado = 'ABIERTO' WHERE id = 'c1'");
    const fila = await uno<{ estado: string }>("SELECT estado FROM cuadres_caja WHERE id = 'c1'");
    expect(fila?.estado).toBe('ABIERTO');
  });

  it('solo hay un cuadre por local y día', async () => {
    await insertarCuadre();
    await expect(ejecutar("INSERT INTO cuadres_caja (id, local_id, fecha) VALUES ('c2', ?, '2026-11-03')", L1)).rejects.toThrow();
  });

  it('no se hace el cuadre de un día futuro', async () => {
    await expect(insertarCuadre('ABIERTO', '2099-01-01')).rejects.toThrow('No se puede hacer el cuadre de un día futuro.');
  });

  it('el local y el día de un cuadre no cambian', async () => {
    await insertarCuadre();
    await expect(ejecutar("UPDATE cuadres_caja SET fecha = '2026-11-02' WHERE id = 'c1'")).rejects.toThrow(/no se pueden cambiar/);
  });
});

describe('nómina', () => {
  it('un pago PAGADO no se modifica ni se borra', async () => {
    await insertarEmpleado();
    await insertarNomina('PAGADO');
    await expect(ejecutar("UPDATE nominas SET notas = 'x' WHERE id = 'n1'")).rejects.toThrow('Un pago ya registrado como PAGADO no se puede modificar');
    await expect(ejecutar("DELETE FROM nominas WHERE id = 'n1'")).rejects.toThrow(/PAGADO/);
  });

  it('un pago PENDIENTE sí se ajusta y se borra', async () => {
    await insertarEmpleado();
    await insertarNomina('PENDIENTE');
    await ejecutar("UPDATE nominas SET bonos = 20, total_pagado = 215 WHERE id = 'n1'");
    await ejecutar("DELETE FROM nominas WHERE id = 'n1'");
    const n = await uno<{ n: number }>('SELECT count(*) AS n FROM nominas');
    expect(n?.n).toBe(0);
  });

  it('el total debe ser pago_base + bonos − deducciones', async () => {
    await insertarEmpleado();
    await expect(
      ejecutar("INSERT INTO nominas (id, empleado_id, local_id, periodo_inicio, periodo_fin, pago_base, bonos, deducciones, total_pagado) VALUES ('n9', ?, ?, '2026-11-01', '2026-11-15', 200, 10, 5, 999)", E1, L1)
    ).rejects.toThrow();
  });

  it('el local del pago debe ser el del empleado', async () => {
    await insertarEmpleado();
    await expect(
      ejecutar("INSERT INTO nominas (id, empleado_id, local_id, periodo_inicio, periodo_fin, pago_base, total_pagado) VALUES ('n9', ?, ?, '2026-11-01', '2026-11-15', 200, 200)", E1, L3)
    ).rejects.toThrow();
  });

  it('no se repite el pago de un empleado en el mismo período', async () => {
    await insertarEmpleado();
    await insertarNomina();
    await expect(
      ejecutar("INSERT INTO nominas (id, empleado_id, local_id, periodo_inicio, periodo_fin, pago_base, total_pagado) VALUES ('n2', ?, ?, '2026-11-01', '2026-11-15', 200, 200)", E1, L1)
    ).rejects.toThrow();
  });

  it('una reventa por debajo del precio de lista viola la regla', async () => {
    await insertarEmpleado('INDEPENDIENTE', 'DIARIO', 0);
    await ejecutar("INSERT INTO nominas (id, empleado_id, local_id, periodo_inicio, periodo_fin, pago_base, total_pagado) VALUES ('n1', ?, ?, '2026-11-03', '2026-11-03', 0, 0)", E1, L1);
    await expect(
      ejecutar("INSERT INTO nomina_reventas (id, nomina_id, local_id, producto_nombre, cantidad, precio_lista, precio_vendido) VALUES ('r1', 'n1', ?, 'Cargador', 1, 10, 9)", L1)
    ).rejects.toThrow();
  });

  it('las líneas de reventa de un día PAGADO no se tocan', async () => {
    await insertarEmpleado('INDEPENDIENTE', 'DIARIO', 0);
    await ejecutar("INSERT INTO nominas (id, empleado_id, local_id, periodo_inicio, periodo_fin, pago_base, total_pagado) VALUES ('n1', ?, ?, '2026-11-03', '2026-11-03', 0, 0)", E1, L1);
    await ejecutar("INSERT INTO nomina_reventas (id, nomina_id, local_id, producto_nombre, cantidad, precio_lista, precio_vendido) VALUES ('r1', 'n1', ?, 'Cargador', 1, 10, 12)", L1);
    await ejecutar("UPDATE nominas SET estado_pago = 'PAGADO', pagado_en = '2026-11-03T20:00:00.000Z' WHERE id = 'n1'");
    await expect(ejecutar("DELETE FROM nomina_reventas WHERE id = 'r1'")).rejects.toThrow(/PAGADO/);
    await expect(
      ejecutar("INSERT INTO nomina_reventas (id, nomina_id, local_id, producto_nombre, cantidad, precio_lista, precio_vendido) VALUES ('r2', 'n1', ?, 'Otro', 1, 5, 6)", L1)
    ).rejects.toThrow(/PAGADO/);
  });
});

describe('empleados', () => {
  it('un trabajador independiente no puede tener frecuencia QUINCENAL', async () => {
    await expect(insertarEmpleado('INDEPENDIENTE', 'QUINCENAL', 0)).rejects.toThrow();
  });

  it('un empleado fijo no puede tener frecuencia DIARIO', async () => {
    await expect(insertarEmpleado('FIJO', 'DIARIO')).rejects.toThrow();
  });

  it('la cédula es única', async () => {
    await insertarEmpleado();
    await expect(
      ejecutar("INSERT INTO empleados (id, local_id, nombre, apellido, cedula, cargo, salario_base) VALUES ('e2', ?, 'Luis', 'Gil', 'V-12345678', 'Cajero', 100)", L1)
    ).rejects.toThrow();
  });
});

describe('órdenes de servicio', () => {
  const insertarOrden = (local: string) =>
    ejecutar(
      "INSERT INTO ordenes_servicio (id, folio, local_id, cliente_cedula, cliente_nombre, cliente_telefono, equipo_marca, equipo_modelo, falla_reportada) VALUES ('o1', 1, ?, 'V-12345678', 'Ana Pérez', '0414-1234567', 'Apple', 'iPhone 11', 'No enciende')",
      local
    );

  it('solo se registran en un local de servicio técnico', async () => {
    await expect(insertarOrden(L1)).rejects.toThrow('Las órdenes de servicio solo se registran en un local de servicio técnico');
    await insertarOrden(L3);
  });

  it('al pasar a listo y a entregado se anotan las fechas', async () => {
    await insertarOrden(L3);
    await ejecutar("UPDATE ordenes_servicio SET estado = 'listo' WHERE id = 'o1'");
    let fila = await uno<{ listo_en: string | null; entregada_en: string | null }>("SELECT listo_en, entregada_en FROM ordenes_servicio WHERE id = 'o1'");
    expect(fila?.listo_en).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
    expect(fila?.entregada_en).toBeNull();
    await ejecutar("UPDATE ordenes_servicio SET estado = 'entregado' WHERE id = 'o1'");
    fila = await uno("SELECT listo_en, entregada_en FROM ordenes_servicio WHERE id = 'o1'");
    expect(fila?.entregada_en).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
  });

  it('una orden no cambia de local', async () => {
    await insertarOrden(L3);
    await ejecutar("INSERT INTO locales (id, nombre, tipo) VALUES ('otro-servicio', 'Otro servicio', 'servicio_tecnico')");
    await expect(ejecutar("UPDATE ordenes_servicio SET local_id = 'otro-servicio' WHERE id = 'o1'")).rejects.toThrow(/no puede cambiar de local/);
  });
});

describe('contadores y cambios', () => {
  it('el tipo de local "controles" es válido y uno desconocido no', async () => {
    await ejecutar("INSERT INTO locales (id, nombre, tipo) VALUES ('l4', 'Local de controles', 'controles')");
    await expect(ejecutar("INSERT INTO locales (id, nombre, tipo) VALUES ('l5', 'Raro', 'otro')")).rejects.toThrow();
  });

  it('los perfiles solo admiten los seis roles', async () => {
    await ejecutar("INSERT INTO user (id, name, email, createdAt, updatedAt) VALUES ('u1', 'Ana', 'ana@ejemplo.com', 0, 0)");
    await ejecutar("INSERT INTO perfiles (id, email, nombre, rol) VALUES ('u1', 'ana@ejemplo.com', 'Ana', 'contador')");
    await ejecutar("INSERT INTO user (id, name, email, createdAt, updatedAt) VALUES ('u2', 'Bob', 'bob@ejemplo.com', 0, 0)");
    await expect(ejecutar("INSERT INTO perfiles (id, email, nombre, rol) VALUES ('u2', 'bob@ejemplo.com', 'Bob', 'super_admin')")).rejects.toThrow();
  });
});
