// Carga inicial del Local de controles: crea los productos, sube las fotos y registra el stock como un movimiento de
// ENTRADA (el stock nunca se escribe directamente), todo a través de la API como administrador.
// `api` es cualquier objeto con get/post/patch/subir (el cliente real está en cliente-api.mjs; las pruebas usan uno simulado).
import sharp from 'sharp';
import { LOCAL_CONTROLES_ID } from '../../src/lib/constantes-locales.ts';
import { generarCodigosInternos } from '../../src/utils/codigos.ts';
import { leerInventario } from './leer-inventario.mjs';

export const LOCAL_CONTROLES = LOCAL_CONTROLES_ID;
export const MOTIVO_CARGA = 'Carga inicial (importación)';

// Topes del servidor
const PRODUCTOS_POR_LOTE = 100;
const MOVIMIENTOS_POR_LOTE = 50;
const UNIDADES_POR_LOTE = 500;
const INVENTARIO_POR_LOTE = 200;
const LADO_MAXIMO = 720;

const clave = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const trozos = (lista, n) => Array.from({ length: Math.ceil(lista.length / n) }, (_, i) => lista.slice(i * n, (i + 1) * n));

/** Foto reducida a JPEG de lado máximo 720 px (respeta la orientación de la cámara; no agranda las pequeñas). */
export async function reducirFoto(ruta) {
  return sharp(ruta)
    .rotate()
    .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
}

function resumen(filas) {
  const unidades = filas.reduce((s, f) => s + f.cantidad, 0);
  const valor = filas.reduce((s, f) => s + f.cantidad * f.precio_venta, 0);
  return { productos: filas.length, unidades, valor: Math.round(valor * 100) / 100 };
}

/**
 * @param {{ carpeta: string, api: any, confirmar: (resumen: any) => Promise<boolean>, log?: (texto: string) => void, localId?: string }} opciones
 * @returns {Promise<{ escrito: boolean, creados?: number, completados?: number, omitidos?: number, unidades?: number, problemas?: string[] }>}
 */
export async function cargarControles({ carpeta, api, confirmar, log = console.log, localId = LOCAL_CONTROLES }) {
  const { filas, problemas } = await leerInventario(carpeta);
  if (problemas.length > 0) {
    log(`\nEncontré ${problemas.length} problema(s) en tus datos. NO se escribió nada; corrígelos y vuelve a ejecutar:\n`);
    for (const p of problemas) log(`  • ${p}`);
    return { escrito: false, problemas };
  }

  const r = resumen(filas);
  log(`\nResumen de lo que se va a cargar al Local de controles:`);
  log(`  Productos: ${r.productos}`);
  log(`  Unidades en total: ${r.unidades}`);
  log(`  Valor a precio de venta: $${r.valor.toFixed(2)}`);
  if (!(await confirmar(r))) {
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
  for (const fila of filas) {
    const previo = porNombre.get(clave(fila.nombre));
    if (!previo) nuevas.push(fila);
    else if (stockEnLocal(previo) > 0) omitidos++; // ya cargado: no se duplica el stock
    else completar.push({ fila, producto: previo }); // carga interrumpida: se completa foto y stock
  }

  // Códigos de barras: el de fábrica si lo hay; si no, uno interno que no choque con ninguno existente
  const usados = new Set(existentes.map((p) => p.codigo_barras));
  for (const fila of nuevas) {
    if (fila.codigo_fabrica && usados.has(fila.codigo_fabrica)) {
      throw new Error(`El código ${fila.codigo_fabrica} (${fila.nombre}) ya lo usa otro producto del sistema. No se escribió nada.`);
    }
    if (fila.codigo_fabrica) usados.add(fila.codigo_fabrica);
  }
  const sinCodigo = nuevas.filter((f) => !f.codigo_fabrica);
  const internos = generarCodigosInternos([...usados], sinCodigo.length);
  const codigoDe = new Map(sinCodigo.map((f, i) => [f, internos[i]]));

  // 1) Productos nuevos
  const objetivos = []; // { fila, id }
  for (const lote of trozos(nuevas, PRODUCTOS_POR_LOTE)) {
    const creados = await api.post('/api/productos/lote', {
      filas: lote.map((f) => ({
        codigo_barras: f.codigo_fabrica ?? codigoDe.get(f),
        nombre: f.nombre,
        categoria: f.categoria,
        precio_compra: f.precio_compra ?? 0,
        precio_venta: f.precio_venta,
        stock_minimo: f.stock_minimo ?? 0,
      })),
    });
    const idPorCodigo = new Map(creados.map((c) => [c.codigo_barras, c.id]));
    for (const f of lote) objetivos.push({ fila: f, id: idPorCodigo.get(f.codigo_fabrica ?? codigoDe.get(f)), tieneFoto: false });
  }
  for (const { fila, producto } of completar) objetivos.push({ fila, id: producto.id, tieneFoto: !!producto.imagen_url });

  // 2) Fotos (reducidas); si una falla, lo ya creado queda y al volver a ejecutar se completa
  for (const o of objetivos) {
    if (o.tieneFoto) continue;
    try {
      const url = await api.subir(`/api/archivos/producto/${o.id}`, await reducirFoto(o.fila.ruta_foto), 'image/jpeg');
      await api.patch(`/api/productos/${o.id}`, { imagen_url: url });
    } catch (err) {
      throw new Error(`Se crearon los productos pero falló la foto de "${o.fila.nombre}" (${err.message}). Vuelve a ejecutar el script: completa lo que falta sin duplicar.`);
    }
  }

  // 3) Alta en el Local de controles (con su stock mínimo)
  for (const lote of trozos(objetivos, INVENTARIO_POR_LOTE)) {
    await api.post(`/api/locales/${localId}/inventario/minimos`, {
      filas: lote.map((o) => ({ producto_id: o.id, stock_minimo: o.fila.stock_minimo ?? 0 })),
    });
  }

  // 4) Stock: SOLO como movimientos de ENTRADA, en lotes atómicos (≤50 movimientos y ≤500 unidades)
  const partidas = [];
  for (const o of objetivos) {
    for (let resto = o.fila.cantidad; resto > 0; resto -= UNIDADES_POR_LOTE) {
      partidas.push({ productoId: o.id, tipo: 'ENTRADA', cantidad: Math.min(resto, UNIDADES_POR_LOTE), localId, motivo: MOTIVO_CARGA });
    }
  }
  let lote = [];
  let unidadesLote = 0;
  const enviar = async () => {
    if (lote.length === 0) return;
    await api.post('/api/movimientos/lote', { movimientos: lote });
    lote = [];
    unidadesLote = 0;
  };
  for (const p of partidas) {
    if (lote.length >= MOVIMIENTOS_POR_LOTE || unidadesLote + p.cantidad > UNIDADES_POR_LOTE) await enviar();
    lote.push(p);
    unidadesLote += p.cantidad;
  }
  await enviar();

  const unidades = objetivos.reduce((s, o) => s + o.fila.cantidad, 0);
  log(`\nListo: ${nuevas.length} producto(s) creado(s), ${completar.length} completado(s), ${omitidos} ya estaban cargados; ${unidades} unidad(es) ingresadas al Local de controles.`);
  return { escrito: true, creados: nuevas.length, completados: completar.length, omitidos, unidades };
}
