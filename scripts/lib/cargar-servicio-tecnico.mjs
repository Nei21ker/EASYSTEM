// Carga inicial del Local Servicio Técnico a partir del texto del inventario (datos-servicio-tecnico/inventario.txt).
//
// Crea los productos SIN foto y SIN precio (precio $0) y deja la cantidad de cada uno en el local con el endpoint de «carga inicial»
// (`POST /api/productos/:id/cantidad`): la cantidad se fija SIN movimientos, así que no aparece en Movimientos, Reportes ni Inversión.
// Después el personal entra a Productos → Editar, corrige la cantidad si hace falta y pone la foto y el precio; con foto y precio el
// producto queda activo y desde ahí todo cambio de stock es un movimiento normal.
//
// `api` es cualquier objeto con get/post (el cliente real está en cliente-api.mjs; las pruebas usan uno simulado).
import { LOCAL_SERVICIO_TECNICO_ID } from '../../src/lib/constantes-locales.ts';
import { generarCodigosInternos } from '../../src/utils/codigos.ts';
import { parsearInventarioServicioTecnico } from './leer-servicio-tecnico.mjs';

export const LOCAL_SERVICIO_TECNICO = LOCAL_SERVICIO_TECNICO_ID;

const PRODUCTOS_POR_LOTE = 100;
const INVENTARIO_POR_LOTE = 200;

const clave = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const trozos = (lista, n) => Array.from({ length: Math.ceil(lista.length / n) }, (_, i) => lista.slice(i * n, (i + 1) * n));

/** Muestra lo que se encontró en el texto (sin tocar la red): totales, líneas dudosas, notas ignoradas y nombres sumados. */
export function resumirLectura(lectura, log = console.log) {
  const { filas, dudosas, ignoradas, fusionados } = lectura;
  const unidades = filas.reduce((s, f) => s + f.cantidad, 0);
  log(`\nProductos distintos: ${filas.length}`);
  log(`Unidades en total: ${unidades}`);
  const porCategoria = new Map();
  for (const f of filas) porCategoria.set(f.categoria, (porCategoria.get(f.categoria) ?? 0) + 1);
  log('Por categoría (la sugiere el programa; se corrige en Editar):');
  for (const [categoria, n] of [...porCategoria].sort((a, b) => b[1] - a[1])) log(`  ${categoria}: ${n}`);

  if (fusionados.length > 0) {
    log(`\nNombres repetidos que se SUMARON en un solo producto (${fusionados.length}):`);
    for (const f of fusionados) log(`  • ${f.nombre}: líneas ${f.lineas.join(' y ')} (${f.cantidades.join(' + ')} = ${f.cantidades.reduce((a, b) => a + b, 0)})`);
  }
  if (ignoradas.length > 0) {
    log(`\nLíneas que NO son productos y se ignoraron (${ignoradas.length}):`);
    for (const i of ignoradas) log(`  • línea ${i.linea}: ${i.texto}`);
  }
  if (dudosas.length > 0) {
    log(`\nLíneas DUDOSAS: se cargan con el número que traen (sin signo), pero conviene revisarlas (${dudosas.length}):`);
    for (const d of dudosas) log(`  • línea ${d.linea}: ${d.texto}  →  ${d.motivo}`);
  }
}

/**
 * @param {{ texto: string, api: any, confirmar: (r: { productos: number, unidades: number }) => Promise<boolean>, log?: (t: string) => void, localId?: string }} opciones
 * @returns {Promise<{ escrito: boolean, creados?: number, completados?: number, omitidos?: number, unidades?: number, problemas?: string[] }>}
 */
export async function cargarServicioTecnico({ texto, api, confirmar, log = console.log, localId = LOCAL_SERVICIO_TECNICO }) {
  const lectura = parsearInventarioServicioTecnico(texto);
  if (lectura.filas.length === 0) {
    log('\nNo encontré ningún producto en el texto. NO se escribió nada.');
    return { escrito: false, problemas: ['El texto no tiene productos.'] };
  }
  resumirLectura(lectura, log);
  const resumen = { productos: lectura.filas.length, unidades: lectura.filas.reduce((s, f) => s + f.cantidad, 0) };
  if (!(await confirmar(resumen))) {
    log('\nCancelado: no se escribió nada.');
    return { escrito: false };
  }

  // Lo que ya existe (por si se vuelve a ejecutar): se compara por nombre
  const existentes = await api.get('/api/productos');
  const porNombre = new Map(existentes.map((p) => [clave(p.nombre), p]));
  const stockEnLocal = (p) => p.inventario?.find((i) => i.local_id === localId)?.stock_actual ?? 0;

  const nuevas = [];
  const completar = [];
  let omitidos = 0;
  for (const fila of lectura.filas) {
    const previo = porNombre.get(clave(fila.nombre));
    if (!previo) nuevas.push(fila);
    else if (stockEnLocal(previo) > 0 || fila.cantidad === 0) omitidos++; // ya cargado: no se pisa lo que alguien ya corrigió
    else completar.push({ fila, producto: previo }); // carga interrumpida: solo falta la cantidad
  }

  // 1) Productos nuevos (sin foto y con precio 0), con un código de barras interno que no choque con ninguno
  const usados = new Set(existentes.map((p) => p.codigo_barras));
  const internos = generarCodigosInternos([...usados], nuevas.length);
  const objetivos = []; // { fila, id }
  for (const lote of trozos(nuevas.map((fila, i) => ({ fila, codigo: internos[i] })), PRODUCTOS_POR_LOTE)) {
    const creados = await api.post('/api/productos/lote', {
      filas: lote.map(({ fila, codigo }) => ({
        codigo_barras: codigo,
        nombre: fila.nombre,
        categoria: fila.categoria,
        precio_compra: 0,
        precio_venta: 0,
        stock_minimo: 0,
      })),
    });
    const idPorCodigo = new Map(creados.map((c) => [c.codigo_barras, c.id]));
    for (const { fila, codigo } of lote) objetivos.push({ fila, id: idPorCodigo.get(codigo) });
  }
  for (const { fila, producto } of completar) objetivos.push({ fila, id: producto.id });

  // 2) Alta en el Local Servicio Técnico (stock mínimo 0 = sin alertas)
  for (const lote of trozos(objetivos, INVENTARIO_POR_LOTE)) {
    await api.post(`/api/locales/${localId}/inventario/minimos`, { filas: lote.map((o) => ({ producto_id: o.id, stock_minimo: 0 })) });
  }

  // 3) Cantidad de cada uno, sin movimientos (endpoint de carga inicial)
  let unidades = 0;
  for (const o of objetivos) {
    if (o.fila.cantidad <= 0) continue;
    try {
      await api.post(`/api/productos/${o.id}/cantidad`, { localId, cantidad: o.fila.cantidad });
    } catch (err) {
      throw new Error(`Se crearon los productos pero falló la cantidad de "${o.fila.nombre}" (${err.message}). Vuelve a ejecutar el script: completa lo que falta sin duplicar.`);
    }
    unidades += o.fila.cantidad;
  }

  log(`\nListo: ${nuevas.length} producto(s) creado(s), ${completar.length} completado(s), ${omitidos} ya estaban cargados; ${unidades} unidad(es) dejadas en el Local Servicio Técnico (sin movimientos).`);
  return { escrito: true, creados: nuevas.length, completados: completar.length, omitidos, unidades };
}
