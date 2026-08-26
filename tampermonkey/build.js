// Remonta os módulos separados em src/ num único arquivo pro Tampermonkey.
// Uso: node build.js
//
// Por que isso é seguro: cada módulo (alerta-venda, compras, checkout,
// random) já é uma função independente e autocontida (initXModule()),
// chamada por nome dentro de header.js. Como são "function declarations"
// (não const/arrow), o JavaScript as "hoisteia" automaticamente — não
// importa em que ordem os arquivos aparecem no bundle final, todas ficam
// visíveis em todo o escopo antes mesmo de serem lidas.
//
// canva_sync foi descontinuado (2026-07-24, projeto Supabase que ele
// dependia foi excluído) — não faz mais parte do bundle.

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');
const OUT_FILE = path.join(__dirname, 'kryzer-agent.user.js');

const parts = [
  path.join(SRC_DIR, 'header.js'),
  path.join(SRC_DIR, 'modules', 'alerta-venda.js'),
  path.join(SRC_DIR, 'modules', 'compras.js'),
  path.join(SRC_DIR, 'modules', 'checkout.js'),
  path.join(SRC_DIR, 'modules', 'random.js'),
  path.join(SRC_DIR, 'footer.js'),
];

const content = parts.map(p => fs.readFileSync(p, 'utf-8').replace(/\s+$/, '')).join('\n\n') + '\n';
fs.writeFileSync(OUT_FILE, content);

console.log(`Bundle gerado: ${OUT_FILE} (${content.length} bytes)`);
