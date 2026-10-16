// Regras mínimas: o que pega erro de verdade (variável que não existe, promessa esquecida, código morto).
// Estilo fica por conta de quem escreve. `npm run lint`; roda no CI antes dos testes.
import js from '@eslint/js';

const browser = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly', history: 'readonly',
  localStorage: 'readonly', sessionStorage: 'readonly', indexedDB: 'readonly', fetch: 'readonly', Response: 'readonly',
  Request: 'readonly', Headers: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', Blob: 'readonly', File: 'readonly',
  FileReader: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly', CompressionStream: 'readonly',
  DecompressionStream: 'readonly', AudioContext: 'readonly', OfflineAudioContext: 'readonly', AudioWorkletNode: 'readonly',
  MediaRecorder: 'readonly', MediaStream: 'readonly', Audio: 'readonly', Image: 'readonly', Option: 'readonly',
  Element: 'readonly', HTMLElement: 'readonly', Node: 'readonly', Event: 'readonly', CustomEvent: 'readonly',
  KeyboardEvent: 'readonly', MouseEvent: 'readonly', PointerEvent: 'readonly', MessageChannel: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', requestIdleCallback: 'readonly',
  addEventListener: 'readonly', removeEventListener: 'readonly', dispatchEvent: 'readonly', matchMedia: 'readonly',
  getComputedStyle: 'readonly', innerWidth: 'readonly', innerHeight: 'readonly', screen: 'readonly', scrollTo: 'readonly',
  performance: 'readonly', console: 'readonly', WebAssembly: 'readonly', structuredClone: 'readonly', queueMicrotask: 'readonly',
  crypto: 'readonly', Intl: 'readonly', globalThis: 'readonly', ResizeObserver: 'readonly', visualViewport: 'readonly',
  Capacitor: 'readonly', devicePixelRatio: 'readonly', confirm: 'readonly', alert: 'readonly',
  scrollX: 'readonly', scrollY: 'readonly', btoa: 'readonly', atob: 'readonly', prompt: 'readonly',
};
const worklet = { AudioWorkletProcessor: 'readonly', registerProcessor: 'readonly', sampleRate: 'readonly', currentTime: 'readonly', WebAssembly: 'readonly', console: 'readonly' };
const node = { process: 'readonly', Buffer: 'readonly', console: 'readonly', performance: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', URL: 'readonly', fetch: 'readonly', WebAssembly: 'readonly', WebSocket: 'readonly', TextDecoder: 'readonly', TextEncoder: 'readonly', globalThis: 'readonly' };

const rules = {
  ...js.configs.recommended.rules,
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-constant-condition': ['error', { checkLoops: false }],
  'prefer-const': 'error',
  'no-var': 'error',
  'eqeqeq': ['error', 'smart'],
  'no-floating-decimal': 'off',
};

export default [
  { ignores: ['node_modules/', 'www/', 'android/', 'ios/', 'nam-wasm/target/', 'sw.js'] },
  { files: ['js/**/*.js'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: browser }, rules },
  { files: ['js/audio/dsp-worklet.js', 'js/nam/nam-worklet.js'], languageOptions: { globals: worklet } },
  { files: ['tests/**/*.mjs', 'scripts/**/*.mjs', 'eslint.config.js'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...browser, ...node } }, rules },
];
