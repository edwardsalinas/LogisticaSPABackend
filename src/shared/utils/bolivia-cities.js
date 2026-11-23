/**
 * Ciudades y localidades habituales de las rutas, para corregir errores de lectura de una foto
 * (por ejemplo "Ouro" por "Oruro"). Es la misma lista que usa el selector de ubicación del frontend.
 */
export const KNOWN_CITIES = [
  'La Paz', 'El Alto', 'Viacha', 'Achacachi', 'Patacamaya', 'Caracollo', 'Oruro', 'Cochabamba', 'Potosí', 'Sucre',
  'Tarija', 'Santa Cruz de la Sierra', 'Trinidad', 'Cobija',
];

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Distancia de edición (cuántas letras hay que cambiar, agregar o quitar para igualar dos textos). */
export const editDistance = (a, b) => {
  const x = norm(a);
  const y = norm(b);
  const row = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= y.length; j += 1) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[y.length];
};

/**
 * Corrige un nombre de ciudad que se parece mucho (una letra de diferencia) a una conocida.
 * No toca lo que ya es una ciudad conocida, ni lo que la contiene ("Municipio Caracollo"), ni lugares desconocidos.
 * @returns {{ value: string|null, corrected: boolean, from?: string }}
 */
export const correctCity = (text) => {
  if (text == null || String(text).trim() === '') return { value: text ?? null, corrected: false };
  const t = norm(text);
  if (KNOWN_CITIES.some((c) => t === norm(c) || t.includes(norm(c)))) return { value: text, corrected: false };
  if (t.length < 4) return { value: text, corrected: false };
  const near = KNOWN_CITIES.filter((c) => editDistance(t, c) <= (t.length >= 9 ? 2 : 1));
  if (near.length !== 1) return { value: text, corrected: false }; // sin candidata clara: no se adivina
  return { value: near[0], corrected: true, from: text };
};
