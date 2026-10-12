# Brasa

Sua pedaleira de guitarra no navegador. Cada pedal é desenhado como o real e tem o som modelado nele.
Funciona no PC, no Android e no iPhone (é um PWA: pode ser instalado pela opção "Adicionar à tela inicial").

**Pedais** (19, na ordem em que costumam ficar na pedaleira)

| Pedal | Inspirado no | Som |
|---|---|---|
| Afinador | Boss TU-3 | Cromático (YIN), MUTE ou THRU, Lá de 438 a 445 Hz |
| Uá | Dunlop Cry Baby | Wah: arraste o pedal ou use um pedal de expressão MIDI. Modo AUTO: auto-wah pela palhetada |
| Baleia | DigiTech Whammy | Pitch shifter no pedal: ±1 e ±2 oitavas, quinta, quarta, DETUNE |
| Oitava | Boss OC-2 | Uma e duas oitavas abaixo (notas soltas) |
| Aperto | Boss CS-3 | Compressor sem atraso, LEVEL, TONE, ATTACK, SUSTAIN |
| Turbo | Xotic EP Booster | Boost até +20 dB, BRIGHT |
| Sol Drive | Boss SD-1 | Circuito Web Audio, ou captura NAM (botão NAM) |
| Marimbondo | Dunlop Fuzz Face | Fuzz de clipagem assimétrica. Limpa quando você baixa o volume da guitarra, como o original |
| Silêncio | Boss NS-2 | Noise gate com histerese, THRES e DECAY |
| Amp | — | 2 estágios de pré, BASS/MID/TREBLE, power amp; ou captura NAM. Caixa 1x12, 4x12, IR `.wav` ou nenhuma |
| Equalizador | Boss GE-7 | 7 faixas de ±15 dB e volume, em faders |
| Coro | Boss CE-2 | Chorus estéreo |
| Flange | Boss BF-2 | Flanger com MANUAL, DEPTH, RATE e RES |
| Fase 90 | MXR Phase 90 | Phaser de 4 estágios, um botão |
| Ondas | Boss TR-2 | Tremolo, de triângulo a quadrada |
| Volume | Ernie Ball VP Jr | Pedal de volume com curva de áudio e mínimo ajustável |
| Eco 8 | Boss DD-8 | Delay, modos STD, ANLG, MOD e P.PONG (estéreo), com trails |
| Salão | TC Electronic Hall of Fame 2 | Reverb estéreo por convolução, 5 salas, com trails |
| Laço | TC Electronic Ditto | Looper de até 2 min: grava, toca, sobrepõe; 2 pisadas param |

**Para tocar ao vivo**

- **Presets por música:** escreva o nome, clique em Salvar. ◀ ▶ (ou `[` `]`) trocam de preset.
  Mudou algo e não salvou? O preset ganha `*` e a mudança fica guardada como rascunho: trocar de preset e voltar
  não perde nada. **Reverter** volta para a versão salva.
- **Setlist** (botão Organizar): ordem dos presets para ◀ ▶, footswitch e Program Change; renomear e apagar
  (com Desfazer).
- **Link**: copia um link com a pedaleira atual (pedais, botões, cenas). Quem abre recebe como preset novo.
  Capturas `.nam` e IRs não cabem no link: para elas, use Exportar.
- **Exportar / Importar:** um arquivo `.json` com os presets e as capturas `.nam` e IRs que eles usam.
  Serve de backup e para levar os presets do PC para o celular.
- **Modo palco** (botão Palco): preset em letras grandes, cenas A–D enormes, um botão por pedal e a nota do
  afinador. A tela fica acesa enquanto o áudio estiver ligado.
- **Cenas A–D** dentro do preset: cada uma liga e desliga vários pedais e muda a posição dos botões de uma vez
  (ex.: A = base, B = solo com mais volume e delay).
  Ligue os pedais, clique em **Gravar cena** e depois na letra. Atalhos `A`–`D`; também por MIDI.
  Trocar de cena não marca o preset com `*`.
- **Spillover**: ao trocar de preset, o delay e o reverb que saem continuam soando até a cauda acabar (até 8 s).
- **Desfazer**: removeu um pedal sem querer? Clique em Desfazer (ou `Ctrl+Z`) em até 10 s.
- **Ganho de entrada** para acertar o nível da interface (o medidor não deve ficar vermelho).
- **Medir latência real**: com o áudio ligado, botão Medir ao lado da latência. Ligue um cabo da saída da
  interface na entrada; o app toca 6 cliques e mede quanto tempo eles levam para voltar.
- **Tap tempo** no Eco 8 (botão TAP ou tecla `T`), de 20 ms a 2 s.
- **Teclado como footswitch:** `1`–`9` ligam e desligam o pedal naquela posição (o número aparece em cima de cada pedal).
- **Footswitch Bluetooth de virar página** (funciona no iPhone): setas e PageUp/PageDown trocam de preset.
- **Controlador MIDI** (Chrome/Edge, não no iPhone): botão MIDI → toque no alvo (pedal, TAP, botão, ◀ ▶) →
  pise no controlador. Program Change N escolhe o preset N+1 sem configurar nada. Funciona com footswitch
  momentâneo e com o de trava (latching), sem configurar.

## Rodar

```sh
systemctl --user stop tankmini-loopback   # senão o som limpo do loopback toca junto
python3 -m http.server 8000 -d ~/Code/pedaleira
# abrir http://localhost:8000 no Chrome, Ligar, escolher o Tank Mini
systemctl --user start tankmini-loopback  # ao terminar
```

No celular, o navegador só libera a entrada de áudio em HTTPS. Para testar fora do PC, o app precisa estar
publicado (ex.: Vercel). No iPhone e no Android é preciso uma interface de áudio USB.

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
# Unidade (afinador, MIDI, gate, compressor, limitador): sem navegador
node --test

# Compara o NAM em JS e em wasm com o render oficial do NeuralAmpModelerCore
node tests/nam-reference.mjs <caminho>/NeuralAmpModelerCore/build/tools/render tests/fixtures/*.nam

# Teste de fumaça no Chrome headless com microfone falso (liga, carrega NAM, arrasta, screenshots)
node tests/browser-smoke.mjs /tmp/pedaleira-shots
```

Recompilar o wasm: `nam-wasm/build.sh` (requer `rustup target add wasm32-unknown-unknown`).

`tests/fixtures/` tem modelos de exemplo do NeuralAmpModelerCore (licença MIT): `wavenet_a1_standard.nam` (A1),
`A2.nam` (A2 real, num `SlimmableContainer`) e `wavenet_a2_feature_test.nam` (todos os recursos A2 juntos).
