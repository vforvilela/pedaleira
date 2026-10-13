# ToneSmith

[Português](README.md) · **English**

Your guitar pedalboard in the browser. Each pedal is drawn like the real one and has its sound modeled on it.
Runs on desktop, Android and iPhone. It is a PWA: install it with "Add to Home Screen".

**Try it:** https://vforvilela.github.io/pedaleira/

The app is in Portuguese, English and Spanish. It picks the browser's language; change it under **Language**.
Pedal names stay in Portuguese in every language. The table gives each one's meaning in English.

**Pedals** (22, in the order they usually sit on a board)

| Pedal | Meaning | Inspired by | Sound |
|---|---|---|---|
| Afinador | Tuner | Boss TU-3 | Chromatic (YIN), MUTE or THRU, A from 438 to 445 Hz |
| Uá | Wah | Dunlop Cry Baby | Wah: drag the pedal or use a MIDI expression pedal. AUTO mode: auto-wah driven by your picking |
| Baleia | Whale | DigiTech Whammy | Pitch shifter on the pedal: ±1 and ±2 octaves, fifth, fourth, DETUNE |
| Oitava | Octave | Boss OC-2 | One and two octaves down (single notes) |
| Aperto | Squeeze | Boss CS-3 | Compressor with no added delay, LEVEL, TONE, ATTACK, SUSTAIN |
| Turbo | Turbo | Xotic EP Booster | Boost up to +20 dB, BRIGHT |
| Sol Drive | Sun Drive | Boss SD-1 | Web Audio circuit, or a NAM capture (NAM button) |
| Ratazana | Big Rat | ProCo RAT | Distortion: high-gain op-amp, diodes to ground, FILTER that darkens |
| Marimbondo | Hornet | Dunlop Fuzz Face | Asymmetric clipping fuzz. Cleans up when you roll back the guitar volume, like the original |
| Abafa | Muffle | Electro-Harmonix Big Muff Pi | Sustaining fuzz: two clipping stages, TONE with a mid scoop |
| Silêncio | Silence | Boss NS-2 | Noise gate with hysteresis, THRES and DECAY |
| Amp | Amp | — | 2 preamp stages, BASS/MID/TREBLE, power amp; or a NAM capture. 1x12 or 4x12 cab, `.wav` IR, or none |
| Equalizador | Equalizer | Boss GE-7 | 7 bands of ±15 dB plus volume, on faders |
| Coro | Chorus | Boss CE-2 | Stereo chorus |
| Flange | Flanger | Boss BF-2 | Flanger with MANUAL, DEPTH, RATE and RES |
| Fase 90 | Phase 90 | MXR Phase 90 | 4-stage phaser, one knob |
| Ondas | Waves | Boss TR-2 | Tremolo, from triangle to square |
| Volume | Volume | Ernie Ball VP Jr | Volume pedal with audio taper and adjustable minimum |
| Eco 8 | Echo 8 | Boss DD-8 | Delay, STD, ANLG, MOD and P.PONG (stereo) modes, with trails |
| Salão | Hall | TC Electronic Hall of Fame 2 | Stereo convolution reverb, 5 rooms, with trails |
| Pulso | Pulse | Boss DB-90 | Metronome: BPM with TAP, time signature with accent, volume. Click goes to the headphones, outside the effects |
| Laço | Loop | TC Electronic Ditto | Looper up to 2 min: record, play, overdub; step twice to stop |

**For playing live**

- **Factory presets** to start from: clean with chorus, crunch (scene A rhythm, B solo with boost and delay), solo
  with delay, 60s fuzz, 80s distortion, wall of fuzz, and ambient. All use the built-in amp at similar volumes.
  Existing users get the ones they don't have yet.
- **Presets per song:** type a name, click **Save**. ◀ ▶ (or `[` `]`) switch presets.
  Changed something without saving? The preset gets a `*` and the change is kept as a draft: switching presets and
  coming back loses nothing. **Revert** goes back to the saved version.
- **Setlist** (**Setlist** button): preset order for ◀ ▶, footswitch and Program Change; rename and delete
  (with Undo).
- **Link**: copies a link with the current board (pedals, knobs, scenes). Whoever opens it gets it as a new preset.
  Captures and IRs loaded from a direct link (GitHub, Dropbox) go along and are downloaded by whoever opens it.
