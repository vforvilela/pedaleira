// Arquivos grátis sugeridos nos botões NAM e IR do amp. Ficam no GitHub e são baixados por link: não vêm
// dentro do app, e vão junto no link de preset como qualquer arquivo por link.
const NAM_REPO = 'https://raw.githubusercontent.com/muhammed-yeter/nam-profiles-colab/main/';
// Os .wav desse repositório estão no Git LFS: o link direto é o do media.githubusercontent.com.
const IR_REPO = 'https://media.githubusercontent.com/media/fnpngn/IR/master/Dauntless%20IRs/';

export const SUGGESTIONS = {
  // Capturas de rig completo (amp + caixa + microfone): ao carregar, a caixa do amp vai para OFF.
  nam: {
    title: 'Capturas grátis',
    hint: 'Rig completo (amp, caixa e microfone): a caixa do amp vai para OFF.',
    cab: 'OFF',
    credit: { who: 'Muhammed Yeter', license: 'licença MIT', page: 'https://github.com/muhammed-yeter/nam-profiles-colab' },
    items: [
      { name: 'JCM800 limpo', note: 'Marshall JCM800, caixa 1960AV, SM57',
        url: `${NAM_REPO}Marshall%20JCM800%20Clean/Marshall%20JCM800%20Clean%20G2%20-%20Marshall%201960AV%20SM57.nam` },
      { name: 'JCM800 + OD-1', note: 'crunch: JCM800 com um Boss OD-1 na frente',
        url: `${NAM_REPO}Marshall%20JCM800%20Cranked/Marshall%20JCM800%20-%20Marshall%201960AV%20SM57%20-%20Boss%20OD1.nam` },
      { name: '5150', note: 'high gain: Peavey 5150, caixa Mesa 4x12, SM57',
        url: `${NAM_REPO}Peavey%205150/Peavey%205150%20-%20Mesa%204x12%20SM57.nam` },
    ],
  },
  // Caixa 4x12 do pack Dauntless (gravada com um Engl Fireball): "free to share however you wish but is not for resale".
  ir: {
    title: 'IRs grátis',
    hint: 'Caixa 4x12 com três microfones diferentes. O CAB do amp vai para IR.',
    cab: 'IR',
    credit: { who: 'Resington (pack Dauntless)', license: 'livre para compartilhar', page: 'https://www.youtube.com/watch?v=1GjnDMSXQTE' },
    items: [
      { name: 'Engl B906', note: 'microfone de fita: mais escuro e macio', url: `${IR_REPO}1%20Engl%20Fireball%20B906.wav` },
      { name: 'Engl SM48', note: 'dinâmico: médio, para base', url: `${IR_REPO}5%20Engl%20Fireball%20SM48.wav` },
      { name: 'Dauntless X', note: 'mistura do autor: mais brilho e ataque', url: `${IR_REPO}Res%20Dauntless%20X.wav` },
    ],
  },
};
