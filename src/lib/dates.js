// Local-time date helpers. Days are stored as "YYYY-MM-DD" in the user's own timezone.

export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function parseDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const d = parseDayKey(key);
  d.setDate(d.getDate() + n);
  return dayKey(d.getTime());
}

/** Array of day keys, oldest first, ending with `endKey`. */
export function lastNDays(n, endKey = dayKey()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDays(endKey, -i));
  return out;
}

/** Monday of the week containing `key`. */
export function weekStart(key) {
  const d = parseDayKey(key);
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  return addDays(key, -dow);
}

export function weekdayShort(key) {
  return parseDayKey(key).toLocaleDateString('en-GB', { weekday: 'short' });
}

export function prettyDay(key) {
  return parseDayKey(key).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function shortDay(key) {
  return parseDayKey(key).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
