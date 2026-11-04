// Crea el administrador del dueño en la base de datos de Cloudflare D1 (local o remota).
//
// Uso (en TU terminal, no en un chat: la clave se muestra una sola vez en pantalla):
//   node scripts/crear-admin.mjs --db local     # base de pruebas de tu computadora (npm run db:local primero)
//   node scripts/crear-admin.mjs --db remote    # base real en Cloudflare (requiere `npx wrangler login`)
//
// Te pide el correo y el nombre, genera una clave aleatoria de 16 caracteres, guarda SOLO su hash (PBKDF2) en la base y
// te muestra la clave una única vez. Después entra a /login, y crea a los demás usuarios desde /usuarios.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { generarClave, sentenciasAltaAdministrador, validarCorreo } from './lib/admin.mjs';

const BASE = 'easystem';

function leerDestino() {
  const i = process.argv.indexOf('--db');
  const destino = i >= 0 ? process.argv[i + 1] : undefined;
  if (destino !== 'local' && destino !== 'remote') {
    console.error('Indica la base: --db local (pruebas en tu computadora) o --db remote (la real en Cloudflare).');
    process.exit(1);
  }
  return destino;
}

const destino = leerDestino();
const consola = createInterface({ input: process.stdin });
// Se lee línea por línea (funciona igual escribiendo en la terminal que con la entrada redirigida)
const lineas = consola[Symbol.asyncIterator]();
async function preguntar(texto) {
  process.stdout.write(texto);
  const { value, done } = await lineas.next();
  if (done) throw new Error('Faltó escribir el dato.');
  return String(value);
}

try {
  console.log(`\nCrear el administrador en la base ${destino === 'remote' ? 'REAL de Cloudflare' : 'local de pruebas'}.\n`);
  const correo = (await preguntar('Correo del administrador: ')).trim();
  if (!validarCorreo(correo)) throw new Error('Escribe un correo válido.');
  const nombre = (await preguntar('Nombre completo: ')).trim();
  if (nombre.length < 2) throw new Error('Escribe el nombre del administrador.');
  if (destino === 'remote') {
    const respuesta = (await preguntar(`\nSe creará ${correo} como ADMINISTRADOR en la base real. Escribe SI para continuar: `)).trim();
    if (respuesta !== 'SI') throw new Error('Cancelado: no se creó nada.');
  }

  const clave = generarClave();
  const sentencias = await sentenciasAltaAdministrador({ correo, nombre, clave });

  // El archivo temporal solo trae el hash (nunca la clave) y se borra al terminar
  const carpeta = mkdtempSync(join(tmpdir(), 'easystem-admin-'));
  const archivo = join(carpeta, 'alta-admin.sql');
  writeFileSync(archivo, sentencias.map((s) => `${s};`).join('\n') + '\n', { mode: 0o600 });
  let resultado;
  try {
    resultado = spawnSync('npx', ['wrangler', 'd1', 'execute', BASE, destino === 'remote' ? '--remote' : '--local', `--file=${archivo}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }

  if (resultado.status !== 0) {
    console.error('\nNo se pudo crear el administrador (no se mostró ninguna clave porque no se guardó nada):\n');
    console.error(`${resultado.stdout ?? ''}${resultado.stderr ?? ''}`.trim());
    if (/UNIQUE constraint failed: user\.email/i.test(`${resultado.stdout}${resultado.stderr}`)) {
      console.error('\nYa existe un usuario con ese correo.');
    }
    process.exit(1);
  }

  console.log('\n==========================================================');
  console.log(' Administrador creado');
  console.log(`   Correo: ${correo.toLowerCase()}`);
  console.log(`   Clave:  ${clave}`);
  console.log('==========================================================');
  console.log('Anota la clave AHORA: no se vuelve a mostrar ni se puede recuperar (solo cambiar desde /usuarios).');
  console.log('Entra a /login con ese correo y esa clave; luego crea a los demás usuarios desde /usuarios.\n');
} catch (err) {
  console.error(`\n${err instanceof Error ? err.message : err}\n`);
  process.exitCode = 1;
} finally {
  consola.close();
}
