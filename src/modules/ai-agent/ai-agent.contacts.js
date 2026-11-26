/**
 * Memoria de uso: los remitentes y destinatarios que más se repiten en los paquetes que la persona YA puede ver. Sin modelo de lenguaje:
 * es solo contar. Sirve para que la ayuda por voz reconozca «Rosa Quispe» aunque el micrófono haya oído «Rosa Quispi», y para no volver a
 * preguntar un teléfono que ya se conoce.
 *
 * Quién ve qué (no se amplía nada: son datos de paquetes que cada rol ya consulta):
 *  - administrador y operador: los de todos los paquetes;
 *  - cliente: solo los de los paquetes que él registró (sender_id);
 *  - conductor y demás: nada.
 */
const MAX_ROWS = 500;
export const MAX_CONTACTS = 40;
const TEST_NAME = /^(E2E|DEMO)[-\s_]/i; // datos de prueba y de demostración no son contactos reales

/** «María  QUISPE» → «maria quispe» (para agrupar la misma persona escrita de distintas formas). */
export const nameKey = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const validName = (n) => n.length >= 3 && n.length <= 80 && /\p{L}/u.test(n) && !TEST_NAME.test(n);
const validPhone = (p) => /^\+?[0-9 ]{7,15}$/.test(clean(p));

/** Una lista de filas (más recientes primero) → { recipients, senders }, cada uno con { name, phone, uses } ordenado por uso. */
export const buildContacts = (rows) => {
  const acc = { recipients: new Map(), senders: new Map() };
  const add = (map, rawName, rawPhone) => {
    const name = clean(rawName);
    if (!validName(name)) return;
    const key = nameKey(name);
    if (!key) return;
    const phone = validPhone(rawPhone) ? clean(rawPhone) : null;
    const cur = map.get(key);
    if (!cur) map.set(key, { name, phone, uses: 1, order: map.size }); // la primera aparición es la más reciente: su escritura gana
    else { cur.uses += 1; if (!cur.phone && phone) cur.phone = phone; }
  };
  for (const r of rows ?? []) {
    add(acc.recipients, r.recipient_name, r.recipient_phone);
    add(acc.senders, r.sender_name, r.sender_phone);
  }
  const top = (map) => [...map.values()].sort((a, b) => b.uses - a.uses || a.order - b.order).slice(0, MAX_CONTACTS).map(({ name, phone, uses }) => ({ name, phone, uses }));
  return { recipients: top(acc.recipients), senders: top(acc.senders) };
};

const STAFF = new Set(['admin', 'logistics_operator']);

export const loadContacts = async (user, db) => {
  const empty = { recipients: [], senders: [] };
  const role = user?.role;
  if (!STAFF.has(role) && role !== 'client') return empty;
  let q = db.from('packages').select('sender_name, sender_phone, recipient_name, recipient_phone, created_at').order('created_at', { ascending: false }).limit(MAX_ROWS);
  if (role === 'client') q = q.eq('sender_id', user.id);
  const { data, error } = await q;
  if (error) throw error;
  return buildContacts(data);
};
