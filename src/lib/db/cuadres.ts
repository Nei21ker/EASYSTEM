// Acceso a Supabase del cuadre de caja diario (migración 0034). Solo lo usa inventoryService.ts.
// Las fotos van al bucket PRIVADO "cuadres-caja": nunca hay URL pública, se pide un enlace firmado de 1 hora al verlas.
import { supabase } from '../supabase';
import type { CuadreCaja, TipoFotoCuadre } from '../../types/database.types';

const BUCKET = 'cuadres-caja';

/** numeric/jsonb pueden llegar como texto según PostgREST: se normaliza. */
function cuadre(c: CuadreCaja): CuadreCaja {
  return {
    ...c,
    esperado: (c.esperado ?? []).map((e) => ({ ...e, usd: Number(e.usd), bs: Number(e.bs), ventas: Number(e.ventas) })),
    contado: (c.contado ?? []).map((x) => ({ ...x, monto: Number(x.monto) })),
    fotos: c.fotos ?? [],
  };
}

function mensajeAlmacenamiento(mensaje: string): string {
  return /bucket not found/i.test(mensaje)
    ? 'Falta el almacenamiento de cuadres en Supabase: aplica la migración 0034.'
    : `No se pudo subir la foto: ${mensaje}`;
}

/** Los cuadres de un día (todos los locales que el usuario puede ver). */
export async function listarCuadresDelDia(fecha: string): Promise<CuadreCaja[]> {
  const { data, error } = await supabase.from('cuadres_caja').select('*').eq('fecha', fecha).overrideTypes<CuadreCaja[], { merge: false }>();
  if (error) throw error;
  return (data ?? []).map(cuadre);
}

export async function obtenerCuadre(localId: string, fecha: string): Promise<CuadreCaja | null> {
  const { data, error } = await supabase
    .from('cuadres_caja')
    .select('*')
    .eq('local_id', localId)
    .eq('fecha', fecha)
    .limit(1)
    .overrideTypes<CuadreCaja[], { merge: false }>();
  if (error) throw error;
  return data?.[0] ? cuadre(data[0]) : null;
}

export type DatosCuadre = Pick<CuadreCaja, 'esperado' | 'contado' | 'fotos' | 'notas' | 'estado'> & Partial<Pick<CuadreCaja, 'cerrado_por'>>;

/** Crea el cuadre del día o actualiza el que existe (la base de datos impide tocar uno cerrado). */
export async function guardarCuadre(localId: string, fecha: string, existente: CuadreCaja | null, datos: DatosCuadre, registradoNombre: string): Promise<CuadreCaja> {
  const consulta = existente
    ? supabase.from('cuadres_caja').update(datos).eq('id', existente.id)
    : supabase.from('cuadres_caja').insert({ ...datos, local_id: localId, fecha, registrado_nombre: registradoNombre });
  const { data, error } = await consulta.select().single().overrideTypes<CuadreCaja, { merge: false }>();
  if (error) throw new Error(error.message);
  return cuadre(data as CuadreCaja);
}

/** Reabre un cuadre cerrado (la base de datos solo lo permite al administrador y al gerente). */
export async function reabrirCuadre(id: string): Promise<CuadreCaja> {
  const { data, error } = await supabase.from('cuadres_caja').update({ estado: 'ABIERTO' }).eq('id', id).select().single().overrideTypes<CuadreCaja, { merge: false }>();
  if (error) throw new Error(error.message);
  return cuadre(data as CuadreCaja);
}

/** Sube una foto ("<local>/<día>/<tipo>-<hora>-<n>.jpg") y devuelve su ruta. */
export async function subirFoto(localId: string, fecha: string, tipo: TipoFotoCuadre, imagen: Blob): Promise<string> {
  const ruta = `${localId}/${fecha}/${tipo}-${Date.now()}-${Math.floor(Math.random() * 1000)}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(ruta, imagen, { contentType: 'image/jpeg', cacheControl: '3600' });
  if (error) throw new Error(mensajeAlmacenamiento(error.message));
  return ruta;
}

/** Borra fotos (best-effort: una foto huérfana no afecta al cuadre). */
export async function borrarFotos(rutas: string[]): Promise<void> {
  if (rutas.length === 0) return;
  await supabase.storage.from(BUCKET).remove(rutas);
}

/** Enlace temporal (1 hora) para ver una foto. */
export async function urlFirmada(ruta: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(ruta, 3600);
  if (error || !data) throw new Error('No se pudo abrir la foto.');
  return data.signedUrl;
}
