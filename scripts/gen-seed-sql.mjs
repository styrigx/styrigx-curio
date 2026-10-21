#!/usr/bin/env node
/**
 * 初始收藏：data/seed.json → workers/core/migrations/0002_seed.sql（只增不删，D1 迁移只跑一次）。
 * 种子来自 styrigx-space 主站的书签（web/data/links.yaml + en/links.yaml，2026-10-21 迁出），之后以 D1 为准。
 * 分类、收藏都是公开的；分类 id 用 1..N，收藏 id 交给自增。
 *
 * 用法：node scripts/gen-seed-sql.mjs          重新生成
 *       node scripts/gen-seed-sql.mjs --check  只核对（不一致 exit 1，CI 用）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = path.join(REPO, 'data/seed.json');
const OUT = path.join(REPO, 'workers/core/migrations/0002_seed.sql');
/** 种子时间固定（2026-10-21 00:00 UTC+8），重新生成结果不变 */
const T = Date.UTC(2026, 9, 20, 16, 0, 0);

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

export function loadSeed() {
  return JSON.parse(readFileSync(SEED, 'utf8')).cats;
}

export function render(cats) {
  const out = [
    '-- 由 scripts/gen-seed-sql.mjs 从 data/seed.json 生成，不要手改。',
    '-- 初始收藏：迁自 styrigx-space 主站书签（2026-10-21）。只在空库里写（分类 id 已存在就跳过整条）。',
  ];
  cats.forEach((c, i) => {
    const id = i + 1;
    out.push(`INSERT OR IGNORE INTO cats (id, name_zh, name_en, private, pos, created_at) VALUES (${id}, ${q(c.name.zh)}, ${q(c.name.en)}, 0, ${i}, ${T});`);
  });
  cats.forEach((c, i) => {
    const id = i + 1;
    c.links.forEach((l, j) => {
      const url = new URL(l.url).href; /* 和接口的 cleanUrl 同一种写法（裸域名补 /），导入去重才对得上 */
      out.push(
        `INSERT INTO links (cat_id, url, name_zh, name_en, desc_zh, desc_en, icon, private, pos, created_at, updated_at) SELECT ${id}, ${q(url)}, ${q(l.name.zh)}, ${q(l.name.en)}, ${q(l.desc.zh)}, ${q(l.desc.en)}, '', 0, ${j}, ${T}, ${T} WHERE NOT EXISTS (SELECT 1 FROM links WHERE url = ${q(url)});`
      );
    });
  });
  return out.join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = render(loadSeed());
  if (process.argv.includes('--check')) {
    let cur = '';
    try { cur = readFileSync(OUT, 'utf8'); } catch (e) { /* 没有就算不一致 */ }
    if (cur !== text) { console.error('0002_seed.sql 和 data/seed.json 不一致：跑 node scripts/gen-seed-sql.mjs'); process.exit(1); }
    console.log('seed OK');
  } else {
    writeFileSync(OUT, text);
    console.log('wrote ' + path.relative(REPO, OUT));
  }
}
