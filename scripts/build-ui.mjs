// Builds the page the Worker serves: the Cashflow app's own screens (esbuild bundle + styles in one HTML file) into public/index.html.
// The screens live in the Cashflow Tracker repository (src/ui); set CASHFLOW_DIR if it is not in the usual place.
//   node scripts/build-ui.mjs
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = process.env.CASHFLOW_DIR || 'D:/Project/Cashflow Tracker';
const { buildUiHtml } = await import(pathToFileURL(`${root}/scripts/ui-build.mjs`).href);
// "Add to home screen": only this copy of the page (not the Apps Script one) links the manifest; the icons and manifest are copied beside it.
const html = (await buildUiHtml()).replace('</head>', '<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials"><link rel="apple-touch-icon" href="/apple-touch-icon.png"></head>');
if (/<\?[!=]?/.test(html)) throw new Error('the page still has Apps Script template tags (<?...?>)');
mkdirSync(new URL('../public', import.meta.url), { recursive: true });
for (const f of readdirSync(new URL('../assets-src/', import.meta.url))) copyFileSync(new URL(`../assets-src/${f}`, import.meta.url), new URL(`../public/${f}`, import.meta.url));
writeFileSync(new URL('../public/index.html', import.meta.url), html);
console.log(`public/index.html: ${html.length} characters; Google references: ${(html.match(/google\.script/g) || []).length}`);
