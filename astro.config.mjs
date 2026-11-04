// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

import tailwindcss from '@tailwindcss/vite';

// El sitio sigue siendo ESTÁTICO (las páginas son archivos que Cloudflare sirve sin gastar peticiones del Worker);
// solo las rutas de src/pages/api con `export const prerender = false` corren en el Worker.
// https://astro.build/config
export default defineConfig({
  output: 'static',
  adapter: cloudflare(),
  vite: {
    plugins: [tailwindcss()]
  }
});
