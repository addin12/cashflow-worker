// Turns notifications on for this device: asks permission, subscribes with the app's public key, and hands the subscription back to the app with the one-time
// code from its Settings link. This page lives at the app's own address on purpose: an iPhone only allows web notifications from the installed app itself, and a
// page at another address opens in a small in-app browser where the question is always refused.
import { afterAsk, stateOf } from '/notifikasi-state.js';

const VAPID_PUBLIC = 'BCY1s4-B5rUHX8c8AvmdRSFCbmH34hRmDiE_OvCW1Poxn5ekRohkJmYNKrUTAC56EUcK78BLzhE7uOI-ILzS1LU';

const $ = (id) => document.getElementById(id);
const code = new URLSearchParams(location.search).get('n') || '';
const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const say = (text, bad = false) => { $('msg').textContent = text; $('msg').className = `msg ${bad ? 'bad' : ''}`; };
const steps = (list) => { $('steps').innerHTML = ''; list.forEach((t) => { const li = document.createElement('li'); li.textContent = t; $('steps').appendChild(li); }); $('steps').hidden = !list.length; };

function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /android/i.test(ua) ? 'Android' : /iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) ? 'iPad' : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'Mac' : 'Perangkat';
  const browser = /edg\//i.test(ua) ? 'Edge' : /firefox/i.test(ua) ? 'Firefox' : /chrome|crios/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : '';
  return [os, browser].filter(Boolean).join(' · ');
}
const keyBytes = (b64) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

const INSTALL_STEPS = [
  `Buka ${location.origin} di Safari (langsung di Safari, bukan di dalam aplikasi lain).`,
  'Ketuk tombol Bagikan, lalu Tambahkan ke Layar Utama, lalu Tambah.',
  'Buka Cashflow dari ikon barunya dan masuk dengan kode email.',
  'Di sana: Pengaturan → Otomatis → Notifikasi di HP → Aktifkan di perangkat ini.',
];

function render(state) {
  $('allow').hidden = state.kind !== 'ready' && state.kind !== 'denied';
  if (state.kind === 'nocode') { steps([]); say('Buka halaman ini dari aplikasi: Pengaturan → Otomatis → Notifikasi di HP → Aktifkan di perangkat ini.'); }
  else if (state.kind === 'ios-install') { say('Di iPhone, notifikasi hanya bisa untuk aplikasi yang sudah dipasang di layar utama dan diaktifkan dari ikonnya.'); steps(INSTALL_STEPS); }
  else if (state.kind === 'unsupported') { steps(state.ios ? INSTALL_STEPS : []); say(state.ios ? 'Browser ini belum bisa menerima notifikasi. Di iPhone pakai Safari, pasang di layar utama (perlu iOS 16.4 ke atas).' : 'Browser ini tidak mendukung notifikasi. Coba Chrome di Android.', true); }
  else if (state.kind === 'denied' && state.ios) {
    say('Notifikasi untuk Cashflow sedang mati di iPhone ini.', true);
    steps(['Buka Pengaturan iPhone → Notifikasi → Cashflow, lalu nyalakan Izinkan Notifikasi.', `Kalau Cashflow tidak ada di daftar itu: hapus ikon Cashflow dari layar utama, lalu pasang lagi dengan langkah di bawah.`, ...INSTALL_STEPS.slice(0, 3), 'Kembali ke halaman ini dan ketuk Izinkan notifikasi.']);
  } else if (state.kind === 'denied') { steps([]); say(`Izin ditolak. Buka pengaturan situs di browser, izinkan notifikasi untuk ${location.host}, lalu coba lagi.`, true); }
  else if (state.kind === 'granted') { steps([]); say('Menyimpan ke aplikasi…'); }
  else { steps([]); say(''); }
}

render(stateOf({ code, ios, installed, supported, permission: supported ? Notification.permission : 'default' }));

$('allow').addEventListener('click', async () => {
  $('allow').disabled = true;
  say('Meminta izin…');
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const permission = await Notification.requestPermission();
    const after = afterAsk(permission, ios);
    render(after);
    if (after.kind !== 'granted') { $('allow').disabled = false; return; }
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) });
    const q = new URLSearchParams({ tab: 'settings', n: code, label: deviceLabel(), push: JSON.stringify(sub.toJSON()) });
    location.replace(`/?${q}`);
  } catch (e) {
    say(`Belum berhasil: ${e.message}`, true);
    $('allow').disabled = false;
  }
});
