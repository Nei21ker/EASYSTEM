// Crea un técnico de servicio técnico (acceso mínimo: solo ve sus trabajos) en la base D1 (local o remota).
//
// Uso:
//   TECNICO_CLAVE=<clave temporal> node scripts/crear-tecnico.mjs --db remote --correo x@y.com --nombre "Nombre" --local <id del local>
//   (sin TECNICO_CLAVE se genera una clave aleatoria y se muestra una sola vez)
//
// La clave NUNCA se escribe en archivos ni en el SQL: solo su hash PBKDF2. El perfil queda con «debe cambiar la clave»:
// el técnico elige la suya en su primer ingreso.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generarClave } from './lib/admin.mjs';
import { sentenciasAltaTecnico } from './lib/tecnico.mjs';

const BASE = 'easystem';
const opcion = (nombre) => {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

try {
  const destino = opcion('db');
  if (destino !== 'local' && destino !== 'remote') throw new Error('Indica la base: --db local o --db remote.');
  const generada = !process.env.TECNICO_CLAVE;
  const clave = process.env.TECNICO_CLAVE || generarClave();
  const sentencias = await sentenciasAltaTecnico({ correo: opcion('correo'), nombre: opcion('nombre'), clave, localId: opcion('local') });

  const carpeta = mkdtempSync(join(tmpdir(), 'easystem-tecnico-'));
  const archivo = join(carpeta, 'alta-tecnico.sql');
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
  const salida = `${resultado.stdout ?? ''}${resultado.stderr ?? ''}`;
  if (resultado.status !== 0) {
    console.error('No se pudo crear el técnico (no se guardó nada):\n' + salida.trim());
    if (/UNIQUE constraint failed: user\.email/i.test(salida)) console.error('\nYa existe un usuario con ese correo.');
    process.exit(1);
  }
  console.log(`Técnico creado: ${opcion('correo').trim().toLowerCase()} (debe cambiar la clave en su primer ingreso).`);
  if (generada) console.log(`Clave temporal: ${clave}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
