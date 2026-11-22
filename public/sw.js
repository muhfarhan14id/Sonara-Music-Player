'use strict';
// Naikkan VERSION setiap kali kamu mengubah file di SHELL agar cache lama diganti.
const VERSION = 'v1';
const SHELL = `sonara-shell-${VERSION}`;
const API = `sonara-api-${VERSION}`;
const IMG = `sonara-img-${VERSION}`; // nama ini juga dipakai di app.js (CFG.imgCache)
const FONT = `sonara-font-${VERSION}`;
const KEEP = [SHELL, API, IMG, FONT];

const SHELL_FILES = [
  '/',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];

const IMG_HOSTS = /(^|\.)(ytimg\.com|googleusercontent\.com|ggpht\.com)$/;
const FONT_HOSTS = /^(fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('sonara-') && !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trim(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map((k) => c.delete(k)));
}

// Jaringan dulu, jatuh ke cache bila gagal (untuk API dan halaman).
async function networkFirst(req, cacheName, fallbackKey, max) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) {
      cache.put(fallbackKey || req, res.clone());
      if (max) trim(cacheName, max);
    }
    return res;
  } catch (err) {
    const hit = await cache.match(fallbackKey || req);
    if (hit) return hit;
    throw err;
  }
}

// Cache dulu, perbarui di latar belakang.
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const refresh = fetch(req)
    .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
    .catch(() => null);
  return hit || (await refresh) || Response.error();
}

// Cover: cache dulu. Diambil dengan CORS agar tidak membengkak sebagai respons "opaque".
async function imageCache(req) {
  const cache = await caches.open(IMG);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  try {
    let res;
    try { res = await fetch(req.url, { mode: 'cors', credentials: 'omit' }); }
    catch (e) { return await fetch(req); }
    if (res.ok) { cache.put(req.url, res.clone()); trim(IMG, 600); }
    return res;
  } catch (e) {
    return Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // API milik sendiri: simpan hasil pencarian agar bisa dibuka lagi offline.
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
    e.respondWith(
      networkFirst(req, API, null, 200).catch(() =>
        new Response(JSON.stringify({ error: 'offline', items: [] }), {
          status: 503, headers: { 'Content-Type': 'application/json' },
        }))
    );
    return;
  }

  // Navigasi: selalu sajikan halaman utama (aplikasi satu halaman).
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, SHELL, '/').catch(() => caches.match('/')));
    return;
  }

  if (url.origin === location.origin) {
    e.respondWith(staleWhileRevalidate(req, SHELL));
    return;
  }

  if (IMG_HOSTS.test(url.hostname) && req.destination === 'image') {
    e.respondWith(imageCache(req));
    return;
  }

  if (FONT_HOSTS.test(url.hostname)) {
    e.respondWith(staleWhileRevalidate(req, FONT));
  }
  // Selain itu (YouTube iframe API, dll.) tidak disentuh.
});
