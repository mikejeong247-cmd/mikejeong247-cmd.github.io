// scripts/build-sprites.mjs  — Top500 스프라이트 + SUPPORT_HINTS.json (PNG 전용, 404 제거)
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import Papa from 'papaparse';
import sharp from 'sharp';

const DATA_URL = process.argv.find(a=>a.startsWith('--data='))?.split('=')[1] || '';
const OUT_DIR  = process.argv.find(a=>a.startsWith('--out='))?.split('=')[1]  || './sprites';
const TOP_N    = parseInt(process.argv.find(a=>a.startsWith('--n='))?.split('=')[1] || '500',10);
const TILE     = parseInt(process.argv.find(a=>a.startsWith('--tile='))?.split('=')[1] || '72',10);
const COLS     = parseInt(process.argv.find(a=>a.startsWith('--cols='))?.split('=')[1] || '40',10);
const ROWS_PER_SHEET = parseInt(process.argv.find(a=>a.startsWith('--rows='))?.split('=')[1] || '13',10); // 40x13=520

const CDN='https://cdn.jsdelivr.net';
const TW_PNG=(seq)=>`${CDN}/gh/twitter/twemoji@14/assets/72x72/${seq}.png`;
const OM_PNG=(seq)=>`${CDN}/npm/openmoji@14.0.0/color/72x72/${seq.toUpperCase()}.png`;

const ensureDir=async d=>{try{await fs.mkdir(d,{recursive:true});}catch{}};
const normSeq=(code, emoji='')=>{
  let s=(code||'').toLowerCase().trim().replace(/^[a-z]+\s+/,'').replace(/u\+/g,'').replace(/[_\s]+/g,'-');
  if(!/^[0-9a-f]+(-[0-9a-f]+)*$/.test(s)||!s){ if(emoji){const cps=[];for(const ch of emoji)cps.push(ch.codePointAt(0).toString(16)); s=cps.join('-');} else s=''; }
  return s.split('-').filter(p=>p!=='fe0f').join('-'); // FE0F 제거
};
async function headOk(u){ try{ const r=await fetch(u,{method:'HEAD'}); return r.ok; }catch{ return false; } }
async function bestProvider(seq){ if(await headOk(TW_PNG(seq))) return 'twemoji'; if(await headOk(OM_PNG(seq))) return 'openmoji'; return null; }
async function pngBuf(seq,provider){ const u=provider==='twemoji'?TW_PNG(seq):OM_PNG(seq); const r=await fetch(u); if(!r.ok) return null; return Buffer.from(await r.arrayBuffer()); }

async function main(){
  if(!DATA_URL) throw new Error('Missing --data=');
  await ensureDir(OUT_DIR);

  // 1) CSV 가져와 정규화
  const csv = await (await fetch(DATA_URL,{cache:'no-store'})).text();
  const { data } = Papa.parse(csv, { header:true, skipEmptyLines:true });
  const rows = data.map(r=>{ const o={}; for(const k in r){ o[String(k||'').trim().toLowerCase()] = r[k]; } return o; });

  // 2) 지원목록(404 제거용) 생성
  const seqs = [...new Set(rows.map(r=>normSeq(r.code,r.emoji)).filter(Boolean))];
  const support={twemoji:[], openmoji:[]};
  let idx=0, inFlight=0; const limit=16;
  await new Promise(resolve=>{
    const kick=()=>{ while(inFlight<limit && idx<seqs.length){ const s=seqs[idx++]; inFlight++;
      (async()=>{ const p=await bestProvider(s); if(p==='twemoji') support.twemoji.push(s); else if(p==='openmoji') support.openmoji.push(s); })()
        .finally(()=>{ inFlight--; if(idx>=seqs.length && inFlight===0) resolve(); else kick(); });
    }}; kick();
  });
  await fs.writeFile(path.join(OUT_DIR,'SUPPORT_HINTS.json'), JSON.stringify(support,null,2));

  // 3) TopN 스프라이트 후보
  const pool=[];
  for(const r of rows){
    const s=normSeq(r.code,r.emoji); if(!s) continue;
    if(support.twemoji.includes(s) || support.openmoji.includes(s)){
      pool.push({ seq:s, provider: support.twemoji.includes(s)?'twemoji':'openmoji' });
    }
    if(pool.length>=TOP_N) break;
  }

  // 4) 타일 PNG 다운로드 & 리사이즈
  const items=[]; idx=0; inFlight=0;
  await new Promise(resolve=>{
    const kick=()=>{ while(inFlight<12 && idx<pool.length){ const cur=pool[idx++]; inFlight++;
      (async()=>{ const buf=await pngBuf(cur.seq,cur.provider);
        if(buf){ const png=await sharp(buf).resize(TILE,TILE,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png({quality:90}).toBuffer();
                 items.push({key:cur.seq,png}); } })()
        .finally(()=>{ inFlight--; if(idx>=pool.length && inFlight===0) resolve(); else kick(); });
    }}; kick();
  });

  // 5) 시트 합성 → WebP 1~N장 + SPRITE_MAP.json
  items.sort((a,b)=>a.key.localeCompare(b.key));
  const map={}; let sheetIdx=1, pos=0;
  while(pos<items.length){
    const slice=items.slice(pos,pos+COLS*ROWS_PER_SHEET);
    const rowsCnt=Math.ceil(slice.length/COLS);
    const width=COLS*TILE, height=rowsCnt*TILE;
    const comps=[]; slice.forEach((it,i)=>{ const x=(i%COLS)*TILE, y=Math.floor(i/COLS)*TILE; comps.push({input:it.png,left:x,top:y}); map[it.key]={sheet:`emoji-top${TOP_N}-${sheetIdx}.webp`,x,y,w:TILE,h:TILE}; });
    const out=path.join(OUT_DIR,`emoji-top${TOP_N}-${sheetIdx}.webp`);
    await sharp({create:{width,height,channels:4,background:{r:0,g:
