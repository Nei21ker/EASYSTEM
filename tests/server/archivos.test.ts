import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { crearProducto } from '../../src/server/servicios/catalogo';
import {
  borrarArchivosPrivados, eliminarFotoProducto, leerArchivoPrivado, leerArchivoPublico, subirArchivoPrivado, subirFotoProducto, subirMiniaturaProducto,
} from '../../src/server/servicios/archivos';

const env = crearEntornoDePrueba();
const { accesorios, vidrios } = IDS_LOCALES;
const FECHA = '2026-11-03';

let admin: UsuarioDePrueba, gerente: UsuarioDePrueba, encargado: UsuarioDePrueba, vendedor: UsuarioDePrueba, contador: UsuarioDePrueba;
let sA: Sesion, sG: Sesion, sE: Sesion, sV: Sesion, sC: Sesion;
let productoId: string;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
  gerente = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null });
  encargado = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: vidrios });
  vendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
  contador = await crearUsuarioDePrueba(env, { rol: 'contador', localId: null });
  [sA, sG, sE, sV, sC] = await Promise.all([admin, gerente, encargado, vendedor, contador].map(sesionDe));
  productoId = (await crearProducto(env, sA, { codigo_barras: '2000000000015', nombre: 'Cargador', categoria: 'Cargadores', precio_venta: 8 })).id;
  for (const bucket of [env.FOTOS_PUBLICAS, env.FOTOS_PRIVADAS]) {
    const lista = await bucket.list();
    await Promise.all(lista.objects.map((o) => bucket.delete(o.key)));
  }
});

async function rechazo(promesa: Promise<unknown>, status: number, texto?: string | RegExp): Promise<void> {
  try {
    await promesa;
  } catch (err) {
    expect(err).toBeInstanceOf(ErrorApi);
    expect((err as ErrorApi).status).toBe(status);
    if (texto) expect((err as ErrorApi).message).toMatch(texto);
    return;
  }
  throw new Error('Debía rechazarse y no se rechazó');
}

const bytes = (n = 10) => new Uint8Array(n).fill(7).buffer;
const rutaCuadre = (local: string = vidrios, nombre = 'EFECTIVO-1730000000000-1.jpg') => `cuadres-caja/${local}/${FECHA}/${nombre}`;
const rutaComprobante = (local: string = vidrios) => `comprobantes-nomina/${local}/emp1-2026-11-01-1730000000000.jpg`;
const cuadreCerrado = () =>
  env.DB.prepare("INSERT INTO cuadres_caja (id, local_id, fecha, estado, cerrado_en) VALUES ('c1', ?, ?, 'CERRADO', '2026-11-03T22:00:00.000Z')").bind(vidrios, FECHA).run();

describe('comprobante de un pago PAGADO', () => {
  const empleado = () => env.DB.prepare("INSERT INTO empleados (id, local_id, nombre, apellido, cedula, cargo, salario_base) VALUES ('emp1', ?, 'Eva', 'Mora', 'V-5000001', 'Cajera', 200)").bind(vidrios).run();
  const pago = (estado: string) =>
    env.DB.prepare("INSERT INTO nominas (id, empleado_id, local_id, periodo_inicio, periodo_fin, pago_base, total_pagado, estado_pago, comprobante_path) VALUES ('n1', 'emp1', ?, '2026-11-01', '2026-11-15', 100, 100, ?, ?)").bind(vidrios, estado, rutaComprobante()).run();

  it('no se puede sobrescribir un archivo que ya existe (ni uno ligado a un pago PAGADO)', async () => {
    await subirArchivoPrivado(env, sC, rutaComprobante(), bytes(5), 'image/jpeg');
    await rechazo(subirArchivoPrivado(env, sC, rutaComprobante(), bytes(9), 'image/png'), 409, /Ya existe/);
    expect((await env.FOTOS_PRIVADAS.head(rutaComprobante()))?.size).toBe(5);
  });

  it('no se puede borrar el comprobante de un pago PAGADO, pero sí el de uno PENDIENTE', async () => {
    await empleado();
    await subirArchivoPrivado(env, sC, rutaComprobante(), bytes(), 'image/jpeg');
    await pago('PAGADO');
    await rechazo(borrarArchivosPrivados(env, sC, [rutaComprobante()]), 409, /PAGADO/);
    expect(await env.FOTOS_PRIVADAS.head(rutaComprobante())).not.toBeNull();
    // Uno PENDIENTE (otro período y otra ruta) sí se puede borrar
    const otra = `comprobantes-nomina/${vidrios}/emp1-2026-10-01-1720000000000.jpg`;
    await env.DB.prepare("INSERT INTO nominas (id, empleado_id, local_id, periodo_inicio, periodo_fin, pago_base, total_pagado, estado_pago, comprobante_path) VALUES ('n2', 'emp1', ?, '2026-10-01', '2026-10-15', 100, 100, 'PENDIENTE', ?)").bind(vidrios, otra).run();
    await subirArchivoPrivado(env, sC, otra, bytes(), 'image/jpeg');
    await borrarArchivosPrivados(env, sC, [otra]);
    expect(await env.FOTOS_PRIVADAS.head(otra)).toBeNull();
  });
});

describe('fotos de producto (públicas)', () => {
  it('administrador, gerente y encargado suben; el vendedor no; la URL cuelga de la base pública y se puede leer sin sesión', async () => {
    for (const s of [sA, sG, sE]) {
      const url = await subirFotoProducto(env, s, productoId, bytes(), 'image/jpeg');
      expect(url.startsWith(`${env.URL_FOTOS_PUBLICAS}/productos/${productoId}/`)).toBe(true);
      const clave = url.slice(env.URL_FOTOS_PUBLICAS.length + 1);
      expect(await env.FOTOS_PUBLICAS.head(clave)).not.toBeNull();
      const respuesta = await leerArchivoPublico(env, clave);
      expect(respuesta.status).toBe(200);
      expect(respuesta.headers.get('cache-control')).toContain('immutable');
      expect(respuesta.headers.get('content-type')).toBe('image/jpeg');
    }
    await rechazo(subirFotoProducto(env, sV, productoId, bytes(), 'image/jpeg'), 403);
    await rechazo(subirFotoProducto(env, sC, productoId, bytes(), 'image/jpeg'), 403);
  });

  it('rechaza producto inexistente, tipos que no son imagen y archivos muy grandes', async () => {
    await rechazo(subirFotoProducto(env, sA, 'no-existe', bytes(), 'image/jpeg'), 404);
    await rechazo(subirFotoProducto(env, sA, productoId, bytes(), 'application/pdf'), 400, /JPG, PNG o WebP/);
    await rechazo(subirFotoProducto(env, sA, productoId, bytes(2 * 1024 * 1024 + 1), 'image/jpeg'), 400, /demasiado grande/);
  });

  it('lo público solo sirve fotos de producto: nada privado se lee por esa ruta', async () => {
    await env.FOTOS_PRIVADAS.put(rutaCuadre(), 'secreto');
    await env.FOTOS_PUBLICAS.put(rutaCuadre(), 'secreto');
    expect((await leerArchivoPublico(env, rutaCuadre())).status).toBe(404);
    expect((await leerArchivoPublico(env, 'productos/../cuadres-caja/x.jpg')).status).toBe(404);
    expect((await leerArchivoPublico(env, `productos/${productoId}/no-existe.jpg`)).status).toBe(404);
  });

  it('eliminar la foto borra el archivo; una URL ajena se ignora', async () => {
    const url = await subirFotoProducto(env, sA, productoId, bytes(), 'image/jpeg');
    const clave = url.slice(env.URL_FOTOS_PUBLICAS.length + 1);
    await rechazo(eliminarFotoProducto(env, sV, url), 403);
    await eliminarFotoProducto(env, sE, 'https://otro-sitio.com/foto.jpg');
    expect(await env.FOTOS_PUBLICAS.head(clave)).not.toBeNull();
    await eliminarFotoProducto(env, sE, url);
    expect(await env.FOTOS_PUBLICAS.head(clave)).toBeNull();
  });
});

describe('miniatura de la foto de un producto', () => {
  const claveDe = (url: string) => url.slice(env.URL_FOTOS_PUBLICAS.length + 1);

  it('se guarda junto a la foto con el sufijo -m, con la misma extensión, y se lee sin sesión con caché de un año', async () => {
    const url = await subirFotoProducto(env, sA, productoId, bytes(3000), 'image/webp');
    const clave = claveDe(url);
    expect(clave).toMatch(/.webp$/);
    const miniatura = await subirMiniaturaProducto(env, sA, productoId, url, bytes(300), 'image/webp');
    expect(miniatura).toBe(url.replace(/.webp$/, '-m.webp'));
    const lectura = await leerArchivoPublico(env, claveDe(miniatura));
    expect(lectura.status).toBe(200);
    expect(lectura.headers.get('cache-control')).toContain('immutable');
    expect(lectura.headers.get('content-type')).toBe('image/webp');
  });

  it('una miniatura que falta responde 404 con una caché corta (no se vuelve a pedir en cada fila)', async () => {
    const url = await subirFotoProducto(env, sA, productoId, bytes(), 'image/jpeg');
    const r = await leerArchivoPublico(env, claveDe(url).replace(/.jpg$/, '-m.jpg'));
    expect(r.status).toBe(404);
    expect(r.headers.get('cache-control')).toContain('max-age=3600');
  });

  it('quienes suben fotos pueden subirla; el vendedor no', async () => {
    const url = await subirFotoProducto(env, sA, productoId, bytes(), 'image/jpeg');
    for (const sesion of [sA, sG, sE]) await subirMiniaturaProducto(env, sesion, productoId, url, bytes(50), 'image/jpeg');
    await rechazo(subirMiniaturaProducto(env, sV, productoId, url, bytes(50), 'image/jpeg'), 403);
  });

  it('solo se acepta de una foto de ESE producto que exista, del mismo tipo y pequeña', async () => {
    const url = await subirFotoProducto(env, sA, productoId, bytes(), 'image/jpeg');
    const otro = (await crearProducto(env, sA, { codigo_barras: '2000000000022', nombre: 'Cable', categoria: 'Cables', precio_venta: 3 })).id;
    await rechazo(subirMiniaturaProducto(env, sA, otro, url, bytes(50), 'image/jpeg'), 400, /no corresponde/i);
    await rechazo(subirMiniaturaProducto(env, sA, productoId, 'https://otro-sitio.com/x.jpg', bytes(50), 'image/jpeg'), 400, /no corresponde/i);
    await rechazo(subirMiniaturaProducto(env, sA, productoId, `${env.URL_FOTOS_PUBLICAS}/productos/${productoId}/1730000000000.jpg`, bytes(50), 'image/jpeg'), 400, /no corresponde/i);
    await rechazo(subirMiniaturaProducto(env, sA, productoId, url, bytes(50), 'image/png'), 400, /mismo tipo/i);
    await rechazo(subirMiniaturaProducto(env, sA, productoId, url, bytes(100 * 1024 + 1), 'image/jpeg'), 400, /demasiado grande/);
    await rechazo(subirMiniaturaProducto(env, sA, productoId, url, bytes(50), 'application/pdf'), 400, /JPG, PNG o WebP/);
  });

  it('eliminar la foto borra también su miniatura', async () => {
    const url = await subirFotoProducto(env, sA, productoId, bytes(), 'image/jpeg');
    const miniatura = await subirMiniaturaProducto(env, sA, productoId, url, bytes(50), 'image/jpeg');
    await eliminarFotoProducto(env, sA, url);
    expect(await env.FOTOS_PUBLICAS.head(claveDe(url))).toBeNull();
    expect(await env.FOTOS_PUBLICAS.head(claveDe(miniatura))).toBeNull();
  });
});

describe('fotos de cuadre (privadas)', () => {
  it('el encargado sube y lee las de SU local; el de otro local, el vendedor y el contador no', async () => {
    await subirArchivoPrivado(env, sE, rutaCuadre(vidrios), bytes(), 'image/jpeg');
    const leida = await leerArchivoPrivado(env, sE, rutaCuadre(vidrios));
    expect(leida.status).toBe(200);
    expect(leida.headers.get('cache-control')).toContain('private');
    expect((await leida.arrayBuffer()).byteLength).toBe(10);
    await rechazo(subirArchivoPrivado(env, sE, rutaCuadre(accesorios), bytes(), 'image/jpeg'), 403);
    await rechazo(leerArchivoPrivado(env, sE, rutaCuadre(accesorios)), 403);
    await rechazo(subirArchivoPrivado(env, sV, rutaCuadre(accesorios), bytes(), 'image/jpeg'), 403);
    await rechazo(leerArchivoPrivado(env, sV, rutaCuadre(accesorios)), 403);
    await rechazo(leerArchivoPrivado(env, sC, rutaCuadre(vidrios)), 403);
  });

  it('el administrador y el gerente suben y leen de cualquier local', async () => {
    await subirArchivoPrivado(env, sG, rutaCuadre(accesorios), bytes(), 'image/png');
    expect((await leerArchivoPrivado(env, sA, rutaCuadre(accesorios))).status).toBe(200);
  });

  it('con el cuadre CERRADO el encargado ya no sube ni borra; el gerente sí', async () => {
    await subirArchivoPrivado(env, sE, rutaCuadre(vidrios, 'EFECTIVO-1-1.jpg'), bytes(), 'image/jpeg');
    await cuadreCerrado();
    await rechazo(subirArchivoPrivado(env, sE, rutaCuadre(vidrios, 'EFECTIVO-2-2.jpg'), bytes(), 'image/jpeg'), 403);
    await rechazo(borrarArchivosPrivados(env, sE, [rutaCuadre(vidrios, 'EFECTIVO-1-1.jpg')]), 403);
    await subirArchivoPrivado(env, sG, rutaCuadre(vidrios, 'EFECTIVO-3-3.jpg'), bytes(), 'image/jpeg');
    await borrarArchivosPrivados(env, sG, [rutaCuadre(vidrios, 'EFECTIVO-1-1.jpg')]);
    expect(await env.FOTOS_PRIVADAS.head(rutaCuadre(vidrios, 'EFECTIVO-1-1.jpg'))).toBeNull();
    // leer sigue permitido con el cuadre cerrado
    expect((await leerArchivoPrivado(env, sE, rutaCuadre(vidrios, 'EFECTIVO-3-3.jpg'))).status).toBe(200);
  });

  it('rechaza extensiones que no son imagen, tipos MIME ajenos, archivos grandes y rutas manipuladas', async () => {
    await rechazo(subirArchivoPrivado(env, sE, rutaCuadre(vidrios, 'EFECTIVO-1-1.pdf'), bytes(), 'application/pdf'), 400);
    await rechazo(subirArchivoPrivado(env, sE, rutaCuadre(vidrios), bytes(), 'text/html'), 400, /JPG, PNG o WebP/);
    await rechazo(subirArchivoPrivado(env, sE, rutaCuadre(vidrios), bytes(5 * 1024 * 1024 + 1), 'image/jpeg'), 400, /demasiado grande/);
    await rechazo(subirArchivoPrivado(env, sE, `cuadres-caja/${vidrios}/../${accesorios}/${FECHA}/EFECTIVO-1-1.jpg`, bytes(), 'image/jpeg'), 400, /ruta/i);
    await rechazo(subirArchivoPrivado(env, sA, 'otra-carpeta/algo.jpg', bytes(), 'image/jpeg'), 400, /ruta/i);
    await rechazo(subirArchivoPrivado(env, sA, `cuadres-caja/${vidrios}/2026-13-45/EFECTIVO-1-1.jpg`, bytes(), 'image/jpeg'), 400, /ruta/i);
  });

  it('leer un archivo que no existe responde 404', async () => {
    await rechazo(leerArchivoPrivado(env, sE, rutaCuadre(vidrios, 'EFECTIVO-9-9.jpg')), 404);
  });
});

describe('comprobantes de nómina (privados)', () => {
  it('administrador, gerente y contador suben y leen; encargado y vendedor no', async () => {
    for (const s of [sA, sG, sC]) {
      await env.FOTOS_PRIVADAS.delete(rutaComprobante()); // cada rol sube "su" copia: una ruta ya usada no se sobrescribe
      await subirArchivoPrivado(env, s, rutaComprobante(), bytes(), 'image/jpeg');
      expect((await leerArchivoPrivado(env, s, rutaComprobante())).status).toBe(200);
    }
    await rechazo(subirArchivoPrivado(env, sE, rutaComprobante(), bytes(), 'image/jpeg'), 403);
    await rechazo(leerArchivoPrivado(env, sE, rutaComprobante()), 403);
    await rechazo(leerArchivoPrivado(env, sV, rutaComprobante(accesorios)), 403);
  });

  it('un local suspendido deja de ser accesible para el gerente y el contador', async () => {
    await env.DB.prepare("UPDATE locales SET subscription_status = 'SUSPENDED' WHERE id = ?").bind(vidrios).run();
    await rechazo(leerArchivoPrivado(env, sG, rutaComprobante(vidrios)), 403);
    await rechazo(subirArchivoPrivado(env, sC, rutaComprobante(vidrios), bytes(), 'image/jpeg'), 403);
  });

  it('borrar comprobantes exige el mismo acceso', async () => {
    await subirArchivoPrivado(env, sA, rutaComprobante(), bytes(), 'image/jpeg');
    await rechazo(borrarArchivosPrivados(env, sE, [rutaComprobante()]), 403);
    await borrarArchivosPrivados(env, sC, [rutaComprobante()]);
    expect(await env.FOTOS_PRIVADAS.head(rutaComprobante())).toBeNull();
  });
});
