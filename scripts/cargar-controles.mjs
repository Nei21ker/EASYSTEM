// Carga los datos REALES del Local de controles (cargadores: nombre, precio, cantidad y foto) al sistema.
//
// Prepara la carpeta datos-controles/ (no se sube a git):
//   datos-controles/inventario.csv     columnas: nombre, precio_venta, cantidad, foto  (y opcionales: codigo, precio_compra, stock_minimo, categoria)
//   datos-controles/fotos/*.jpg        una foto por producto (o en la misma carpeta que el CSV)
//
// Uso:
//   node scripts/cargar-controles.mjs --api http://localhost:8787 --email tu@correo.com            (prueba en tu computadora)
//   node scripts/cargar-controles.mjs --api https://tu-sistema.workers.dev --email tu@correo.com   (la base real)
// La contraseña se pide por consola (no se escribe en pantalla). Primero valida todo, muestra un resumen y NO escribe nada hasta
// que confirmes. Si hay cualquier problema en los datos, no escribe nada y te dice línea por línea qué corregir.
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { cargarControles } from './lib/cargar.mjs';
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

const urlApi = argumento('--api');
const email = argumento('--email');
const carpeta = resolve(argumento('--carpeta') ?? 'datos-controles');
// La contraseña solo viaja por HTTPS (o por HTTP si es tu propia computadora)
if (urlApi && !urlSegura(urlApi)) {
  console.error('La dirección debe empezar con https:// (solo http://localhost se permite para pruebas en tu computadora).');
  process.exit(1);
}
if (!urlApi || !email) {
  console.error('Uso: node scripts/cargar-controles.mjs --api <dirección del sistema> --email <tu correo> [--carpeta datos-controles]');
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

async function preguntar(texto) {
  process.stdout.write(texto);
  const { value, done } = await lector().next();
  if (done) throw new Error('Faltó escribir la respuesta.');
  return String(value).trim();
}

/** Contraseña SIN mostrarla en pantalla (modo crudo de la terminal); con la entrada redirigida se lee como una línea. */
async function preguntarClave(texto) {
  if (process.stdin.isTTY) return leerClaveOculta(texto);
  return preguntar(texto);
}

try {
  const api = crearClienteApi(urlApi);
  const clave = await preguntarClave(`Contraseña de ${email}: `);
  await api.iniciarSesion(email, clave);
  console.log('Sesión iniciada.');

  const resultado = await cargarControles({
    carpeta,
    api,
    confirmar: async () => (await preguntar('\n¿Cargar estos datos al sistema? Escribe SI para continuar: ')) === 'SI',
  });
  if (!resultado.escrito) process.exitCode = resultado.problemas ? 1 : 0;
} catch (err) {
  console.error(`\n${err instanceof Error ? err.message : err}\n`);
  process.exitCode = 1;
} finally {
  consola?.close();
}
