// Carga el inventario del Local Servicio Técnico (texto: una pieza por línea, «02 Audífono inalámbrico M90 Pro») al sistema.
//
// Prepara el archivo datos-servicio-tecnico/inventario.txt (no se sube a git).
//
// Uso:
//   node scripts/cargar-servicio-tecnico.mjs --solo-revisar                                                (no entra al sistema: solo muestra lo que se cargaría)
//   node scripts/cargar-servicio-tecnico.mjs --api http://localhost:8787 --email tu@correo.com             (prueba en tu computadora)
//   node scripts/cargar-servicio-tecnico.mjs --api https://tu-sistema.workers.dev --email tu@correo.com    (la base real)
// La contraseña se pide por consola (no se escribe en pantalla). Primero muestra un resumen (con las líneas dudosas) y NO escribe nada
// hasta que confirmes. Los productos se crean sin foto y sin precio; la cantidad queda sin movimientos de inventario.
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { cargarServicioTecnico, resumirLectura } from './lib/cargar-servicio-tecnico.mjs';
import { parsearInventarioServicioTecnico } from './lib/leer-servicio-tecnico.mjs';
import { leerClaveOculta } from './lib/clave-oculta.mjs';
import { crearClienteApi } from './lib/cliente-api.mjs';

function argumento(nombre) {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function urlSegura(texto) {
  try {
    const u = new URL(texto);
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname));
  } catch {
    return false;
  }
}

const archivo = resolve(argumento('--archivo') ?? 'datos-servicio-tecnico/inventario.txt');
let texto;
try {
  texto = await readFile(archivo, 'utf8');
} catch {
  console.error(`No encuentro el archivo ${archivo}.`);
  process.exit(1);
}

if (process.argv.includes('--solo-revisar')) {
  const lectura = parsearInventarioServicioTecnico(texto);
  resumirLectura(lectura);
  process.exit(0);
}

const urlApi = argumento('--api');
const email = argumento('--email');
// La contraseña solo viaja por HTTPS (o por HTTP si es tu propia computadora)
if (urlApi && !urlSegura(urlApi)) {
  console.error('La dirección debe empezar con https:// (solo http://localhost se permite para pruebas en tu computadora).');
  process.exit(1);
}
if (!urlApi || !email) {
  console.error('Uso: node scripts/cargar-servicio-tecnico.mjs --api <dirección del sistema> --email <tu correo> [--archivo datos-servicio-tecnico/inventario.txt]  (o --solo-revisar)');
  process.exit(1);
}

// La entrada se lee por líneas (igual escribiendo en la terminal que con la entrada redirigida); se crea al usarla por primera vez
let consola;
let lineas;
function lector() {
  if (!lineas) {
    consola = createInterface({ input: process.stdin });
    lineas = consola[Symbol.asyncIterator]();
  }
  return lineas;
}

async function preguntar(pregunta) {
  process.stdout.write(pregunta);
  const { value, done } = await lector().next();
  if (done) throw new Error('Faltó escribir la respuesta.');
  return String(value).trim();
}

/** Contraseña SIN mostrarla en pantalla (modo crudo de la terminal); con la entrada redirigida se lee como una línea. */
async function preguntarClave(pregunta) {
  if (process.stdin.isTTY) return leerClaveOculta(pregunta);
  return preguntar(pregunta);
}

try {
  const api = crearClienteApi(urlApi);
  const clave = await preguntarClave(`Contraseña de ${email}: `);
  await api.iniciarSesion(email, clave);
  console.log('Sesión iniciada.');

  const resultado = await cargarServicioTecnico({
    texto,
    api,
    confirmar: async () => (await preguntar('\n¿Cargar estos datos al Local Servicio Técnico? Escribe SI para continuar: ')) === 'SI',
  });
  if (!resultado.escrito) process.exitCode = resultado.problemas ? 1 : 0;
} catch (err) {
  console.error(`\n${err instanceof Error ? err.message : err}\n`);
  process.exitCode = 1;
} finally {
  consola?.close();
}