- **Free captures and IRs in the Amp**: the NAM button suggests three full-rig captures (JCM800 clean, JCM800 + OD-1,
  5150) by [Muhammed Yeter](https://github.com/muhammed-yeter/nam-profiles-colab) (MIT license), downloaded from the
  author's GitHub. The IR button suggests three 4x12 cab IRs from Resington's Dauntless pack ("free to share");
  picking one switches CAB to IR. Loading any IR also switches CAB to IR. GitHub links to files in Git LFS work.
  `.nam` captures and IRs don't fit in a link: use Export for them.
- **Export / Import:** a `.json` file with the presets plus the `.nam` captures and IRs they use.
  Works as a backup and to move presets from the PC to the phone.
- **Stage mode** (**Stage** button): preset in large type, huge A–D scenes, one button per pedal and the tuner
  note. The screen stays on while audio is on.
- **Scenes A–D** inside a preset: each one turns several pedals on and off and moves knobs at once
  (e.g. A = rhythm, B = solo with more volume and delay).
  Turn on the pedals, click **Store scene**, then the letter. Shortcuts `A`–`D`; also over MIDI.
  Switching scenes doesn't mark the preset with `*`.
- **Spillover**: when you switch presets, the outgoing delay and reverb keep ringing until the tail ends (up to 8 s).
- **Undo**: removed a pedal by mistake? Click Undo (or `Ctrl+Z`) within 10 s.
- **Interface channel**: on 2-input interfaces, the app finds which input the guitar is on at the first pick
  and uses only that one (no 6 dB loss, no hiss from the other input). You can pin Channel 1 or 2.
- **Input gain** to match the interface level (the meter should never go red).
- **Record audio**: with audio on, records what comes out of the board (with all effects) and downloads the file
  when you stop (`.webm` in Chrome, `.m4a` in Safari).
- **Measure latency**: with audio on, click **Measure latency**. Connect a cable from the interface output to its
  input; the app plays 6 clicks and measures how long they take to come back.
- **Tap tempo** on Eco 8 (TAP button or `T` key), from 20 ms to 2 s.
- **Keyboard as footswitch:** `1`–`9` toggle the pedal in that position (the number shows above each pedal).
- **Bluetooth page-turner footswitch** (works on iPhone): arrows and PageUp/PageDown switch presets.
- **MIDI controller** (Chrome/Edge, not on iPhone): MIDI button → tap the target (pedal, TAP, knob, ◀ ▶) →
  step on the controller. Program Change N picks preset N+1 with no setup. Works with momentary and latching
  footswitches, no setup.

## Platforms

| Platform | How to install | Notes |
|---|---|---|
| Windows / macOS / Linux | Chrome or Edge → install app (icon in the address bar) | Full feature set, including MIDI |
| Android | Chrome → "Add to Home screen" | Needs a USB audio interface. Latency varies a lot between phones |
| iPhone / iPad | Safari → Share → "Add to Home Screen" | Needs a USB audio interface. No Web MIDI; Bluetooth page-turners work |

After the first load the app works offline.

## Running locally

```sh
python3 -m http.server 8000 -d ~/Code/pedaleira
# open http://localhost:8000 in Chrome, click Turn on, pick your audio interface
```

On phones, browsers only allow audio input over HTTPS. To test away from the PC, the app has to be published.
Every push to `main` runs the tests and publishes to GitHub Pages (`.github/workflows/pages.yml`).

## Android and iOS apps

The same files as the site, packaged with [Capacitor](https://capacitorjs.com) in a WebView. What changes compared
to the PWA: store listing, **MIDI works on iPhone and Android** (native plugin, since WebViews have no Web MIDI),
export and recording open the share sheet (Files, Drive…), and on iPhone the app asks the system for a short audio
buffer. The sound is still Web Audio; only `js/platform.js` knows about Capacitor.

```sh
npm ci
npm run android   # builds www/, syncs and opens Android Studio
npm run ios       # same, Xcode (macOS only)
```

Each `v*` tag (or a click on "Apps Android e iOS" under Actions) builds a test APK and the Play Store AAB, and
checks that the iOS project compiles (`.github/workflows/native.yml`). Signing and publishing need the owner's
Play Console and Apple Developer accounts.

- `android/` and `ios/`: native projects. Local plugins: `MidiPlugin` (Android and iOS) and `AudioSessionPlugin` (iOS).
- `assets/`: 1024 px icon and splash; `npx capacitor-assets generate` regenerates the native icons.

## How it works

- `js/pedals/*.js`: one file per pedal, with its look (`look`), controls and audio circuit (`create`).
- `js/ui/pedal-view.js`: draws the pedals in SVG and handles knobs, footswitch and dragging.
- `js/nam/`: NAM captures. `nam-core.js` is the JS version (fallback and reference) and `nam.wasm` is the fast one,
  compiled from `nam-wasm/` (Rust + SIMD). Supports WaveNet A1 (standard, lite, feather, nano), WaveNet A2
  (bottleneck, layer1x1/head1x1, grouped convs, FiLM, gating/blending, per-layer kernel, head with kernel,
  post-stack head, condition DSP), LSTM and `SlimmableContainer`/slimmable WaveNet (uses the full size).
- `js/audio/dynamics.js`: gate, compressor and output limiter, with no lookahead (the browser's
  `DynamicsCompressorNode` would delay all sound by 6 ms). They run in the `dsp-worklet.js` AudioWorklet.
- `js/i18n/`: UI text in Portuguese, English and Spanish.
- State is saved in `localStorage`; `.nam` and IR files in IndexedDB.

## Tests

```sh
# Unit (tuner, MIDI, gate, compressor, limiter, i18n): no browser
node --test

# Compares the JS and wasm NAM against the official NeuralAmpModelerCore render
node tests/nam-reference.mjs <path>/NeuralAmpModelerCore/build/tools/render tests/fixtures/*.nam

# Smoke test in headless Chrome with a fake microphone (turns on, loads NAM, drags, screenshots)
node tests/browser-smoke.mjs /tmp/pedaleira-shots

# Tablet E2E (touch, no scrolling, + Pedal, startup guard)
node tests/e2e-tablet.mjs /tmp/pedaleira-shots-tablet

# Offline and weak signal (opens from the cache)
node tests/offline.mjs
```

Rebuild the wasm: `nam-wasm/build.sh` (requires `rustup target add wasm32-unknown-unknown`).

`tests/fixtures/` has sample models from NeuralAmpModelerCore (MIT license): `wavenet_a1_standard.nam` (A1),
`A2.nam` (real A2, inside a `SlimmableContainer`) and `wavenet_a2_feature_test.nam` (all A2 features together).
