import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const R18_ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, '_site', 'r18');

const ANILIST = 'https://graphql.anilist.co';
const USER_AGENT = 'anime-guide-r18/1.0 (https://github.com/xyyling/anime-guide)';
const CONCURRENCY = 8;
const MAX_PAGES = 8;

const ROLE_MAP = {
  Director: '导演',
  'Series Composition': '系列构成',
  Script: '脚本',
  Screenplay: '脚本',
  Writer: '脚本',
  'Character Design': '人物设定',
  Music: '音乐',
  'Original Creator': '原作',
  'Animation Director': '作画监督',
  'Sound Director': '音响监督',
  Producer: '制作人',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripHtml(s) {
  return String(s ?? '').replace(/<[^>]*>/g, '');
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function buildDate(d) {
  if (!d || !d.year) return '';
  const parts = [String(d.year)];
  if (d.month) parts.push(pad(d.month));
  if (d.day) parts.push(pad(d.day));
  return parts.join('-');
}

async function anilist(query, variables) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(ANILIST, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': USER_AGENT },
        body: JSON.stringify({ query, variables }),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error('AniList HTTP ' + res.status);
        await sleep(2000 * (i + 1));
        continue;
      }
      if (!res.ok) throw new Error('AniList HTTP ' + res.status);
      const data = await res.json();
      if (data.errors && data.errors.length) throw new Error('AniList: ' + data.errors[0].message);
      return data.data;
    } catch (err) {
      lastErr = err;
      if (i < 2) await sleep(1500 * (i + 1));
    }
  }
  throw lastErr;
}

const QUERY = `
query($page:Int,$perPage:Int){
  Page(page:$page,perPage:$perPage){
    pageInfo{hasNextPage}
    media(type:ANIME,isAdult:true,sort:START_DATE_DESC){
      id
      title{romaji english native}
      coverImage{large medium}
      description
      averageScore
      format
      startDate{year month day}
      studios(isMain:true){nodes{name}}
      staff(perPage:12){edges{role node{name{full}}}}
      characters(perPage:8){edges{role node{name{full}} voiceActors(language:JAPANESE,sort:RELEVANCE){name{full}}}}
      tags{name}
      siteUrl
      isAdult
    }
  }
}`;

async function fetchAdultMedia() {
  const all = [];
  const perPage = 50;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await anilist(QUERY, { page, perPage });
    const media = (data.Page && data.Page.media) || [];
    all.push(...media);
    if (!(data.Page && data.Page.pageInfo && data.Page.pageInfo.hasNextPage)) break;
    await sleep(300);
  }
  return all;
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function downloadCover(url, id) {
  if (!url) return '';
  const dest = path.join(SITE, 'assets', 'covers', id + '.jpg');
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(dest, buf);
    return 'assets/covers/' + id + '.jpg';
  } catch {
    return '';
  }
}

function mapMedia(m) {
  const native = m.title && m.title.native;
  const romaji = m.title && m.title.romaji;
  const english = m.title && m.title.english;
  const title = native || romaji || english || '';
  const originalTitle = native ? (romaji || english || '') : '';

  const staff = ((m.staff && m.staff.edges) || [])
    .map((e) => ({
      role: ROLE_MAP[e.role] || e.role || 'Staff',
      name: (e.node && e.node.name && e.node.name.full) || '',
    }))
    .filter((s) => s.name);

  const cast = ((m.characters && m.characters.edges) || [])
    .map((e) => {
      const actor = (e.voiceActors && e.voiceActors[0] && e.voiceActors[0].name && e.voiceActors[0].name.full) || '';
      const character = (e.node && e.node.name && e.node.name.full) || '';
      return { character, actor };
    })
    .filter((c) => c.character);

  const studios = ((m.studios && m.studios.nodes) || []).map((s) => s.name).filter(Boolean);

  return {
    id: m.id,
    title,
    originalTitle,
    cover: '',
    summary: stripHtml(m.description || ''),
    rating: m.averageScore != null ? Number((m.averageScore / 10).toFixed(1)) : null,
    platform: m.format || '',
    studio: studios.join(' / '),
    airDate: buildDate(m.startDate),
    staff,
    cast,
    tags: (m.tags || []).map((t) => t.name).filter(Boolean).slice(0, 8),
    website: m.siteUrl || '',
    bgmUrl: m.siteUrl || '',
    isAdult: !!m.isAdult,
  };
}

async function assemble(data) {
  await mkdir(path.join(SITE, 'css'), { recursive: true });
  await mkdir(path.join(SITE, 'js'), { recursive: true });
  await mkdir(path.join(SITE, 'assets'), { recursive: true });
  await mkdir(path.join(SITE, 'assets', 'covers'), { recursive: true });

  await writeFile(path.join(SITE, 'data.json'), JSON.stringify(data, null, 2));
  await copyFile(path.join(R18_ROOT, 'index.html'), path.join(SITE, 'index.html'));
  await copyFile(path.join(R18_ROOT, 'js', 'app.js'), path.join(SITE, 'js', 'app.js'));
  await copyFile(path.join(ROOT, 'css', 'style.css'), path.join(SITE, 'css', 'style.css'));
  await copyFile(path.join(ROOT, 'assets', 'placeholder.svg'), path.join(SITE, 'assets', 'placeholder.svg'));
}

async function main() {
  await mkdir(path.join(SITE, 'assets', 'covers'), { recursive: true });

  let data;
  try {
    console.log('Fetching adult (R18) anime from AniList…');
    const media = await fetchAdultMedia();
    console.log('Found ' + media.length + ' adult titles.');
    if (!media.length) throw new Error('AniList 返回空结果');

    const items = media.map(mapMedia);
    await mapWithConcurrency(items, CONCURRENCY, async (item, i) => {
      const m = media[i];
      item.cover = await downloadCover((m.coverImage && (m.coverImage.large || m.coverImage.medium)) || '', m.id);
    });
    items.sort((a, b) => (b.airDate || '').localeCompare(a.airDate || ''));
    data = { generatedAt: new Date().toISOString(), season: '里番', items };
  } catch (err) {
    console.warn('抓取 AniList 失败：' + err.message + '，回退到种子数据。');
    data = JSON.parse(await readFile(path.join(R18_ROOT, 'data.json'), 'utf8'));
    data.generatedAt = new Date().toISOString();
  }

  await assemble(data);
  console.log('Done. R18 site written to ' + SITE);
}

main().catch((err) => {
  console.error('Fatal: ' + err.message);
  process.exit(1);
});
