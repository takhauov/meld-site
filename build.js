#!/usr/bin/env node
/**
 * Сборка сайта MELD.
 *
 * Запуск:  node build.js
 *
 * Что делает:
 *   1. берёт каркас src/layout.html (шапка, подвал, стили, скрипты);
 *   2. вставляет в него содержимое каждой страницы из src/pages/;
 *   3. кладёт готовые файлы в dist/ вместе с папкой assets;
 *   4. генерирует sitemap.xml и robots.txt.
 *
 * Правите шапку или подвал — только в src/layout.html, один раз.
 * Правите текст страницы — в нужном файле src/pages/.
 * Потом снова node build.js.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT   = __dirname;
const SRC    = path.join(ROOT, 'src');
const PAGES  = path.join(SRC, 'pages');
const DIST   = path.join(ROOT, 'docs');   // папка готового сайта (её отдаёт GitHub Pages)
const ASSETS = path.join(ROOT, 'assets');

const DOMAIN = 'https://meld-tools.ru';

// ---------- вспомогательное ----------
function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

// ---------- стили (Tailwind собирается заранее в один файл, без CDN) ----------
// tailwindcss.exe — отдельно скачанная программа-сборщик, лежит в корне проекта
// и в git не попадает (см. .gitignore). Она читает src/tailwind-input.css +
// tailwind.config.js и кладёт готовый CSS в assets/styles.css — дальше он
// копируется в docs/assets вместе с картинками обычным шагом ниже.
const TAILWIND_BIN = path.join(ROOT, 'tailwindcss.exe');
if (!fs.existsSync(TAILWIND_BIN)) {
  throw new Error(
    'Не найден tailwindcss.exe в корне проекта — без него стили не пересобрать.\n' +
    'Скачать: https://github.com/tailwindlabs/tailwindcss/releases/download/v3.4.16/tailwindcss-windows-x64.exe'
  );
}
execFileSync(TAILWIND_BIN, [
  '-i', path.join(SRC, 'tailwind-input.css'),
  '-o', path.join(ASSETS, 'styles.css'),
  '--minify',
], { cwd: ROOT, stdio: 'inherit' });

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    entry.isDirectory() ? copyDir(a, b) : fs.copyFileSync(a, b);
  }
}

/** Разбирает файл страницы: шапка с параметрами, потом --- , потом разметка. */
function parsePage(text) {
  const parts = text.split(/\n---\n/);
  if (parts.length < 2) {
    throw new Error('в файле страницы нет разделителя "---" после параметров');
  }
  const meta = {};
  for (const line of parts[0].split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  return { meta, content: parts.slice(1).join('\n---\n').trim() };
}

// ---------- сборка ----------
const layout = fs.readFileSync(path.join(SRC, 'layout.html'), 'utf8');
const files = fs.readdirSync(PAGES).filter((f) => f.endsWith('.html')).sort();

rmrf(DIST);
fs.mkdirSync(DIST, { recursive: true });

const built = [];

for (const file of files) {
  const { meta, content } = parsePage(fs.readFileSync(path.join(PAGES, file), 'utf8'));

  for (const key of ['title', 'description']) {
    if (!meta[key]) throw new Error(`${file}: не указан параметр ${key}`);
  }

  // FAQ-разметку и прочее из начала содержимого переносим в <head>
  let headExtra = '';
  let body = content;
  const ld = body.match(/^<script type="application\/ld\+json">[\s\S]*?<\/script>/);
  if (ld) {
    headExtra = ld[0];
    body = body.slice(ld[0].length).trimStart();
  }

  const html = layout
    .replaceAll('{{TITLE}}', meta.title)
    .replaceAll('{{DESCRIPTION}}', meta.description)
    .replaceAll('{{URL}}', meta.url || '')
    .replaceAll('{{HEAD_EXTRA}}', headExtra)
    .replaceAll('{{HOME}}', file === 'index.html' ? '' : 'index.html')
    .replaceAll('{{CONTENT}}', body);

  // На внутренних страницах ссылки шапки и подвала должны вести на главную:
  // #about существует только на index.html, поэтому превращаем его в index.html#about.
  let out = html;
  if (file !== 'index.html') {
    const localIds = new Set([...body.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]));
    out = out.replace(/href="#([\w-]+)"/g, (whole, id) => {
      if (id === 'main' || localIds.has(id)) return whole;      // якорь есть на этой же странице
      if (id === 'hero') return 'href="index.html"';            // логотип — на главную
      return `href="index.html#${id}"`;
    });
  }

  const left = out.match(/\{\{\w+\}\}/g);
  if (left) throw new Error(`${file}: остались незаполненные метки ${[...new Set(left)].join(', ')}`);

  fs.writeFileSync(path.join(DIST, file), out);
  built.push({ file, url: meta.url || '', kb: Math.round(Buffer.byteLength(out) / 1024) });
  console.log(`  ${file.padEnd(24)} ${String(built.at(-1).kb).padStart(4)} КБ`);
}

// ---------- версии для просмотра одним файлом ----------
// В dist картинки лежат отдельно — так правильно для хостинга.
// Но такой файл нельзя открыть в отрыве от папки assets.
// Поэтому дополнительно собираем preview/: те же страницы,
// но с картинками внутри файла. Двойной щелчок — и всё видно.
const PREVIEW = path.join(ROOT, 'preview');
rmrf(PREVIEW);
fs.mkdirSync(PREVIEW, { recursive: true });

const inlineCache = new Map();
function asDataUri(rel) {
  if (!inlineCache.has(rel)) {
    const file = path.join(ROOT, rel);
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
    inlineCache.set(rel, `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`);
  }
  return inlineCache.get(rel);
}

const stylesInline = fs.readFileSync(path.join(ASSETS, 'styles.css'), 'utf8');
for (const p of built) {
  let html = fs.readFileSync(path.join(DIST, p.file), 'utf8');
  // Стили тоже зашиваем прямо в файл — иначе двойной щелчок по preview
  // не найдёт assets/styles.css рядом и откроется без оформления.
  html = html.replace('<link rel="stylesheet" href="assets/styles.css">', `<style>${stylesInline}</style>`);
  html = html.replace(/(src|href)="(assets\/[^"]+)"/g, (m, attr, rel) => `${attr}="${asDataUri(rel)}"`);
  fs.writeFileSync(path.join(PREVIEW, p.file), html);
}
console.log(`\nПросмотр одним файлом: preview/ (${built.length} шт.)`);

// ---------- картинки ----------
if (fs.existsSync(ASSETS)) copyDir(ASSETS, path.join(DIST, 'assets'));

// ---------- sitemap и robots ----------
const today = new Date().toISOString().slice(0, 10);
const sitemap =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  built
    .map(
      (p) =>
        `  <url>\n    <loc>${DOMAIN}/${p.url}</loc>\n    <lastmod>${today}</lastmod>\n` +
        `    <priority>${p.url === '' ? '1.0' : '0.8'}</priority>\n  </url>`
    )
    .join('\n') +
  '\n</urlset>\n';
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap);

fs.writeFileSync(
  path.join(DIST, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${DOMAIN}/sitemap.xml\n`
);

console.log(`\nГотово: ${built.length} страниц в docs/`);
console.log('Локальный просмотр: откройте docs/index.html');
console.log('На хостинг: загрузите всё содержимое docs/');
