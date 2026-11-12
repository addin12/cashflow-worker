// Amounts and dates as Indonesian banks write them.

/**
 * "IDR 20,500.00" (BCA, English) · "Rp 488.333,00" / "Rp4.207.669,52" (Indonesian)
 * "Rp5.000.000" · "19,800" · "-Rp2.500,00" -> number (absolute value, 2 decimals max).
 * Returns NaN when no amount is found.
 */
export function parseAmount(raw) {
  if (raw == null) return NaN;
  const s = String(raw).replace(/\s/g, '');
  const m = s.match(/\d[\d.,]*/);
  if (!m) return NaN;
  let n = m[0].replace(/[.,]$/, '');
  const lastDot = n.lastIndexOf('.');
  const lastComma = n.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Both separators: the later one is the decimal mark.
    n = lastComma > lastDot ? n.replace(/\./g, '').replace(',', '.') : n.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // Only commas: decimal if exactly 1-2 digits follow the single comma ("12,5"), else thousands.
    n = /^\d+,\d{1,2}$/.test(n) ? n.replace(',', '.') : n.replace(/,/g, '');
  } else if (lastDot >= 0) {
    // Only dots: "5.000.000" / "488.333" are thousands; "12.50" is a decimal.
    n = /^\d+\.\d{1,2}$/.test(n) ? n : n.replace(/\./g, '');
  }
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
}

const MONTHS = {
  jan: 1, januari: 1, january: 1,
  feb: 2, februari: 2, february: 2, peb: 2,
  mar: 3, maret: 3, march: 3,
  apr: 4, april: 4,
  mei: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  agu: 8, agt: 8, agustus: 8, aug: 8, august: 8, ags: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oct: 10, oktober: 10, october: 10,
  nov: 11, nopember: 11, november: 11,
  des: 12, dec: 12, desember: 12, december: 12,
};

export function monthNumber(name) {
  return MONTHS[String(name).toLowerCase().replace(/\.$/, '')] || 0;
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * "05 Oct 2026 09:17:32" · "2 Okt 2026" · "27 Sep 2026 00:00:51 WIB" · "28 September 2026 20:49 WIB"
 * -> { date: '2026-10-05', time: '09:17:32' } (time '' when absent). null if not a date.
 * Times in bank emails are local (WIB), so no time-zone conversion happens here.
 */
export function parseDateTime(raw) {
  const m = String(raw || '').match(/(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})(?:[,\s]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?/);
  if (!m) return null;
  const month = monthNumber(m[2]);
  const day = Number(m[1]);
  const year = Number(m[3]);
  if (!month || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1) return null;
  const time = m[4] ? `${pad(m[4])}:${m[5]}:${m[6] || '00'}` : '';
  return { date: `${year}-${pad(month)}-${pad(day)}`, time };
}

/** "09:23:59 WIB" -> "09:23:59" */
export function parseTime(raw) {
  const m = String(raw || '').match(/(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/);
  return m ? `${pad(m[1])}:${m[2]}:${m[3] || '00'}` : '';
}

/** An email's own timestamp (ms since epoch) as a WIB (UTC+7) date and time. */
export function wibFromEpoch(ms) {
  const d = new Date(Number(ms) + 7 * 3600 * 1000);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
  };
}

/** Last `n` digits found in a string ("TAHAPAN - 1234****56" -> "56", n=all trailing). */
export function trailingDigits(raw) {
  const m = String(raw || '').replace(/\s/g, '').match(/(\d+)\D*$/);
  return m ? m[1] : '';
}
