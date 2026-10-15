// Idiomas: português (o original), inglês e espanhol.
// Os textos ficam em js/i18n/<módulo>.js, cada arquivo com { pt: {...}, en: {...}, es: {...} } e chaves
// "módulo.nome". Aqui elas são juntadas; t() procura no idioma atual e cai para o português se faltar.
//
// Sintaxe dos textos:
// - {nome}: troca por params.nome (t('presets.saved', { name })).
// - plural: o valor é um objeto { one: '...', other: '...' } (e o que mais o Intl.PluralRules do idioma pedir);
//   a escolha vem de params.n, e {n} é trocado pelo número já formatado no idioma.
// No HTML: data-i18n="chave" (texto), data-i18n-html="chave" (texto com <b>, <kbd>), e
// data-i18n-attr="title:chave;aria-label:chave;placeholder:chave" (atributos).
import app from './i18n/app.js';
import board from './i18n/board.js';
import core from './i18n/core.js';
import control from './i18n/control.js';
import helpDict from './i18n/help.js';
import html from './i18n/html.js';
import pedalView from './i18n/pedal-view.js';
import pedals from './i18n/pedals.js';
import power from './i18n/power.js';
import presets from './i18n/presets.js';
import scenes from './i18n/scenes.js';
import stage from './i18n/stage.js';

export const LANGS = { pt: 'Português', en: 'English', es: 'Español' };
const LOCALES = { pt: 'pt-BR', en: 'en', es: 'es' };
const KEY = 'brasa.lang';

export const DICTS = { pt: {}, en: {}, es: {} };
// Texto de ajuda opcional (o que um pedal faz, o que um botão muda): '' quando não existe.
export const help = (key, params) => (key in DICTS.pt ? t(key, params) : '');
for (const part of [app, board, core, control, helpDict, html, pedalView, pedals, power, presets, scenes, stage])
  for (const l of Object.keys(DICTS)) Object.assign(DICTS[l], part[l]);

// Escolha guardada > idiomas do sistema > inglês (para quem não fala nenhum dos três, é o mais provável de ler).
export function detectLang(saved, preferred) {
  if (saved in LANGS) return saved;
  for (const p of preferred || []) {
    const base = String(p).toLowerCase().split('-')[0];
    if (base in LANGS) return base;
  }
  return 'en';
}
const stored = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export let lang = detectLang(stored(), globalThis.navigator?.languages || [globalThis.navigator?.language]);
export const locale = () => LOCALES[lang];

// Só para os testes (no app, trocar de idioma recarrega a página).
export function useLang(l) { lang = l; }

const plurals = {};
export function fmtNum(x, digits = 0) {
  return new Intl.NumberFormat(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(x);
}

export function t(key, params = {}) {
  let v = DICTS[lang][key] ?? DICTS.pt[key];
  if (v === undefined) return key;
  if (typeof v === 'object') {
    plurals[lang] ??= new Intl.PluralRules(locale());
    v = v[plurals[lang].select(params.n ?? 0)] ?? v.other;
  }
  return v.replace(/\{(\w+)\}/g, (m, k) => {
    if (k === 'n' && typeof params.n === 'number') return fmtNum(params.n);
    return k in params ? String(params[k]) : m;
  });
}

export function applyI18n(root = document) {
  document.documentElement.lang = locale();
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-attr]'))
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':').map(s => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
}

// Trocar de idioma recarrega: tudo que já foi desenhado (pedais, listas, mensagens) sai no idioma novo.
export function setLang(l) {
  try { localStorage.setItem(KEY, l); } catch { /* sem armazenamento: vale só nesta visita */ }
  location.reload();
}
