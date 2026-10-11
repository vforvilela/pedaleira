# Pedaleira

Monte uma pedaleira de guitarra no navegador. Cada pedal é desenhado como o real e tem o som modelado nele.
Funciona no PC, no Android e no iPhone (é um PWA: pode ser instalado pela opção "Adicionar à tela inicial").

**Pedais da v1**

| Pedal | Inspirado no | Som |
|---|---|---|
| Afinador | Boss TU-3 | Cromático (YIN), MUTE ou THRU, Lá de 438 a 445 Hz |
| Sol Drive | Boss SD-1 | Circuito Web Audio, ou captura NAM (botão NAM) |
| Amp | — | Pré-amp simples, ou captura NAM; caixa interna ou IR `.wav` |
| Eco 8 | Boss DD-8 | Delay Web Audio, modos STD, ANLG e MOD, com trails |
| Salão | TC Electronic Hall of Fame 2 | Reverb por convolução, 5 salas, com trails |

**Para tocar ao vivo**

- **Presets por música:** escreva o nome, clique em Salvar. ◀ ▶ (ou `[` `]`) trocam de preset.
  Mudou algo e não salvou? O preset ganha `*` e a mudança fica guardada como rascunho: trocar de preset e voltar
  não perde nada. **Reverter** volta para a versão salva.
- **Exportar / Importar:** um arquivo `.json` com os presets e as capturas `.nam` e IRs que eles usam.
  Serve de backup e para levar os presets do PC para o celular.
- **Tap tempo** no Eco 8 (botão TAP ou tecla `T`), de 20 ms a 2 s.
- **Teclado como footswitch:** `1`–`9` ligam e desligam o pedal naquela posição (o número aparece em cima de cada pedal).
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
  compilada de `nam-wasm/` (Rust + SIMD). Suporta WaveNet A1 (standard, lite, feather, nano) e LSTM.
  Capturas A2 ainda não.
- Estado salvo no `localStorage`; arquivos `.nam` e IR no IndexedDB.

## Testes

```sh
# Unidade (afinador, MIDI): sem navegador
node --test tests/

# Compara o NAM em JS e em wasm com o render oficial do NeuralAmpModelerCore
node tests/nam-reference.mjs <caminho>/NeuralAmpModelerCore/build/tools/render tests/fixtures/wavenet_a1_standard.nam

# Teste de fumaça no Chrome headless com microfone falso (liga, carrega NAM, arrasta, screenshots)
node tests/browser-smoke.mjs /tmp/pedaleira-shots
```

Recompilar o wasm: `nam-wasm/build.sh` (requer `rustup target add wasm32-unknown-unknown`).

`tests/fixtures/wavenet_a1_standard.nam` é o modelo de exemplo do NeuralAmpModelerCore (licença MIT).
