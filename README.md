# ToneSmith

**Português** · [English](README.en.md)

Sua pedaleira de guitarra no navegador. Cada pedal é desenhado como o real e tem o som modelado nele.
Funciona no PC, no Android e no iPhone (é um PWA: pode ser instalado pela opção "Adicionar à tela inicial").

**Pedais** (22, na ordem em que costumam ficar na pedaleira)

| Pedal | Inspirado no | Som |
|---|---|---|
| Afinador | Boss TU-3 | Cromático (YIN), MUTE ou THRU, Lá de 438 a 445 Hz |
| Uá | Dunlop Cry Baby | Wah: arraste o pedal ou use um pedal de expressão MIDI. Modo AUTO: auto-wah pela palhetada |
| Baleia | DigiTech Whammy | Pitch shifter no pedal: ±1 e ±2 oitavas, quinta, quarta, DETUNE |
| Oitava | Boss OC-2 | Uma e duas oitavas abaixo (notas soltas) |
| Aperto | Boss CS-3 | Compressor sem atraso, LEVEL, TONE, ATTACK, SUSTAIN |
| Turbo | Xotic EP Booster | Boost até +20 dB, BRIGHT |
| Sol Drive | Boss SD-1 | Circuito Web Audio, ou captura NAM (botão NAM) |
| Ratazana | ProCo RAT | Distorção: amp-op com ganho alto, diodos para o terra, FILTER que escurece |
| Marimbondo | Dunlop Fuzz Face | Fuzz de clipagem assimétrica. Limpa quando você baixa o volume da guitarra, como o original |
| Abafa | Electro-Harmonix Big Muff Pi | Fuzz de sustentação: dois estágios de clipagem, TONE com buraco nos médios |
| Silêncio | Boss NS-2 | Noise gate com histerese, THRES e DECAY |
| Amp | — | 2 estágios de pré, BASS/MID/TREBLE, power amp; ou captura NAM. Caixa 1x12, 4x12, IR `.wav` ou nenhuma |
| Equalizador | Boss GE-7 | 7 faixas de ±15 dB e volume, em faders |
| Coro | Boss CE-2 | Chorus estéreo |
| Flange | Boss BF-2 | Flanger com MANUAL, DEPTH, RATE e RES |
| Fase 90 | MXR Phase 90 | Phaser de 4 estágios, um botão |
| Ondas | Boss TR-2 | Tremolo, de triângulo a quadrada |
| Volume | Ernie Ball VP Jr | Pedal de volume com curva de áudio e mínimo ajustável |
| Eco 8 | Boss DD-8 | Delay, modos STD, ANLG, MOD e P.PONG (estéreo), com trails. SYNC prende o tempo ao andamento (1/4, 1/8., 1/8, 1/8T, 1/16) |
| Salão | TC Electronic Hall of Fame 2 | Reverb estéreo por convolução, 5 salas, pré-delay, com trails |
| Pulso | Boss DB-90 | Metrônomo: BPM com TAP, compasso com acento, volume. Clique no fone, fora dos efeitos |
| Laço | TC Electronic Ditto | Looper de até 2 min: grava, toca, sobrepõe, desfaz a última camada; 2 pisadas param. SYNC fecha o loop em batidas do andamento |

**Para tocar ao vivo**

- **EQ geral** (Graves, Médios, Agudos, ±6 dB, na faixa Entrada): acerta a saída à sala ou ao fone; vale para todos os presets.
- **Nível do preset** (slider Preset, na faixa Entrada): −12 a +12 dB no fim da cadeia, salvo com o preset, para os
  presets do setlist soarem no mesmo volume.
- **Modo simples** na primeira visita: sem cenas, Link, Exportar, Importar, Organizar, MIDI e afins. **Mostrar tudo** (no ⋯)
  traz tudo de volta; **Modo simples** esconde de novo.
- **Presets de fábrica** para começar: Limpo com chorus, Crunch (cena A base, B solo com boost e delay), Solo com
  delay, Fuzz anos 60, Distorção anos 80, Parede de fuzz e Ambiente, todos com o amp interno e volumes parecidos.
  Mais dois com captura NAM de amp de verdade: Crunch JCM800 e Metal 5150 (a captura é baixada do GitHub na
  primeira vez que o preset toca; ver "Capturas e IRs grátis"). Quem já usava o app ganha os que não tem.

- **Presets por música:** escreva o nome, clique em Salvar. ◀ ▶ (ou `[` `]`) trocam de preset.
  Mudou algo e não salvou? O preset ganha `*` e a mudança fica guardada como rascunho: trocar de preset e voltar
  não perde nada. **Reverter** volta para a versão salva.
- **Setlists** (botão Organizar): ordem dos presets para ◀ ▶, footswitch e Program Change; renomear e apagar
  (com Desfazer). Vários setlists ("Sexta", "Casamento") com os mesmos presets em ordens diferentes; um Program
  Change fixo por preset vence a posição, para reordenar sem reprogramar o controlador.
