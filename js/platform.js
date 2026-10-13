// Diferenças entre o navegador e o app nativo (Capacitor, Android e iOS). Só este arquivo conhece o Capacitor.
// No navegador tudo aqui cai no caminho de sempre; no app, o Capacitor injeta window.Capacitor antes dos módulos
// e os plugins nativos aparecem em Capacitor.Plugins (sem empacotador: o app não usa bundler).

const cap = globalThis.Capacitor;
export const isNative = !!cap?.isNativePlatform?.();
export const platform = isNative ? cap.getPlatform() : 'web'; // 'android' | 'ios' | 'web'
const plugin = name => cap?.Plugins?.[name];

// Baixar um arquivo. No navegador, um <a download>. No WebView não existe download: grava no cache do app e abre
// a folha de compartilhar (Arquivos no iPhone, Drive/WhatsApp/etc. no Android).
export async function saveFile(blob, name) {
  if (!isNative) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    return;
  }
  const data = await new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(r.result.slice(r.result.indexOf(',') + 1));
    r.onerror = () => fail(r.error);
    r.readAsDataURL(blob);
  });
  const { uri } = await plugin('Filesystem').writeFile({ path: name, data, directory: 'CACHE' });
  await plugin('Share').share({ title: name, files: [uri] });
}

// Tela acesa enquanto o áudio está ligado, nos WebViews sem navigator.wakeLock.
export async function keepAwake(on) {
  const ka = isNative && plugin('KeepAwake');
  if (!ka) return;
  try { await (on ? ka.keepAwake() : ka.allowSleep()); } catch { /* segue sem */ }
}

// Antes de ligar o áudio: no iPhone, pede ao sistema a sessão de gravação com buffer curto (plugin AudioSession,
// ver native/). Sem o plugin (ou no Android, que já usa o caminho de baixa latência), não faz nada.
export async function prepareAudio() {
  const s = isNative && plugin('AudioSession');
  if (!s) return;
  try { await s.prepare({ sampleRate: 48000, bufferSeconds: 0.005 }); } catch { /* segue com o padrão do sistema */ }
}

// MIDI nativo (CoreMIDI no iPhone, android.media.midi no Android): os WebViews não têm Web MIDI.
// onMessage recebe os bytes crus, como o onmidimessage do navegador. Devolve a lista de entradas ou null.
export async function nativeMidi(onMessage) {
  const m = isNative && plugin('Midi');
  if (!m) return null;
  await m.addListener('message', e => onMessage(Uint8Array.from(e.data)));
  const { inputs } = await m.start();
  return inputs;
}
export const hasNativeMidi = !!(isNative && plugin('Midi'));

if (isNative) plugin('StatusBar')?.hide().catch(() => {});
