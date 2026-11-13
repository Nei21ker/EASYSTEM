// Lee el texto del inventario del Local Servicio Técnico (lo que pasó el personal, una pieza por línea: «02 Audífono inalámbrico M90 Pro»)
// y lo convierte en una lista de productos con su cantidad. NO toca la red ni la base de datos.
//
// Reglas (la lista es de conteo a mano, así que tiene rarezas):
//   · «NN nombre» es un producto con NN unidades; «(und)» se ignora.
//   · Las líneas vacías se saltan. Las notas («- Nota: …», «- El señor Edward se lleva…», «(Salida …)») NO son productos: se
//     devuelven en `ignoradas` para que se vean.
//   · Una línea con un guion antes o después del número («-10 …», «- 121 …», «2- …», «-15- …», «1-02 …», «1-3- …») sí se carga, con el
//     número tal cual (sin signo), pero queda en `dudosas`: no se sabe si el guion marca algo vendido o es un tachón.
//   · Una cantidad de 100 o más también es dudosa (suele ser un «0» de más: 303 por 03).
//   · Dos líneas con el mismo nombre (sin importar mayúsculas, acentos ni espacios) se SUMAN en un solo producto (`fusionados`).
//   · Un nombre que termina en «...» (cortado al pasarlo) también queda en `dudosas`.
//   · «(Se llevaron 01 …)» al final del nombre es una observación, no parte del nombre: se quita y la línea queda en `dudosas`.
// Todas las cantidades se pueden corregir luego en Productos → Editar mientras el producto no tenga foto y precio.

export const CATEGORIA_DEFECTO = 'Otros';

const sinAcentos = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '');
const clave = (t) => sinAcentos(String(t)).toLowerCase().replace(/\s+/g, ' ').trim();
const limpio = (t) => String(t).replace(/\s+/g, ' ').trim();

// Primera regla que coincida (sobre el nombre sin acentos y en minúsculas). Es solo una sugerencia: la categoría se edita luego.
const REGLAS_CATEGORIA = [
  [/power ?bank|battery pack|\bups\b|energy cup/, 'Power banks y UPS'],
  [/cargador|\btacos?\b|enchufe|wireless car/, 'Cargadores'],
  [/bateria/, 'Baterías'],
  [/audifon|auricular|manos libres|headset/, 'Audífonos'],
  [/cornet|microfono|kit de grabacion/, 'Cornetas y micrófonos'],
  [/pendrive|memoria|porta memoria/, 'Memorias y pendrives'],
  [/router|wifi|repetidor|modem|antena|android ?tv|ontv/, 'Redes y wifi'],
  [/porta |holder|soporte|\bbase\b|selfie|mobic|collapsible/, 'Soportes y porta teléfonos'],
  [/cable|convertidor|adaptador|hdmi|\botg\b|puntas/, 'Cables y adaptadores'],
  [/reloj|watch/, 'Relojes'],
  [/telefono|nokia|alcatel|\bzte\b|panasonic|uniwa|techfuerza|radio|baofeng/, 'Teléfonos y radios'],
  [/consola|juego|control|game|rifle|carro torson|pistola/, 'Juegos y controles'],
];

export function categoriaSugerida(nombre) {
  const n = sinAcentos(nombre).toLowerCase();
  for (const [patron, categoria] of REGLAS_CATEGORIA) if (patron.test(n)) return categoria;
  return CATEGORIA_DEFECTO;
}

// Una línea de producto: [guion] número [guion[número][guion]] [(und)] nombre
const PRODUCTO = /^(-)?\s*(\d+)((?:-\d*)*)-?\s*(?:\(\s*und\s*\)\s*)?(.+)$/i;
const NOTA = /^(?:-\s*)?(?:nota\b|[A-Za-zÁÉÍÓÚÑáéíóúñ(])/;

/**
 * @param {string} texto
 * @returns {{
 *   filas: Array<{ linea: number, nombre: string, cantidad: number, categoria: string }>,
 *   dudosas: Array<{ linea: number, texto: string, motivo: string }>,
 *   ignoradas: Array<{ linea: number, texto: string }>,
 *   fusionados: Array<{ nombre: string, lineas: number[], cantidades: number[] }>,
 * }}
 */
export function parsearInventarioServicioTecnico(texto) {
  const filas = [];
  const dudosas = [];
  const ignoradas = [];
  const porNombre = new Map();
  const fusionados = new Map();

  texto.split(/\r?\n/).forEach((crudo, i) => {
    const linea = i + 1;
    const original = limpio(crudo);
    if (!original) return;

    const m = PRODUCTO.exec(original);
    if (!m) {
      // Sin número al inicio: una nota («- Nota: …», «(Salida …)», «- El señor Edward se lleva …»)
      ignoradas.push({ linea, texto: original });
      return;
    }
    const [, guionAntes, numero, restoGuiones, resto] = m;
    let nombre = limpio(resto);
    const motivos = [];

    if (guionAntes || restoGuiones) motivos.push('lleva un guion junto al número (¿vendido, tachado o solo un guion?)');
    const cantidad = Number(numero);
    if (cantidad >= 100) motivos.push(`cantidad de ${cantidad} (¿un cero de más?)`);
    if (cantidad === 0) motivos.push('cantidad 0');

    const observacion = /\s*\((?:se llevaron|se lleva)[^)]*\)\s*$/i.exec(nombre);
    if (observacion) {
      motivos.push(`observación quitada del nombre:${observacion[0].trim()}`);
      nombre = limpio(nombre.slice(0, observacion.index));
    }
    if (/\.\.\.$|…$/.test(nombre)) motivos.push('el nombre parece cortado');
    if (!nombre) {
      ignoradas.push({ linea, texto: original });
      return;
    }

    if (motivos.length > 0) dudosas.push({ linea, texto: original, motivo: motivos.join('; ') });

    const k = clave(nombre);
    const previa = porNombre.get(k);
    if (previa) {
      previa.cantidad += cantidad;
      const f = fusionados.get(k) ?? { nombre: previa.nombre, lineas: [previa.linea], cantidades: [previa.primera] };
      f.lineas.push(linea);
      f.cantidades.push(cantidad);
      fusionados.set(k, f);
      return;
    }
    const fila = { linea, nombre, cantidad, categoria: categoriaSugerida(nombre), primera: cantidad };
    porNombre.set(k, fila);
    filas.push(fila);
  });

  return {
    filas: filas.map(({ primera: _primera, ...f }) => f),
    dudosas,
    ignoradas,
    fusionados: [...fusionados.values()],
  };
}
