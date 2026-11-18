/** Adapta el campo de recepción al formato de las órdenes existentes. */
export function separarEquipo(texto: string, marcas: string[]) {
  const equipo = texto.trim().replace(/\s+/g, ' ');
  const marcaConocida = marcas
    .filter((marca) => equipo.toLowerCase().startsWith(`${marca.toLowerCase()} `))
    .sort((a, b) => b.length - a.length)[0];
  const corte = marcaConocida?.length ?? equipo.indexOf(' ');
  if (corte < 1) return null;
  const equipo_marca = equipo.slice(0, corte);
  const equipo_modelo = equipo.slice(corte + 1);
  if (!equipo_modelo || equipo_marca.length > 60 || equipo_modelo.length > 80) return null;
  return { equipo_marca, equipo_modelo };
}
