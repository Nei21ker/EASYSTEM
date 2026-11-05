// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

import tailwindcss from '@tailwindcss/vite';

// El sitio sigue siendo ESTÁTICO (las páginas son archivos que Cloudflare sirve sin gastar peticiones del Worker);
// solo las rutas de src/pages/api con `export const prerender = false` corren en el Worker.
// https://astro.build/config
export default defineConfig({
  output: 'static',
  // Páginas como ventas.html (no ventas/index.html): así /ventas se sirve directo. Con carpetas, Cloudflare respondía
  // 307 hacia /ventas/ en CADA navegación del menú (un viaje de ida y vuelta de más en una red lenta).
  build: { format: 'file' },
  // No usamos sesiones de Astro (la sesión es de Better-Auth): evita que el adaptador agregue un KV innecesario
  session: { driver: 'memory' },
  adapter: cloudflare({ imageService: 'passthrough' }),
  vite: {
    plugins: [tailwindcss()]
  }
});
