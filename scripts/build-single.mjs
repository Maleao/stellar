// Gera dist-single/estilingue-estelar.html: o build de produção em UM arquivo (CSS e JS embutidos).
// Uso: npm run build && node scripts/build-single.mjs [--fragment]
// --fragment remove <!doctype>/<html>/<head>/<body> (para hospedagens que injetam o próprio esqueleto).
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g, (_m, file) => {
  const css = fs.readFileSync(path.join(dist, file), 'utf8');
  return `<style>\n${css}\n</style>`;
});
html = html.replace(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/g, (_m, file) => {
  const js = fs.readFileSync(path.join(dist, file), 'utf8').replace(/\/\/# sourceMappingURL=.*$/m, '');
  return `<script type="module">\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`;
});
if (/assets\//.test(html.replace(/data:[^"']+/g, ''))) throw new Error('Restou referência a assets/ não embutida');

if (process.argv.includes('--fragment')) {
  html = html
    .replace(/<!doctype html>/i, '')
    .replace(/<\/?html[^>]*>/gi, '')
    .replace(/<\/?head>/gi, '')
    .replace(/<\/?body>/gi, '')
    .replace(/<meta charset="utf-8"\s*\/?>/i, '')
    .replace(/<meta name="viewport"[^>]*>/i, '');
  // <title> precisa estar no topo do fragmento
  const title = html.match(/<title>[\s\S]*?<\/title>/i)?.[0] ?? '';
  html = title + '\n' + html.replace(title, '').trim() + '\n';
}

fs.mkdirSync('dist-single', { recursive: true });
const out = path.join('dist-single', process.argv.includes('--fragment') ? 'estilingue-estelar.fragment.html' : 'estilingue-estelar.html');
fs.writeFileSync(out, html);
console.log(`${out} — ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB`);
