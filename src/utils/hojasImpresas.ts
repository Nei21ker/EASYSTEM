// Hojas para imprimir en papel (o guardar como PDF): hoja de despacho de un traslado y, más adelante, el inventario físico.
// Mismo método que el cuadre de caja y las etiquetas: un contenedor temporal en la página que es lo único visible al imprimir.
import type { Intercambio, IntercambioItem, Traslado, TrasladoUnidad } from '../types/database.types';

const ID_IMPRESION = 'hoja-impresion';
const ID_ESTILO = 'hoja-impresion-estilo';

/** Estilo de impresión (A4, blanco y negro) compartido por todas las hojas. */
export const ESTILO_HOJA = `
#${ID_IMPRESION}{display:none}
@page{size:A4;margin:12mm}
@media print{
  html,body{margin:0!important;padding:0!important;background:#fff!important}
  body>*:not(#${ID_IMPRESION}){display:none!important}
  dialog{display:none!important}
  #${ID_IMPRESION}{display:block!important;color:#000;background:#fff;font-family:Arial,Helvetica,sans-serif;font-size:10.5pt;line-height:1.35}
  #${ID_IMPRESION} h1{font-size:16pt;margin:0}
  #${ID_IMPRESION} h2{font-size:11.5pt;margin:14px 0 6px;border-bottom:1px solid #000;padding-bottom:2px}
  #${ID_IMPRESION} .hi-cab{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px}
  #${ID_IMPRESION} .hi-sello{border:2px solid #000;padding:3px 10px;font-weight:700;letter-spacing:.05em}
  #${ID_IMPRESION} table{width:100%;border-collapse:collapse}
  #${ID_IMPRESION} th,#${ID_IMPRESION} td{border:1px solid #444;padding:4px 6px;text-align:left;vertical-align:top}
  #${ID_IMPRESION} thead{display:table-header-group}
  #${ID_IMPRESION} tr{break-inside:avoid}
  #${ID_IMPRESION} th{background:#e8e8e8;font-size:9pt}
  #${ID_IMPRESION} .hi-der{text-align:right;white-space:nowrap}
  #${ID_IMPRESION} .hi-centro{text-align:center;white-space:nowrap}
  #${ID_IMPRESION} .hi-cod{font-family:"Courier New",monospace;white-space:nowrap}
  #${ID_IMPRESION} .hi-meta td{border:none;padding:1px 6px 1px 0}
  #${ID_IMPRESION} .hi-pie{margin-top:16px;font-size:8.5pt;color:#333}
  #${ID_IMPRESION} .hi-firmas{display:flex;gap:30px;margin-top:40px;break-inside:avoid}
  #${ID_IMPRESION} .hi-ancho{width:24mm}
  #${ID_IMPRESION} .hi-blanco{height:7mm}
  #${ID_IMPRESION} .hi-subtotal td{background:#f2f2f2}
  #${ID_IMPRESION} .hi-producto{break-inside:avoid;margin-bottom:8px}
  #${ID_IMPRESION} .hi-prod-titulo{margin:6px 0 2px}
  #${ID_IMPRESION} .hi-piezas td{border:1px solid #888;padding:2px 4px;font-size:9pt}
  #${ID_IMPRESION} .hi-chk{width:6mm;text-align:center;font-size:11pt}
  #${ID_IMPRESION} .hi-ajustes{margin-top:14px;break-inside:avoid}
  #${ID_IMPRESION} .hi-firma{flex:1;border-top:1px solid #000;padding-top:3px;text-align:center;font-size:9pt}
}`;