- **Link**: copia um link com a pedaleira atual (pedais, botões, cenas). Quem abre recebe como preset novo.
  Capturas e IRs carregados por link direto (GitHub, Dropbox) vão junto e são baixados por quem abre.
- **Capturas e IRs grátis no Amp**: o botão NAM sugere três capturas de rig completo (JCM800 limpo, JCM800 + OD-1, 5150),
  de [Muhammed Yeter](https://github.com/muhammed-yeter/nam-profiles-colab) (licença MIT). Baixadas do GitHub do autor.
  O botão IR sugere três IRs de caixa 4x12 do pack Dauntless, de Resington ("free to share"); ao escolher uma, o CAB vai
  para IR. Carregar qualquer IR também liga o CAB em IR. Links do GitHub para arquivos no Git LFS funcionam.
  Capturas `.nam` e IRs não cabem no link: para elas, use Exportar.
- **Exportar / Importar:** um arquivo `.json` com os presets e as capturas `.nam` e IRs que eles usam.
  Serve de backup e para levar os presets do PC para o celular.
- **Modo palco** (botão Palco): preset em letras grandes, tap tempo e nível do preset, cenas A–D enormes, um botão por pedal e a nota do
  afinador. A tela fica acesa enquanto o áudio estiver ligado.
- **Cenas A–D** dentro do preset: cada uma liga e desliga vários pedais e muda a posição dos botões de uma vez
  (ex.: A = base, B = solo com mais volume e delay).
  Ligue os pedais, clique em **Gravar cena** e depois na letra. Atalhos `A`–`D`; também por MIDI.
  Trocar de cena não marca o preset com `*`.
- **Spillover**: ao trocar de preset, o delay e o reverb que saem continuam soando até a cauda acabar (até 8 s).
- **Desfazer**: removeu um pedal sem querer? Clique em Desfazer (ou `Ctrl+Z`) em até 10 s.
- **Canal da interface**: em interfaces de 2 entradas, o app descobre na primeira palhetada em qual a guitarra
  está e usa só ela (sem perder 6 dB nem somar o chiado da outra). Dá para fixar Canal 1 ou 2.
- **Ganho de entrada** para acertar o nível da interface (o medidor não deve ficar vermelho).
- **Gravar**: com o áudio ligado, grava o que sai da pedaleira (com todos os efeitos) e baixa o arquivo ao parar
  (`.webm` no Chrome, `.m4a` no Safari).
- **Medir latência real**: com o áudio ligado, botão Medir ao lado da latência. Ligue um cabo da saída da
  interface na entrada; o app toca 6 cliques e mede quanto tempo eles levam para voltar.
- **Andamento da música** (♩ ao lado dos presets, tecla `T`, ou um footswitch MIDI): o Pulso e o Eco 8 em SYNC seguem o
  mesmo BPM, que fica salvo com o preset. O TAP do Eco 8 continua acertando o D.TIME (20 ms a 2 s) e o do Pulso o BPM.
- **Teclado como footswitch:** `1`–`9` ligam e desligam o pedal naquela posição (o número aparece em cima de cada pedal).
- **Afinador geral** (tecla `U`, botão Afinar no palco, ou um footswitch MIDI): cala a saída e mostra a nota em qualquer
  preset, sem precisar de um Afinador na cadeia.
- **Footswitch Bluetooth de virar página** (funciona no iPhone): setas e PageUp/PageDown trocam de preset.
- **Controlador MIDI** (Chrome/Edge, não no iPhone): botão MIDI → toque no alvo (pedal, TAP, botão, ◀ ▶) →
  pise no controlador. Program Change N escolhe o preset N+1 sem configurar nada. Funciona com footswitch
  momentâneo e com o de trava (latching), sem configurar. Um mapeamento de pedal vale em todos os presets: se o
  preset não tem aquele pedal, vale o primeiro do mesmo tipo. O pedal de expressão no Uá liga o wah ao sair do
  calcanhar e desliga parado no calcanhar.

## Rodar

```sh
systemctl --user stop tankmini-loopback   # senão o som limpo do loopback toca junto
python3 -m http.server 8000 -d ~/Code/pedaleira
# abrir http://localhost:8000 no Chrome, Ligar, escolher o Tank Mini
systemctl --user start tankmini-loopback  # ao terminar
```

No celular, o navegador só libera a entrada de áudio em HTTPS. Para testar fora do PC, o app precisa estar
publicado (ex.: Vercel). No iPhone e no Android é preciso uma interface de áudio USB.

## Apps Android e iOS

Os mesmos arquivos do site, empacotados com o [Capacitor](https://capacitorjs.com) num WebView. O que muda em
relação ao PWA: entra na loja, **MIDI funciona no iPhone e no Android** (plugin nativo, porque os WebViews não têm
Web MIDI), exportar e gravar abrem a folha de compartilhar (Arquivos, Drive…), e no iPhone o app pede ao sistema
a sessão de áudio com buffer curto. O som continua sendo o Web Audio; só `js/platform.js` conhece o Capacitor.

```sh
npm ci
npm run android   # monta www/, sincroniza e abre o Android Studio
npm run ios       # idem, Xcode (só no macOS)
```

**Android sem loja:** baixe o `.apk` da [página de releases](https://github.com/vforvilela/pedaleira/releases) no
celular e abra (o Android avisa que veio de fora da loja; é o build de debug).

Cada tag `v*` (ou um clique em "Apps Android e iOS" nas Actions) gera o APK de teste e o AAB da Play Store,
anexa o APK à release e confere que o projeto iOS compila (`.github/workflows/native.yml`). Publicar
nas lojas é com as contas do dono (Play Console e Apple Developer).

**Assinatura do Android.** Com quatro secrets no repositório o CI assina o AAB e o APK de release com a chave de upload
(sem eles, o AAB sai sem assinatura e o APK anexado à release é o de debug):

```sh
keytool -genkeypair -keystore upload.keystore -storetype PKCS12 -alias tonesmith-upload -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 upload.keystore | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEYSTORE_PASSWORD   # a senha do keystore
gh secret set ANDROID_KEY_ALIAS --body tonesmith-upload
gh secret set ANDROID_KEY_PASSWORD        # a mesma senha (PKCS12)
```

Guarde o `upload.keystore` fora do repositório. Com o Play App Signing ligado, a Play Console aceita trocar a chave de
upload se ela se perder. Local: `ANDROID_KEYSTORE_FILE=… ANDROID_KEYSTORE_PASSWORD=… ANDROID_KEY_ALIAS=… ANDROID_KEY_PASSWORD=… npm run android`. No app, o botão Voltar do Android fecha
gavetas e o palco; sem nada aberto, manda o app para o fundo sem desligar o som.

- `android/` e `ios/`: projetos nativos. Plugins locais: `MidiPlugin` (Android e iOS) e `AudioSessionPlugin` (iOS).
- **Footswitch Bluetooth MIDI** (ex.: M-VAVE Chocolate) no app: clique em MIDI. No Android o app pede a permissão de
  Bluetooth e acha o footswitch sozinho; no iPhone abre o painel de parear do sistema na primeira vez.
- `assets/`: ícone e splash de 1024 px; `npx capacitor-assets generate` refaz os ícones nativos.
- `store/listing.md`: textos para as lojas em três idiomas; `privacy.html`: política de privacidade
  (publicada em https://vforvilela.github.io/pedaleira/privacy.html, que a Play Store exige para apps com microfone).
- No Android, com o som ligado o app mantém uma notificação (serviço em primeiro plano): sem ela o sistema corta a
  entrada da guitarra ao trocar de app ou apagar a tela.

## Como funciona

- `js/pedals/*.js`: um arquivo por pedal, com visual (`look`), controles e o circuito de áudio (`create`).
- `js/ui/pedal-view.js`: desenha os pedais em SVG e trata botões, footswitch e arrastar.
- `js/nam/`: capturas NAM. `nam-core.js` é a versão em JS (reserva e referência) e `nam.wasm` é a rápida,
  compilada de `nam-wasm/` (Rust + SIMD). Suporta WaveNet A1 (standard, lite, feather, nano), WaveNet A2
  (bottleneck, layer1x1/head1x1, convs em grupo, FiLM, gating/blending, kernel por camada, cabeça com kernel,
  cabeça pós-pilha, condition DSP), LSTM e `SlimmableContainer`/WaveNet slimmable (usa o tamanho completo).
- `js/audio/dynamics.js`: gate, compressor e limitador de saída, sem lookahead (o `DynamicsCompressorNode`
  do navegador atrasaria todo o som em 6 ms). Rodam no AudioWorklet `dsp-worklet.js`.
- Estado salvo no `localStorage`; arquivos `.nam` e IR no IndexedDB.

## Testes

```sh
# Lint (variável inexistente, código morto) e unidade (afinador, MIDI, gate, compressor, limitador, cadeia, migração)
npm run lint && node --test

# Mudou js/, css/ ou index.html? Sobe a versão do cache do service worker (o teste cobra)
npm run sw

# Compara o NAM em JS e em wasm com o render oficial do NeuralAmpModelerCore
node tests/nam-reference.mjs <caminho>/NeuralAmpModelerCore/build/tools/render tests/fixtures/*.nam

# Teste de fumaça no Chrome headless com microfone falso (liga, carrega NAM, arrasta, screenshots)
node tests/browser-smoke.mjs /tmp/pedaleira-shots
```

Recompilar o wasm: `nam-wasm/build.sh` (requer `rustup target add wasm32-unknown-unknown`).

`tests/fixtures/` tem modelos de exemplo do NeuralAmpModelerCore (licença MIT): `wavenet_a1_standard.nam` (A1),
`A2.nam` (A2 real, num `SlimmableContainer`) e `wavenet_a2_feature_test.nam` (todos os recursos A2 juntos).
