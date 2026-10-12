// Respaldo local en JSON del inventario en Supabase (productos, modelos de
// teléfono, compatibilidades y kardex de movimientos). Uso:
//
//   npm run backup
//
// Requiere PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en tu .env local
// (el script se ejecuta con `node --env-file-if-exists=.env`, ver
// package.json). La service_role key se obtiene en Supabase, en
// Project Settings > API > "service_role" (secreta): a diferencia de la
// anon key, salta las políticas RLS, así que este script puede leer todas
// las tablas sin necesitar una sesión de usuario iniciada.
//
// IMPORTANTE: la service_role key da acceso total a la base de datos.
// Guárdala solo en tu .env local (ya está en .gitignore) y nunca la
// publiques, la subas a git, ni la uses en código de cliente/navegador.
//
// Si no usas Supabase (modo LocalStorage), este script no aplica: tus datos
// viven únicamente en el navegador. Usa el botón "Exportar inventario a CSV"
// de la página Productos en su lugar.
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'node:fs';

const url = process.env.PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) {
  console.error(
    '[backup] Falta PUBLIC_SUPABASE_URL en tu .env. Este respaldo solo aplica cuando EASYSTEM está conectado a ' +
      'Supabase; en modo LocalStorage, usa "Exportar inventario a CSV" en la página Productos.'
  );
  process.exit(1);
}

if (!serviceRoleKey) {
  console.error(
    '[backup] Falta SUPABASE_SERVICE_ROLE_KEY en tu .env.\n' +
      '  Obténla en el dashboard de Supabase: Project Settings > API > "service_role" (secreta).\n' +
      '  Agrégala solo a tu .env local (nunca la subas a git ni la publiques):\n' +
      '    SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key'
  );
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

async function respaldarTabla(tabla) {
  const { data, error } = await supabase.from(tabla).select('*');
  if (error) throw new Error(`No se pudo leer "${tabla}": ${error.message}`);
  return data ?? [];
}

const [productos, modelos_telefono, compatibilidades, movimientos_inventario] = await Promise.all([
  respaldarTabla('productos'),
  respaldarTabla('modelos_telefono'),
  respaldarTabla('compatibilidades'),
  respaldarTabla('movimientos_inventario'),
]);

const respaldo = {
  generado_en: new Date().toISOString(),
  productos,
  modelos_telefono,
  compatibilidades,
  movimientos_inventario,
};

mkdirSync('backups', { recursive: true });
const marcaTiempo = respaldo.generado_en.replace(/[:.]/g, '-');
const archivo = `backups/easystem-backup-${marcaTiempo}.json`;
writeFileSync(archivo, JSON.stringify(respaldo, null, 2), 'utf-8');

console.log(`[backup] Respaldo guardado en ${archivo}`);
console.log(
  `[backup] ${productos.length} productos, ${modelos_telefono.length} modelos, ` +
    `${compatibilidades.length} compatibilidades, ${movimientos_inventario.length} movimientos.`
);