export function escapar(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const folioTexto = (folio: number) => `#${String(folio).padStart(4, '0')}`;
const fechaHora = (valor: string | Date) => new Date(valor).toLocaleString('es-VE', { dateStyle: 'medium', timeStyle: 'short' });

/** Piezas agrupadas por producto, con su cantidad, en orden alfabético. */
export function resumenPorProducto(unidades: Pick<TrasladoUnidad, 'producto_id' | 'producto_nombre'>[]): { producto_id: string; nombre: string; cantidad: number }[] {
  const grupos = new Map<string, { producto_id: string; nombre: string; cantidad: number }>();
  for (const u of unidades) {
    const g = grupos.get(u.producto_id);
    if (g) g.cantidad += 1;
    else grupos.set(u.producto_id, { producto_id: u.producto_id, nombre: u.producto_nombre, cantidad: 1 });
  }
  return [...grupos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/**
 * Hoja de despacho de un traslado: qué sale, de dónde a dónde, con una casilla por pieza para que quien recibe
 * verifique lo que llega, y las firmas de quien entrega, quien transporta y quien recibe.
 */
export function htmlHojaDespacho(t: Traslado, opciones: { impresoPor?: string; ahora?: Date } = {}): string {
  const origen = t.origen_nombre ?? 'Origen';
  const destino = t.destino_nombre ?? 'Destino';
  const sello = t.estado === 'EN_TRANSITO' ? 'EN TRÁNSITO' : t.estado === 'RECIBIDO' ? 'RECIBIDO' : 'ANULADO';
  const meta: [string, string][] = [
    ['De', origen],
    ['Para', destino],
    ['Despachado', `${fechaHora(t.creado_en)} por ${t.enviado_por}`],
    ...(t.recibido_en && t.recibido_por ? ([['Recibido', `${fechaHora(t.recibido_en)} por ${t.recibido_por}`]] as [string, string][]) : []),
    ...(t.notas ? ([['Nota', t.notas]] as [string, string][]) : []),
  ];
  const resumen = resumenPorProducto(t.unidades);
  const casilla = (u: TrasladoUnidad) => (u.recibida_en ? '☑ Recibida' : u.devuelta_en ? 'Volvió al origen' : '☐');
  const detalle = [...t.unidades].sort((a, b) => a.producto_nombre.localeCompare(b.producto_nombre, 'es') || a.codigo.localeCompare(b.codigo));

  return `
<div class="hi-cab">
  <div><h1>Edward Accesorios</h1><div>Hoja de despacho · Traslado ${folioTexto(t.folio)}</div></div>
  <div class="hi-sello">${sello}</div>
</div>
<table class="hi-meta"><tbody>${meta.map(([k, v]) => `<tr><td><strong>${escapar(k)}:</strong></td><td>${escapar(v)}</td></tr>`).join('')}</tbody></table>
<h2>Resumen</h2>
<table>
  <thead><tr><th>Producto</th><th class="hi-der">Cantidad</th></tr></thead>
  <tbody>${resumen.map((r) => `<tr><td>${escapar(r.nombre)}</td><td class="hi-der">${r.cantidad}</td></tr>`).join('')}</tbody>
</table>
<p><strong>Total de piezas:</strong> ${t.unidades.length}</p>
<h2>Detalle por pieza (marca cada una al recibirla)</h2>
<table>
  <thead><tr><th class="hi-centro">N.º</th><th>Producto</th><th>Código de la pieza</th><th class="hi-centro">Llegó</th></tr></thead>
  <tbody>${detalle
    .map((u, i) => `<tr><td class="hi-centro">${i + 1}</td><td>${escapar(u.producto_nombre)}</td><td class="hi-cod">${escapar(u.codigo)}</td><td class="hi-centro">${casilla(u)}</td></tr>`)
    .join('')}</tbody>
</table>
<div class="hi-firmas">
  <div class="hi-firma">Entrega (nombre y firma)</div>
  <div class="hi-firma">Transporta (nombre y firma)</div>
  <div class="hi-firma">Recibe (nombre y firma)</div>
</div>
<p class="hi-pie">Impreso el ${escapar(fechaHora(opciones.ahora ?? new Date()))}${opciones.impresoPor ? ` por ${escapar(opciones.impresoPor)}` : ''}.</p>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Comprobante de un cambio de mercancía con otro local: lo que se entrega, lo que se recibe y las firmas de las dos partes.
// ---------------------------------------------------------------------------------------------------------------------
export function htmlHojaCambio(c: Intercambio, opciones: { impresoPor?: string; ahora?: Date; localNombre?: string } = {}): string {
  const sello = c.estado === 'COMPLETADO' ? 'COMPLETADO' : c.estado === 'EN_ESPERA' ? 'EN ESPERA' : 'ANULADO';
  const dolares = (n: number) => `$${n.toFixed(2).replace('.', ',')}`;
  const tabla = (titulo: string, items: IntercambioItem[], valor: number, nota?: string) => `
<h2>${escapar(titulo)}</h2>${nota ? `<p>${escapar(nota)}</p>` : ''}
<table>
  <thead><tr><th>Producto</th><th class="hi-der">Cantidad</th><th class="hi-der">Precio</th><th class="hi-der">Valor</th></tr></thead>
  <tbody>${items
    .map((i) => `<tr><td>${escapar(i.nombre)}${i.unidades?.length ? `<br><span class="hi-cod">${escapar(i.unidades.join(', '))}</span>` : ''}</td><td class="hi-der">${i.cantidad}</td><td class="hi-der">${dolares(i.precio_unitario)}</td><td class="hi-der">${dolares(i.cantidad * i.precio_unitario)}</td></tr>`)
    .join('')}</tbody>
</table>
<p><strong>Total:</strong> ${dolares(valor)}</p>`;
  const meta: [string, string][] = [
    ['Con', c.contraparte],
    ...(opciones.localNombre ? ([['Local', opciones.localNombre]] as [string, string][]) : []),
    ['Registrado', `${fechaHora(c.fecha)} por ${c.creado_por_nombre}`],
    ...(c.completado_en && c.completado_por_nombre ? ([['Completado', `${fechaHora(c.completado_en)} por ${c.completado_por_nombre}`]] as [string, string][]) : []),
    ...(c.estado === 'EN_ESPERA' ? ([['Pendiente', c.lado_pendiente === 'ENTRAN' ? 'Falta recibir lo que nos traen' : 'Falta entregar lo nuestro']] as [string, string][]) : []),
    ...(c.nota ? ([['Nota', c.nota]] as [string, string][]) : []),
  ];
  const diferencia = Math.round((c.valor_entra_usd - c.valor_sale_usd) * 100) / 100;
  return `
<div class="hi-cab">
  <div><h1>Edward Accesorios</h1><div>Comprobante de cambio de mercancía ${folioTexto(c.folio)}</div></div>
  <div class="hi-sello">${sello}</div>
</div>
<table class="hi-meta"><tbody>${meta.map(([k, v]) => `<tr><td><strong>${escapar(k)}:</strong></td><td>${escapar(v)}</td></tr>`).join('')}</tbody></table>
${tabla('Entregamos', c.salen, c.valor_sale_usd, c.estado === 'EN_ESPERA' && c.lado_pendiente === 'SALEN' ? 'Todavía no se ha entregado.' : undefined)}
${tabla('Recibimos', c.entran, c.valor_entra_usd, c.estado === 'EN_ESPERA' && c.lado_pendiente === 'ENTRAN' ? 'Todavía no se ha recibido.' : undefined)}
<p><strong>Diferencia (a precio de catálogo):</strong> ${diferencia === 0 ? 'sin diferencia' : `${diferencia > 0 ? 'recibimos' : 'entregamos'} ${dolares(Math.abs(diferencia))} más`}</p>
<div class="hi-firmas">
  <div class="hi-firma">Edward Accesorios (nombre y firma)</div>
  <div class="hi-firma">${escapar(c.contraparte)} (nombre y firma)</div>
</div>
<p class="hi-pie">Impreso el ${escapar(fechaHora(opciones.ahora ?? new Date()))}${opciones.impresoPor ? ` por ${escapar(opciones.impresoPor)}` : ''}.</p>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Inventario físico: la hoja para contar a mano lo que hay en un local y compararlo con lo que dice el sistema.
// ---------------------------------------------------------------------------------------------------------------------
export interface FilaInventario {
  categoria: string;
  codigo: string;
  nombre: string;
  /** Existencias que dice el sistema en ese local */
  stock: number;
}

export interface PiezaInventario {
  codigo: string;
  producto_id: string;
  nombre: string;
  categoria: string;
}

const SIN_CATEGORIA = 'Sin categoría';
const comparar = (a: string, b: string) => a.localeCompare(b, 'es');

/** Agrupa por categoría (alfabética, "Sin categoría" al final) y ordena los productos por nombre dentro de cada una. */
export function agruparPorCategoria<T extends { categoria: string; nombre: string }>(filas: T[]): { categoria: string; filas: T[] }[] {
  const grupos = new Map<string, T[]>();
  for (const f of filas) {
    const categoria = f.categoria.trim() || SIN_CATEGORIA;
    grupos.set(categoria, [...(grupos.get(categoria) ?? []), f]);
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => (a === SIN_CATEGORIA ? 1 : b === SIN_CATEGORIA ? -1 : comparar(a, b)))
    .map(([categoria, lista]) => ({ categoria, filas: [...lista].sort((x, y) => comparar(x.nombre, y.nombre)) }));
}

interface DatosHojaInventario {
  local: string;
  ahora?: Date;
  impresoPor?: string;
}

function cabeceraInventario(d: DatosHojaInventario, subtitulo: string, sello: string): string {
  const cuando = fechaHora(d.ahora ?? new Date());
  return `
<div class="hi-cab">
  <div><h1>Edward Accesorios</h1><div>Inventario físico · ${escapar(subtitulo)}</div></div>
  <div class="hi-sello">${escapar(sello)}</div>
</div>
<table class="hi-meta"><tbody>
  <tr><td><strong>Local:</strong></td><td>${escapar(d.local)}</td></tr>
  <tr><td><strong>Existencias del sistema al:</strong></td><td>${escapar(cuando)}</td></tr>
  <tr><td><strong>Fecha del conteo:</strong></td><td>____ / ____ / ________</td></tr>
</tbody></table>`;
}

function pieInventario(d: DatosHojaInventario): string {
  return `
<div class="hi-firmas">
  <div class="hi-firma">Contó (nombre y firma)</div>
  <div class="hi-firma">Revisó (nombre y firma)</div>
</div>
<p class="hi-pie">Impreso el ${escapar(fechaHora(d.ahora ?? new Date()))}${d.impresoPor ? ` por ${escapar(d.impresoPor)}` : ''}. No incluye piezas en tránsito ni dadas de baja. Si el sistema cambió después de imprimir (ventas, ingresos), la hoja ya no refleja esos movimientos.</p>`;
}

/** Hoja por producto: una línea por producto con lo que dice el sistema y espacio para anotar lo contado y la diferencia. */
export function htmlInventarioPorProducto(d: DatosHojaInventario & { filas: FilaInventario[] }): string {
  const cab = cabeceraInventario(d, 'por producto', 'CONTEO');
  if (d.filas.length === 0) return `${cab}<p>No hay productos con existencias para contar en este local.</p>${pieInventario(d)}`;
  const total = d.filas.reduce((s, f) => s + f.stock, 0);
  const cuerpo = agruparPorCategoria(d.filas)
    .map((g) => {
      const subtotal = g.filas.reduce((s, f) => s + f.stock, 0);
      return `
<h2>${escapar(g.categoria)} (${g.filas.length} ${g.filas.length === 1 ? 'producto' : 'productos'})</h2>
<table>
  <thead><tr><th>Código</th><th>Producto</th><th class="hi-der">En sistema</th><th class="hi-ancho">Contado</th><th class="hi-ancho">Diferencia</th></tr></thead>
  <tbody>${g.filas
    .map((f) => `<tr><td class="hi-cod">${escapar(f.codigo)}</td><td>${escapar(f.nombre)}</td><td class="hi-der">${f.stock}</td><td class="hi-blanco"></td><td class="hi-blanco"></td></tr>`)
    .join('')}
  <tr class="hi-subtotal"><td colspan="2"><strong>Subtotal ${escapar(g.categoria)}</strong></td><td class="hi-der"><strong>${subtotal}</strong></td><td></td><td></td></tr></tbody>
</table>`;
    })
    .join('');
  return `${cab}
<p><strong>Productos:</strong> ${d.filas.length} &nbsp;·&nbsp; <strong>Total de unidades:</strong> ${total}</p>
${cuerpo}
${pieInventario(d)}`;
}

/**
 * Hoja por pieza: el código de CADA pieza que el sistema dice que hay, con una casilla para marcarla al encontrarla.
 * Pensada para verificar con el lector de códigos pieza por pieza.
 */
export function htmlInventarioPorPieza(d: DatosHojaInventario & { piezas: PiezaInventario[] }): string {
  const cab = cabeceraInventario(d, 'por pieza', 'CONTEO');
  if (d.piezas.length === 0) return `${cab}<p>No hay piezas disponibles para contar en este local.</p>${pieInventario(d)}`;
  const porProducto = new Map<string, PiezaInventario[]>();
  for (const p of d.piezas) porProducto.set(p.producto_id, [...(porProducto.get(p.producto_id) ?? []), p]);
  const productos = [...porProducto.values()].map((lista) => ({ categoria: lista[0].categoria, nombre: lista[0].nombre, piezas: [...lista].sort((a, b) => a.codigo.localeCompare(b.codigo)) }));
  const COLUMNAS = 3;
  const cuerpo = agruparPorCategoria(productos)
    .map((g) => {
      const bloques = g.filas
        .map((prod) => {
          const filasHtml: string[] = [];
          for (let i = 0; i < prod.piezas.length; i += COLUMNAS) {
            const celdas = prod.piezas.slice(i, i + COLUMNAS).map((p) => `<td class="hi-chk">☐</td><td class="hi-cod">${escapar(p.codigo)}</td>`);
            while (celdas.length < COLUMNAS) celdas.push('<td class="hi-chk"></td><td></td>');
            filasHtml.push(`<tr>${celdas.join('')}</tr>`);
          }
          const n = prod.piezas.length;
          return `<div class="hi-producto"><p class="hi-prod-titulo"><strong>${escapar(prod.nombre)}</strong> — ${n} ${n === 1 ? 'pieza' : 'piezas'}</p><table class="hi-piezas"><tbody>${filasHtml.join('')}</tbody></table></div>`;
        })
        .join('');
      return `<h2>${escapar(g.categoria)}</h2>${bloques}`;
    })
    .join('');
  return `${cab}
<p><strong>Total de piezas:</strong> ${d.piezas.length}</p>
${cuerpo}
<div class="hi-ajustes">
  <p><strong>Piezas que sobran</strong> (están en el local y no aparecen en la lista): ______________________________________________</p>
  <p><strong>Piezas que faltan</strong> (códigos sin marcar): ______________________________________________</p>
</div>
${pieInventario(d)}`;
}

function limpiarImpresion() {
  document.getElementById(ID_IMPRESION)?.remove();
  document.getElementById(ID_ESTILO)?.remove();
}

/** Muestra la hoja como lo único imprimible de la página y abre el diálogo de impresión (o guardar como PDF). */
export async function imprimirHoja(html: string): Promise<void> {
  limpiarImpresion();
  const estilo = document.createElement('style');
  estilo.id = ID_ESTILO;
  estilo.textContent = ESTILO_HOJA;
  const contenedor = document.createElement('div');
  contenedor.id = ID_IMPRESION;
  contenedor.innerHTML = html;
  document.head.appendChild(estilo);
  document.body.appendChild(contenedor);
  window.addEventListener('afterprint', limpiarImpresion, { once: true });
  window.setTimeout(limpiarImpresion, 120_000);
  window.print();
}
