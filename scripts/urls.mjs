// The addresses of your deployed Workers, kept out of the repository: set CASHFLOW_URL / MAIL_URL, or put { "cashflow": "...", "mail": "..." } in secrets/urls.json.
import { existsSync, readFileSync } from 'node:fs';

const file = new URL('../secrets/urls.json', import.meta.url);
const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
export function url(name) {
  const v = process.env[`${name.toUpperCase()}_URL`] || saved[name];
  if (!v) throw new Error(`set ${name.toUpperCase()}_URL or add "${name}" to secrets/urls.json`);
  return String(v).replace(/\/$/, '');
}
