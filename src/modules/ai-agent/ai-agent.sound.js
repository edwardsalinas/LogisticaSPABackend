/**
 * Comparar nombres por cómo SUENAN en español. Es la misma idea que usa la ayuda por voz del frontend (guided/contactMatch.js): quien escribe
 * o dicta mal un nombre («Kispe» por «Quispe», «Bargas» por «Vargas») no debería quedarse sin respuesta. Aquí sirve para que el asistente, cuando
 * una búsqueda por nombre no encuentra nada, proponga el nombre CONOCIDO más parecido (solo entre los contactos que el rol ya puede ver).
 * Prudente: palabras de menos de 4 letras no se comparan por sonido, y con dos candidatos distintos no se elige: se pregunta.
 */
const strip = (text) =>
  String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();

const soundOf = (word) =>
  strip(word)
    .replace(/^h/, '').replace(/h/g, (m, i, s) => (s[i - 1] === 'c' ? m : '')) // la h no suena (salvo «ch»)
    .replace(/ll/g, 'y').replace(/w/g, 'u').replace(/x/g, 'ks')
    .replace(/qu(?=[ei])/g, 'k').replace(/q/g, 'k')
    .replace(/gu(?=[ei])/g, 'g').replace(/g(?=[ei])/g, 'j')
    .replace(/c(?=[ei])/g, 's').replace(/z/g, 's').replace(/c(?!h)/g, 'k')
    .replace(/v/g, 'b')
    .replace(/(.)\1+/g, '$1'); // letras dobles

export const soundKey = (name) => strip(name).split(' ').filter(Boolean).map(soundOf).join(' ');

export const distance = (a, b) => {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const keep = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = keep;
    }
  }
  return prev[b.length];
};

const allowed = (len) => (len <= 5 ? 0 : len <= 9 ? 1 : 2); // los nombres cortos casi no admiten error

/** ¿Todas las palabras oídas suenan como alguna palabra de este nombre? */
export const soundMatches = (query, name) => {
  const mine = soundKey(name).split(' ').filter(Boolean);
  const heard = strip(query).split(' ').filter(Boolean).map(soundOf).filter((t) => t.length >= 4);
  if (!heard.length || !mine.length) return false;
  return heard.every((h) => mine.some((m) => Math.abs(h.length - m.length) <= 2 && distance(h, m) <= allowed(Math.max(h.length, m.length))));
};

/** Los nombres de la lista que suenan como lo buscado, sin repetidos (hasta `max`). */
export const similarNames = (query, names, max = 3) => {
  const seen = new Set();
  const out = [];
  for (const n of names ?? []) {
    const key = strip(n);
    if (!key || seen.has(key)) continue;
    if (soundMatches(query, n)) { seen.add(key); out.push(n); if (out.length >= max) break; }
  }
  return out;
};
