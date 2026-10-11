#!/bin/sh
# Gera js/nam/nam.wasm. Requer: rustup target add wasm32-unknown-unknown
set -e
cd "$(dirname "$0")"
cargo build --release
cp target/wasm32-unknown-unknown/release/nam_wasm.wasm ../js/nam/nam.wasm
ls -l ../js/nam/nam.wasm
