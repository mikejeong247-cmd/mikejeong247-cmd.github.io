// scripts/build-sprites.mjs — TopN 스프라이트 + SUPPORT_HINTS.json (PNG 전용, 404 제거)
// 사용 예: node scripts/build-sprites.mjs --data="CSV_URL" --n=500 --tile=72 --cols=40 --rows=13 --out=./sprites

import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import Papa from 'papaparse';
import sharp from 'sharp';

/* ===== CLI ===== */
const DATA_URL = process.argv.find(a => a.startsWith('--data='))?.split('=')[1] || '';
const OUT_DIR  = process.argv.find(a => a.startsWith('--out=')) ?.split('=')[1]  || './sprites';
const TOP_N    = parseInt(process.argv.find(a => a.startsWith('--n='))    ?.split('=')[1] || '500', 10);
const TILE     = parseInt(process.argv.find(a => a.startsWith('--tile=')) ?.split('=')[1] || '72', 10);
const COLS     = parseInt(process.argv.find(a => a.startsWith('--cols=')) ?.split('=')[1] || '40', 10);
const ROWS_PER_SHEET = parseInt(process.argv.find(a => a.startsWith('--rows=')) ?.split('=')[1] || '13', 10); // 40x13=520 per sheet

if (!DATA_URL) {
  console.error('[build-sprites] Missing --data=CSV_URL');
  process.exit(1);
}

/* ===== Providers ===== */
const CDN   = 'https://cdn.jsdelivr.net';
const TW_PNG = (seq) => `${CDN}/gh/twitter/twemoji@14/assets/72x72/${seq}.png`;
const OM_PNG = (seq) => `${CDN}/npm/openmoji@14.0.0/color/72x72/${seq.toUpperCase()}.png`;

/* ===== Utils ===== */
const ensureDir = async (d) => { try { await fs.mkdir(d, { recursive: true }); } catch {} };

/** 유니코드 코드포인트 문자열 정규화
 *  - "U+1F9D1 200D 1F4BB" -> "1f9d1-200d-1f4bb"
 *  - FE0F 제거
 *  - 비정상 입력이면 emoji 텍스트에서 codepoint 추출 시도
 */
const normSeq = (code, emoji = '') => {
  let s = (code || '').toLowerCase().trim()
    .replace(/^[a-z]+\s+/, '')   // "emoji " 같은 접두 제거
    .replace(/u\+/g, '')
    .replace(/[_\s]+/g, '-');
  if (!/^[0-9a-f]+(-[0-9a-f]+)*$/.test(s) || !s) {
    if (emoji) {
      const cps = [];
      for (const ch of emoji) cps.push(ch.codePointAt(0).toString(16));
      s = cps.join('-');
    } else {
      s = '';
    }
  }
  // FE0F(emoji variation selector) 제거
  return s.split('-').filter(p => p !== 'fe0f').join('-');
};

async function headOk(u) {
  try {
    const r = await fetch(u, { method: 'HEAD' });
    if (r.ok) return true;
    // 일부 CDN이 HEAD를 제한하는 경우를 대비한 가벼운 GET probing
    if (r.status === 405 || r.status === 501) {
      const g = await fetch(u, { method: 'GET', headers: { 'Range': 'bytes=0-0' } });
      return g.ok;
    }
    return false;
  } catch {
    return false;
  }
}

async function bestProvider(seq) {
  if (await headOk(TW_PNG(seq))) return 'twemoji';
  if (await headOk(OM_PNG(seq))) return 'openmoji';
  return null;
}

