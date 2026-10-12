// Service worker: rede primeiro (assim você sempre recebe a versão nova), cache quando estiver offline.
const CACHE = 'pedaleira-v8';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'js/app.js', 'js/core.js', 'js/board.js', 'js/power.js', 'js/presets.js', 'js/scenes.js', 'js/control.js', 'js/stage.js', 'js/store.js', 'js/midi.js', 'js/audio/engine.js', 'js/audio/reverb-ir.js', 'js/audio/pitch.js', 'js/audio/dynamics.js', 'js/audio/dsp-worklet.js', 'js/ui/pedal-view.js',
  'js/pedals/index.js', 'js/pedals/common.js', 'js/pedals/sol-drive.js', 'js/pedals/eco-8.js',
  'js/pedals/salao.js', 'js/pedals/amp.js', 'js/pedals/afinador.js',
  'js/pedals/silencio.js', 'js/pedals/aperto.js', 'js/pedals/marimbondo.js', 'js/pedals/coro.js', 'js/pedals/fase-90.js',
  'js/pedals/ondas.js', 'js/pedals/ua.js', 'js/pedals/equalizador.js', 'js/pedals/turbo.js', 'js/pedals/volume.js', 'js/pedals/laco.js', 'js/audio/looper.js', 'js/audio/latency.js',
  'js/nam/nam-core.js', 'js/nam/nam-engine.js', 'js/nam/nam-worklet.js', 'js/nam/nam.wasm',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
