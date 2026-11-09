import { esquemaSalidaConMerma } from '../../../server/esquemas';
import { conSesion, leerJson } from '../../../server/http';
import { registrarSalidaConMerma } from '../../../server/servicios/mermas';

export const prerender = false;

/**
 * Una línea de venta de un producto por cantidad con piezas defectuosas: la salida de lo que se cobra y la baja de lo que se bota,
 * en un solo lote atómico. Encargado, gerente o administrador; con 3 o más defectuosas en la venta exige la autorización de una clave.
 */
export const POST = conSesion(async ({ env, sesion, request }) => registrarSalidaConMerma(env, sesion, await leerJson(request, esquemaSalidaConMerma)));
