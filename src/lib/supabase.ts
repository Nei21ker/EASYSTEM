import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Exportadas (no solo locales) porque src/lib/auth.ts necesita crear un
// segundo cliente aislado al registrar un nuevo usuario (ver ese archivo).
export const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
export const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

/**
 * true solo cuando .env trae credenciales reales. src/lib/inventoryService.ts
 * usa este flag (también evaluable en el navegador, por el prefijo PUBLIC_)
 * para decidir entre Supabase y el fallback de LocalStorage.
 */
export const supabaseConfigurado = Boolean(supabaseUrl && supabaseAnonKey);

if (!supabaseConfigurado) {
  console.warn(
    '[EASYSTEM] Faltan las variables PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY. Copia .env.example a .env y complétalas. Mientras tanto, EASYSTEM funciona con LocalStorage.'
  );
}

// Nota: el cliente no se tipa con el genérico Database<> de supabase-js;
// cada función en src/lib/db/*.ts anota sus propios tipos (src/types/database.types.ts)
// vía `.overrideTypes<T>()`, lo que evita acoplarnos a la inferencia de esquema
// completa (más frágil entre versiones de supabase-js/TypeScript).
//
// Solo se instancia un cliente real cuando hay credenciales: supabase-js abre
// un WebSocket de Realtime al crear el cliente, y no queremos eso (ni el ruido
// en consola) mientras EASYSTEM corre en modo LocalStorage. Cuando no está
// configurado, `supabase` es un stub que revienta si algo lo usa por error —
// nunca debería pasar, porque inventoryService.ts siempre chequea
// `supabaseConfigurado` antes de tocar src/lib/db/*.ts.
export const supabase: SupabaseClient = supabaseConfigurado
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : (new Proxy(
      {},
      {
        get() {
          throw new Error(
            '[EASYSTEM] Supabase no está configurado. Este código no debería ejecutarse en modo LocalStorage; revisa supabaseConfigurado antes de llamar a src/lib/db/*.ts.'
          );
        },
      }
    ) as SupabaseClient);
