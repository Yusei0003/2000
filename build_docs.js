#!/usr/bin/env node
'use strict';
/**
 * docs/仕様書.md と docs/設計書.md を読み込み、docs-content.js へ文字列として埋め込む。
 * file:// では fetch() が使えないため、アプリ内表示（使い方タブ）はこの生成物を <script> で読み込む。
 * Markdownを編集したら、このスクリプトを再実行して docs-content.js を更新すること：
 *   node build_docs.js
 */
const fs = require('fs');
const path = require('path');

const specPath = path.join(__dirname, 'docs', '仕様書.md');
const designPath = path.join(__dirname, 'docs', '設計書.md');
const outPath = path.join(__dirname, 'docs-content.js');

const spec = fs.readFileSync(specPath, 'utf8');
const design = fs.readFileSync(designPath, 'utf8');

const header = `'use strict';
/* このファイルは自動生成物です。編集しないでください。
 * 原本は docs/仕様書.md / docs/設計書.md です。
 * Markdownを編集したら、次のコマンドで再生成してください： node build_docs.js
 */
`;

const out = header + `const SPEC_DOC_MD = ${JSON.stringify(spec)};
const DESIGN_DOC_MD = ${JSON.stringify(design)};
`;

fs.writeFileSync(outPath, out, 'utf8');
console.log(`docs-content.js を更新しました（仕様書 ${spec.length}文字 / 設計書 ${design.length}文字）`);
