// Arquivos (.nam, IR) vindos de um link: endereço direto, download com limites e leitura.
import { t } from './i18n.js';
import { safeUrl } from './chain.js';

export const parseFile = async (kind, read) => (kind === 'nam' ? JSON.parse(await read.text()) : await read.arrayBuffer());

// Link de página do GitHub ou de compartilhamento do Dropbox → link direto do arquivo.
export function directUrl(text) {
  const u = new URL(text.trim());
  const gh = u.hostname === 'github.com' && u.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/);
  if (gh) return `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3]}`;
  if (/(^|\.)dropbox\.com$/.test(u.hostname) && u.hostname !== 'dl.dropboxusercontent.com') {
    u.hostname = 'dl.dropboxusercontent.com';
    u.searchParams.delete('dl');
  }
  return u.href;
}

// Baixa a captura (.nam) ou IR (.wav) de um link direto. Devolve os dados ou lança um erro legível.
const MAX_FILE_BYTES = 64 << 20; // capturas têm dezenas de KB a poucos MB; IRs, até alguns MB

export async function fetchFile(kind, url) {
  if (!safeUrl(url)) throw new Error(t('board.errBlocked'));
  let res;
  // Sinal fraco: a conexão abre e nunca responde. 30 s e desiste, para nada ficar esperando para sempre.
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 30000);
  try { res = await fetch(url, { signal: ctl.signal }); } catch {
    clearTimeout(timer);
    throw new Error(t('board.errBlocked'));
  }
  if (!res.ok) throw new Error(t('board.errStatus', { code: res.status }));
  if (+res.headers.get('content-length') > MAX_FILE_BYTES) throw new Error(t('board.errTooBig'));
  const lfs = new URL(url).hostname === 'raw.githubusercontent.com' && res.headers.get('content-length') < 1024
    && (await res.clone().text()).startsWith('version https://git-lfs');
  // Arquivo no Git LFS: o raw só tem um ponteiro; o conteúdo está no media.githubusercontent.com.
  if (lfs) return fetchFile(kind, url.replace('https://raw.githubusercontent.com/', 'https://media.githubusercontent.com/media/'));
  const data = await res.arrayBuffer().catch(() => null).finally(() => clearTimeout(timer));
  if (!data) throw new Error(t('board.errBlocked'));
  if (data.byteLength > MAX_FILE_BYTES) throw new Error(t('board.errTooBig'));
  try { return await parseFile(kind, new Response(data)); } catch {
    throw new Error(t('board.errNotFile', { ext: kind === 'nam' ? '.nam' : '.wav' }));
  }
}

