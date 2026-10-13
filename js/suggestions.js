// Arquivos grátis sugeridos nos botões NAM e IR do amp. Ficam no GitHub e são baixados por link: não vêm
// dentro do app, e vão junto no link de preset como qualquer arquivo por link.
import { t } from './i18n.js';

const NAM_REPO = 'https://raw.githubusercontent.com/muhammed-yeter/nam-profiles-colab/main/';
// Os .wav desse repositório estão no Git LFS: o link direto é o do media.githubusercontent.com.
const IR_REPO = 'https://media.githubusercontent.com/media/fnpngn/IR/master/Dauntless%20IRs/';

export const SUGGESTIONS = {
  // Capturas de rig completo (amp + caixa + microfone): ao carregar, a caixa do amp vai para OFF.
  nam: {
    get title() { return t('board.suggestNamTitle'); },
    get hint() { return t('board.suggestNamHint'); },
    cab: 'OFF',
    credit: { who: 'Muhammed Yeter', get license() { return t('board.licenseMit'); }, page: 'https://github.com/muhammed-yeter/nam-profiles-colab' },
    items: [
      { get name() { return t('board.suggestJcmClean'); }, get note() { return t('board.suggestJcmCleanNote'); },
        url: `${NAM_REPO}Marshall%20JCM800%20Clean/Marshall%20JCM800%20Clean%20G2%20-%20Marshall%201960AV%20SM57.nam` },
      { name: 'JCM800 + OD-1', get note() { return t('board.suggestJcmOdNote'); },
        url: `${NAM_REPO}Marshall%20JCM800%20Cranked/Marshall%20JCM800%20-%20Marshall%201960AV%20SM57%20-%20Boss%20OD1.nam` },
      { name: '5150', get note() { return t('board.suggest5150Note'); },
        url: `${NAM_REPO}Peavey%205150/Peavey%205150%20-%20Mesa%204x12%20SM57.nam` },
    ],
  },
  // Caixa 4x12 do pack Dauntless (gravada com um Engl Fireball): "free to share however you wish but is not for resale".
  ir: {
    get title() { return t('board.suggestIrTitle'); },
    get hint() { return t('board.suggestIrHint'); },
    cab: 'IR',
    credit: { get who() { return t('board.creditResington'); }, get license() { return t('board.licenseFreeShare'); }, page: 'https://www.youtube.com/watch?v=1GjnDMSXQTE' },
    items: [
      { name: 'Engl B906', get note() { return t('board.suggestB906Note'); }, url: `${IR_REPO}1%20Engl%20Fireball%20B906.wav` },
      { name: 'Engl SM48', get note() { return t('board.suggestSm48Note'); }, url: `${IR_REPO}5%20Engl%20Fireball%20SM48.wav` },
      { name: 'Dauntless X', get note() { return t('board.suggestDauntlessNote'); }, url: `${IR_REPO}Res%20Dauntless%20X.wav` },
    ],
  },
};
