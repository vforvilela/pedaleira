// Service worker: rede primeiro (assim você sempre recebe a versão nova), cache quando estiver offline.
const CACHE = 'pedaleira-v74'; // shell 05c09a03ff9e
const SHELL = [
  './', 'index.html', 'css/app.css', 'fonts/archivo-latin.woff2', 'fonts/damion-latin.woff2', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/fit.js', 'js/i18n.js', 'js/i18n-apply.js', 'js/i18n/app.js', 'js/i18n/board.js', 'js/i18n/control.js', 'js/i18n/core.js', 'js/i18n/help.js', 'js/i18n/html.js', 'js/i18n/pedal-view.js', 'js/i18n/pedals.js', 'js/i18n/power.js', 'js/i18n/presets.js', 'js/i18n/scenes.js', 'js/i18n/stage.js', 'js/suggestions.js', 'js/core.js', 'js/chain.js', 'js/files.js', 'js/board.js', 'js/power.js', 'js/presets.js', 'js/scenes.js', 'js/control.js', 'js/stage.js', 'js/store.js', 'js/platform.js', 'js/midi.js', 'js/audio/engine.js', 'js/audio/reverb-ir.js', 'js/audio/pitch.js', 'js/audio/dynamics.js', 'js/audio/dsp-worklet.js', 'js/ui/pedal-view.js',
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

// Sinal fraco (palco, 3G ruim): a rede conecta mas não responde, e o fetch fica pendurado sem nunca falhar.
// Depois de WAIT ms sem resposta, entrega o que estiver no cache; a resposta da rede, se chegar, ainda atualiza o cache.
// Um timeout marca a rede como lenta por SLOW ms: os outros arquivos vão direto ao cache em vez de esperar um por um.
const WAIT = 3000, SLOW = 30000;
let slowUntil = 0;

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // no-cache: confere com o servidor mesmo se o navegador tiver uma cópia "ainda válida" no cache HTTP.
  // Sem isso, o index.html novo podia vir com um app.js velho e botões novos ficavam sem ação.
  // Navegação vai pela URL: um Request de navegação não aceita opções novas.
  const net = fetch(e.request.mode === 'navigate' ? e.request.url : e.request, { cache: 'no-cache' })
    .then(res => {
      slowUntil = 0;
      if (res.ok) { const copy = res.clone(); saved = caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    });
  let saved;
  // Mantém o worker vivo até a resposta da rede chegar e ser guardada, mesmo que o cache já tenha respondido.
  e.waitUntil(net.then(() => saved, () => {}));
  const cached = () => caches.match(e.request, { ignoreSearch: true });
  const wait = Date.now() < slowUntil ? 0 : WAIT;
  const slow = new Promise(r => setTimeout(r, wait)).then(cached).then(hit => {
    if (hit && wait) slowUntil = Date.now() + SLOW;
    return hit || net;
  });
  e.respondWith(Promise.race([net, slow]).catch(() => cached().then(hit => hit || net)));
});
