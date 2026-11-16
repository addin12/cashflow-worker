// The install page: the Install button where the browser offers one (Chrome on Android), and a note when the app is already installed.
const $ = (id) => document.getElementById(id);
const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let prompt = null;
if (installed) $('done').hidden = false;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); prompt = e; $('install').hidden = false; });
$('install').addEventListener('click', async () => {
  if (!prompt) return;
  prompt.prompt();
  const { outcome } = await prompt.userChoice;
  prompt = null;
  $('install').hidden = true;
  if (outcome === 'accepted') $('done').hidden = false;
});
window.addEventListener('appinstalled', () => { $('install').hidden = true; $('done').hidden = false; });
