// Cloudflare Workers always run in UTC; the Apps Script app ran in Asia/Jakarta, and the app's core reads "today" through a Date's local getters
// (getFullYear, getMonth, getDate ...). A JakartaDate is the real moment (getTime, valueOf and toISOString are the true ones) whose local getters
// show Jakarta's wall clock, so between 00:00 and 07:00 WIB "today" is the right day.
const OFFSET_MS = 7 * 3600000;

export class JakartaDate extends Date {
  #wall() { return new Date(this.getTime() + OFFSET_MS); }
  getFullYear() { return this.#wall().getUTCFullYear(); }
  getMonth() { return this.#wall().getUTCMonth(); }
  getDate() { return this.#wall().getUTCDate(); }
  getDay() { return this.#wall().getUTCDay(); }
  getHours() { return this.#wall().getUTCHours(); }
  getMinutes() { return this.#wall().getUTCMinutes(); }
  getSeconds() { return this.#wall().getUTCSeconds(); }
  getTimezoneOffset() { return -OFFSET_MS / 60000; }
}

/** The current moment (or the given one, a Date or milliseconds) as a JakartaDate. */
export const jakarta = (at = Date.now()) => new JakartaDate(at instanceof Date ? at.getTime() : at);
