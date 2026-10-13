// Service worker: rede primeiro (assim você sempre recebe a versão nova), cache quando estiver offline.
const CACHE = 'pedaleira-v31';
const SHELL = [
  './', 'index.html', 'css/app.css', 'fonts/archivo-latin.woff2', 'fonts/damion-latin.woff2', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'js/app.js', 'js/fit.js', 'js/suggestions.js', 'js/core.js', 'js/board.js', 'js/power.js', 'js/presets.js', 'js/scenes.js', 'js/control.js', 'js/stage.js', 'js/store.js', 'js/midi.js', 'js/audio/engine.js', 'js/audio/reverb-ir.js', 'js/audio/pitch.js', 'js/audio/dynamics.js', 'js/audio/dsp-worklet.js', 'js/ui/pedal-view.js',
  'js/pedals/index.js', 'js/pedals/common.js', 'js/pedals/sol-drive.js', 'js/pedals/eco-8.js',
  'js/pedals/salao.js', 'js/pedals/amp.js', 'js/pedals/afinador.js',
  'js/pedals/silencio.js', 'js/pedals/aperto.js', 'js/pedals/marimbondo.js', 'js/pedals/coro.js', 'js/pedals/fase-90.js',
  'js/pedals/ondas.js', 'js/pedals/ua.js', 'js/pedals/equalizador.js', 'js/pedals/turbo.js', 'js/pedals/volume.js', 'js/pedals/laco.js', 'js/pedals/oitava.js', 'js/pedals/flange.js', 'js/pedals/baleia.js', 'js/audio/looper.js', 'js/audio/latency.js', 'js/audio/modulation.js', 'js/audio/fuzz.js', 'js/audio/channel.js', 'js/factory.js', 'js/pedals/ratazana.js', 'js/pedals/abafa.js', 'js/pedals/pulso.js', 'js/audio/metro.js',
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
    // no-cache: confere com o servidor mesmo se o navegador tiver uma cópia "ainda válida" no cache HTTP.
    // Sem isso, o index.html novo podia vir com um app.js velho e botões novos ficavam sem ação.
    // Navegação vai pela URL: um Request de navegação não aceita opções novas.
    fetch(e.request.mode === 'navigate' ? e.request.url : e.request, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
