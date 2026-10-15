// Catálogo maestro de modelos de teléfono que se comercializan en la tienda
// (marca -> modelos). Es la única fuente de datos: de aquí salen tanto el modo
// LocalStorage (src/lib/mock-data.ts) como la migración de Supabase
// (supabase/migrations/0005_catalogo_modelos.sql, generada desde este archivo).
//
// Convenciones de nombre (importan: los productos se enlazan por nombre de modelo):
//  - Apple/Samsung conservan el prefijo comercial ("iPhone 15", "Galaxy A54").
//  - Redmi va bajo la marca Xiaomi, igual que el catálogo previo ("Redmi Note 12").
//  - Tecno/Infinix van sin el nombre de marca ("Spark 10", "Hot 30").
export const catalogoModelos: Record<string, string[]> = {
  Apple: [
    'iPhone 18 Pro Max', 'iPhone 18 Pro', 'iPhone 18', 'iPhone 18 Air', 'iPhone 18 Plus',
    'iPhone 17 Pro Max', 'iPhone 17 Pro', 'iPhone 17', 'iPhone 17 Slim',
    'iPhone 16 Pro Max', 'iPhone 16 Pro', 'iPhone 16 Plus', 'iPhone 16',
    'iPhone 15 Pro Max', 'iPhone 15 Pro', 'iPhone 15 Plus', 'iPhone 15',
    'iPhone 14 Pro Max', 'iPhone 14 Pro', 'iPhone 14 Plus', 'iPhone 14',
    'iPhone 13 Pro Max', 'iPhone 13 Pro', 'iPhone 13', 'iPhone 13 mini',
    'iPhone 12 Pro Max', 'iPhone 12 Pro', 'iPhone 12', 'iPhone 12 mini',
    'iPhone 11 Pro Max', 'iPhone 11 Pro', 'iPhone 11',
    'iPhone SE (3.ª gen, 2022)', 'iPhone SE (4.ª gen)',
  ],
  Samsung: [
    'Galaxy S26 Ultra', 'Galaxy S26+', 'Galaxy S26',
    'Galaxy S25 Ultra', 'Galaxy S25+', 'Galaxy S25',
    'Galaxy S24 Ultra', 'Galaxy S24+', 'Galaxy S24', 'Galaxy S24 FE',
    'Galaxy S23 Ultra', 'Galaxy S23+', 'Galaxy S23', 'Galaxy S23 FE',
    'Galaxy S22 Ultra', 'Galaxy S22',
    'Galaxy Z Fold 8', 'Galaxy Z Flip 8', 'Galaxy Z Fold 7', 'Galaxy Z Flip 7', 'Galaxy Z Fold 6', 'Galaxy Z Flip 6',
    'Galaxy A56', 'Galaxy A55', 'Galaxy A54', 'Galaxy A36', 'Galaxy A35', 'Galaxy A34',
    'Galaxy A25', 'Galaxy A24', 'Galaxy A17', 'Galaxy A16', 'Galaxy A15', 'Galaxy A14',
    'Galaxy A06', 'Galaxy A05', 'Galaxy A05s',
  ],
  Xiaomi: [
    'Xiaomi 17', 'Xiaomi 17 Pro', 'Xiaomi 17 Ultra',
    'Xiaomi 14', 'Xiaomi 14 Pro', 'Xiaomi 14 Ultra', 'Xiaomi 14T', 'Xiaomi 14T Pro',
    'Xiaomi 13', 'Xiaomi 13 Pro', 'Xiaomi 13 Ultra', 'Xiaomi 13T', 'Xiaomi 13T Pro',
    'Redmi Note 14 Pro+', 'Redmi Note 14 Pro', 'Redmi Note 14 5G', 'Redmi Note 14 4G',
    'Redmi Note 13 Pro+', 'Redmi Note 13 Pro 5G', 'Redmi Note 13 Pro 4G', 'Redmi Note 13 5G', 'Redmi Note 13 4G',
    'Redmi Note 12 Pro+', 'Redmi Note 12 Pro', 'Redmi Note 12 4G', 'Redmi Note 12S',
    'Redmi 14C', 'Redmi 13', 'Redmi 13C', 'Redmi 12', 'Redmi 12C', 'Redmi A3', 'Redmi A2',
  ],
  POCO: [
    'POCO X7 Pro', 'POCO X7', 'POCO X6 Pro', 'POCO X6', 'POCO X5 Pro',
    'POCO F7 Ultra', 'POCO F7 Pro', 'POCO F6 Pro', 'POCO F6', 'POCO F5 Pro',
    'POCO M6 Pro', 'POCO M6', 'POCO C65',
  ],
  Tecno: [
    'Spark 30', 'Spark 30 Pro', 'Spark 30 Pro+', 'Spark 30C',
    'Spark 20', 'Spark 20 Pro', 'Spark 20 Pro+', 'Spark 20C',
    'Spark 10', 'Spark 10 Pro', 'Spark 10C',
    'Spark Go 2024', 'Spark Go 2023',
    'Camon 30', 'Camon 30 Pro', 'Camon 30 Premier', 'Camon 30 5G',
    'Camon 20', 'Camon 20 Pro', 'Camon 20 Premier',
    'Pova 6', 'Pova 6 Pro', 'Pova 6 Neo', 'Pova 5', 'Pova 5 Pro',
  ],
  Infinix: [
    'Hot 50', 'Hot 50 Pro', 'Hot 50 Pro+', 'Hot 50i',
    'Hot 40', 'Hot 40 Pro', 'Hot 40i',
    'Hot 30', 'Hot 30i',
    'Note 40', 'Note 40 Pro', 'Note 40 Pro+', 'Note 40 Pro 5G',
    'Note 30', 'Note 30 Pro', 'Note 30 VIP',
    'GT 20 Pro', 'GT 10 Pro',
    'Smart 9', 'Smart 8', 'Smart 8 Pro', 'Smart 7',
  ],
};