async function pngBuf(seq, provider) {
  const url = provider === 'twemoji' ? TW_PNG(seq) : OM_PNG(seq);
  const r = await fetch(url);
  if (!r.ok) return null;
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

/* ===== Main ===== */
async function main() {
  await ensureDir(OUT_DIR);

  // 1) CSV 로드 및 정규화
  const resp = await fetch(DATA_URL, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`Fetch CSV failed: ${resp.status}`);
  const csv = await resp.text();

  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
  const rows = parsed.data.map(r => {
    const o = {};
    for (const k in r) o[String(k || '').trim().toLowerCase()] = r[k];
    return o;
  });

  // 2) 전 코드에 대해 지원목록(SUPPORT_HINTS) 생성 → 404 왕복 제거
  const allSeqs = [...new Set(rows.map(r => normSeq(r.code, r.emoji)).filter(Boolean))];
  const support = { twemoji: [], openmoji: [] };

  let idx = 0, inFlight = 0;
  const limit = 16; // 병렬 프로빙 제한

  await new Promise(resolve => {
    const kick = () => {
      while (inFlight < limit && idx < allSeqs.length) {
        const seq = allSeqs[idx++]; inFlight++;
        (async () => {
          const p = await bestProvider(seq);
          if (p === 'twemoji') support.twemoji.push(seq);
          else if (p === 'openmoji') support.openmoji.push(seq);
        })().finally(() => {
          inFlight--;
          if (idx >= allSeqs.length && inFlight === 0) resolve();
          else kick();
        });
      }
    };
    kick();
  });

  await fs.writeFile(path.join(OUT_DIR, 'SUPPORT_HINTS.json'), JSON.stringify(support, null, 2));

  // 3) TopN 후보 풀 구성 (CSV 순서 기준)
  const pool = [];
  for (const r of rows) {
    const seq = normSeq(r.code, r.emoji);
    if (!seq) continue;
    const inTw = support.twemoji.includes(seq);
    const inOm = support.openmoji.includes(seq);
    if (inTw || inOm) pool.push({ seq, provider: inTw ? 'twemoji' : 'openmoji' });
    if (pool.length >= TOP_N) break;
  }
  if (!pool.length) throw new Error('No candidates for sprite.');

  // 4) 타일 PNG 준비 (리사이즈 포함)
  const items = [];
  idx = 0; inFlight = 0;
  await new Promise(resolve => {
    const kick = () => {
      while (inFlight < 12 && idx < pool.length) {
        const cur = pool[idx++]; inFlight++;
        (async () => {
          const buf = await pngBuf(cur.seq, cur.provider);
          if (buf) {
            const png = await sharp(buf)
              .resize(TILE, TILE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
              .png({ quality: 90 })
              .toBuffer();
            items.push({ key: cur.seq, png });
          }
        })().finally(() => {
          inFlight--;
          if (idx >= pool.length && inFlight === 0) resolve();
          else kick();
        });
      }
    };
    kick();
  });

  // 5) 스프라이트 합성 (WebP 1~N장) + SPRITE_MAP.json 생성
  items.sort((a, b) => a.key.localeCompare(b.key));
  const map = {};
  let sheetIdx = 1, pos = 0;

  while (pos < items.length) {
    const slice = items.slice(pos, pos + COLS * ROWS_PER_SHEET);
    const rowsCnt = Math.ceil(slice.length / COLS);
    const width = COLS * TILE;
    const height = rowsCnt * TILE;

    const composites = [];
    slice.forEach((it, i) => {
      const x = (i % COLS) * TILE;
      const y = Math.floor(i / COLS) * TILE;
      composites.push({ input: it.png, left: x, top: y });
      map[it.key] = { sheet: `emoji-top${TOP_N}-${sheetIdx}.webp`, x, y, w: TILE, h: TILE };
    });

    const outPath = path.join(OUT_DIR, `emoji-top${TOP_N}-${sheetIdx}.webp`);
    await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(composites)
      .webp({ quality: 82 })
      .toFile(outPath);

    sheetIdx++;
    pos += slice.length;
  }

  await fs.writeFile(path.join(OUT_DIR, 'SPRITE_MAP.json'), JSON.stringify(map, null, 2));
  console.log(`[build-sprites] DONE. sheets=${sheetIdx - 1}, tiles=${items.length}, topN=${TOP_N}`);
}

/* ===== run ===== */
main().catch(e => {
  console.error(e);
  process.exit(1);
});
