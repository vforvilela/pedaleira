#!/bin/sh
# Monta www/ com os arquivos do app (os mesmos que vão para o GitHub Pages em .github/workflows/pages.yml).
# O Capacitor empacota essa pasta dentro do app Android/iOS.
set -e
cd "$(dirname "$0")/.."
rm -rf www && mkdir www
cp -r manifest.webmanifest sw.js css js icons fonts www/
# A ponte do Capacitor entra na página como script embutido: a CSP do site o bloquearia. O app nativo vive sem ela.
# (sed sem -i: o -i do macOS exige sufixo e quebraria o job iOS.)
sed '/Content-Security-Policy/d' index.html > www/index.html
