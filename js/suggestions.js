// Capturas grátis sugeridas no botão NAM do amp. Ficam no GitHub do autor (licença MIT) e são baixadas
// por link: não vêm dentro do app, e vão junto no link de preset como qualquer captura por link.
// Todas são de rig completo (amp + caixa + microfone): ao carregar, a caixa do amp vai para OFF.
const REPO = 'https://raw.githubusercontent.com/muhammed-yeter/nam-profiles-colab/main/';

export const CAPTURE_CREDIT = {
  who: 'Muhammed Yeter', license: 'MIT', page: 'https://github.com/muhammed-yeter/nam-profiles-colab',
};

export const AMP_CAPTURES = [
  { name: 'JCM800 limpo', note: 'Marshall JCM800, caixa 1960AV, SM57',
    url: `${REPO}Marshall%20JCM800%20Clean/Marshall%20JCM800%20Clean%20G2%20-%20Marshall%201960AV%20SM57.nam` },
  { name: 'JCM800 + OD-1', note: 'crunch: JCM800 com um Boss OD-1 na frente',
    url: `${REPO}Marshall%20JCM800%20Cranked/Marshall%20JCM800%20-%20Marshall%201960AV%20SM57%20-%20Boss%20OD1.nam` },
  { name: '5150', note: 'high gain: Peavey 5150, caixa Mesa 4x12, SM57',
    url: `${REPO}Peavey%205150/Peavey%205150%20-%20Mesa%204x12%20SM57.nam` },
];
