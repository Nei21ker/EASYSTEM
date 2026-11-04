// Genera migrations/0002_seed.sql: los 4 locales, el catálogo de modelos de teléfono y los contadores en cero.
// NO siembra productos: el inventario real se carga con el importador / scripts/cargar-controles.mjs.
//
// Uso:  node scripts/generar-seed.mjs
// (Node >= 22.18 importa los .ts directamente.) Los ids de los modelos salen de un hash de marca+modelo, así que
// volver a generar el archivo produce exactamente el mismo contenido.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { catalogoModelos } from '../src/lib/catalogo-modelos.ts';
import { localesPorDefecto } from '../src/lib/constantes-locales.ts';

const comillas = (texto) => `'${String(texto).replaceAll("'", "''")}'`;

/** UUID versión 5 (estable) a partir de un texto. */
function uuidEstable(texto) {
  const hash = createHash('sha1').update(`easystem:${texto}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const lineas = [
  '-- ============================================================================',
  '-- Semilla de EASYSTEM en D1. GENERADA por scripts/generar-seed.mjs: no editar a mano.',
  '--   · los 4 locales (suscripción ACTIVE)',
  '--   · el catálogo de modelos de teléfono (src/lib/catalogo-modelos.ts)',
  '--   · los contadores de folios y de códigos de unidad, en cero',
  '-- Sin productos, stock, ventas, tasa ni usuarios.',
  '-- ============================================================================',
  '',
];

for (const l of localesPorDefecto()) {
  lineas.push(
    `INSERT INTO locales (id, nombre, tipo, activo, created_at, subscription_status) VALUES (${comillas(l.id)}, ${comillas(l.nombre)}, ${comillas(l.tipo)}, 1, ${comillas(l.created_at)}, 'ACTIVE');`
  );
}
lineas.push('');

for (const [marca, modelos] of Object.entries(catalogoModelos)) {
  for (const modelo of modelos) {
    lineas.push(`INSERT INTO modelos_telefono (id, marca, modelo) VALUES (${comillas(uuidEstable(`${marca}|${modelo}`))}, ${comillas(marca)}, ${comillas(modelo)});`);
  }
}
lineas.push('');

for (const nombre of ['ventas', 'devoluciones', 'ordenes_servicio', 'unidades']) {
  lineas.push(`INSERT INTO contadores (nombre, valor) VALUES (${comillas(nombre)}, 0);`);
}

writeFileSync(new URL('../migrations/0002_seed.sql', import.meta.url), `${lineas.join('\n')}\n`);
console.log(`migrations/0002_seed.sql: ${localesPorDefecto().length} locales, ${Object.values(catalogoModelos).flat().length} modelos`);
