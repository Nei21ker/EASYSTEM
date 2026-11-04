// Hojas para imprimir en papel (o guardar como PDF): hoja de despacho de un traslado y, más adelante, el inventario físico.
// Mismo método que el cuadre de caja y las etiquetas: un contenedor temporal en la página que es lo único visible al imprimir.
import type { Traslado, TrasladoUnidad } from '../types/database.types';

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
