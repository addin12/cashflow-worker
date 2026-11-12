/**
 * Plain string comparison for sorting dates and times ("2026-11-05", "2026-11-0510:00:00"). For these keys it gives the same
 * order as localeCompare, many times faster (localeCompare goes through the locale collator on every call).
 */
export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
