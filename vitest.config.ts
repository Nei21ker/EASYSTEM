// Las pruebas del servidor corren dentro del runtime de Workers (workerd) con D1 y R2 simulados.
// No usan wrangler.jsonc a propósito: su `main` es el entrypoint de Astro, que necesita el build.
import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: '2026-10-01',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: { DB: 'easystem-test' },
        r2Buckets: ['FOTOS_PUBLICAS', 'FOTOS_PRIVADAS'],
        bindings: {
          BETTER_AUTH_SECRET: 'secreto-solo-para-pruebas-0123456789abcdef',
          URL_FOTOS_PUBLICAS: 'https://fotos.test/publico',
        },
      },
    }),
  ],
  test: {
    include: ['tests/server/**/*.test.ts'],
  },
});
