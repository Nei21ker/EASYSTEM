// Punto de entrada del Worker: atiende las peticiones con Astro (igual que antes) y, además, corre las tareas programadas (cron).
import { handle } from '@astrojs/cloudflare/handler';
import type { Entorno } from './server/entorno';
import { actualizarTasaDesdeBcv } from './server/servicios/tasaBcv';

type Contexto = { waitUntil(promesa: Promise<unknown>): void };

export default {
  fetch: handle,

  /**
   * Cron (ver `triggers.crons` en wrangler.jsonc, en UTC): 12:00, 13:00 y 14:00 UTC = 8, 9 y 10 a. m. en Caracas (UTC−4).
   * La primera hora es la que cuenta; las otras dos solo reintentan si la fuente falló o publicó un valor nuevo
   * (no hacen nada si hoy ya hay tasa). Corre todos los días, fin de semana incluido.
   */
  async scheduled(_evento: unknown, env: unknown, ctx: Contexto): Promise<void> {
    ctx.waitUntil(
      actualizarTasaDesdeBcv(env as Entorno).then((r) => {
        if (r.resultado === 'error') console.error(`Tasa BCV automática: ${r.motivo}`);
        else console.log(`Tasa BCV automática: ${r.resultado} (${r.fecha}, ${r.tasa})`);
      })
    );
  },
};
