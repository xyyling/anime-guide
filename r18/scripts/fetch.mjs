import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const R18_ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, '_site', 'r18');

const BGM = 'https://api.bgm.tv';
const USER_AGENT = 'anime-guide-r18/1.0 (https://github.com/xyyling/anime-guide)';
const CONCURRENCY = 3;
const TOKEN = process.env.BANGUMI_TOKEN || '';

const META_TAGS = new Set([
  '动画', '漫画改', '小说改', '游戏改', '原创', '轻小说改', '日本',
  'TV', 'WEB', '剧场版', 'OVA', '动漫', '新番', '连载', '完结', '改编',
  '动画制作', 'bilibili', '哔哩哔哩',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(url) {
  if (!url) return '';
  if (url.startsWith('//')) return 'https:' + url;
  return url;
}

function headers(json) {
  const h = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
  if (TOKEN) h.Authorization = 'Bearer ' + TOKEN;
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function bgmGet(url) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: headers(false) });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error('HTTP ' + res.status + ' ' + url);
        await sleep(1500 * (i + 1));
        continue;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (i < 2) await sleep(1000 * (i + 1));
    }
  }
  throw lastErr;
}

function cleanValue(v) {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) {
    return v
      .map((x) => {
        if (x == null) return '';
        if (typeof x === 'object') return x.v || x.value || x.name || x.k || '';
        return String(x);
      })
      .filter(Boolean)
      .join(' / ');
  }
  if (typeof v === 'object') return v.v || v.value || v.name || v.k || '';
  return String(v);
}

function findInfo(infobox, keys) {
  for (const key of keys) {
    const row = infobox.find((i) => i && i.key === key);
    if (row && row.value != null && row.value !== '') return cleanValue(row.value);
  }
  return '';
}

function extractStudio(infobox) {
  return findInfo(infobox, ['动画制作', '动画制作公司', '製作', '制作']);
}

function extractWebsite(infobox) {
  return findInfo(infobox, ['官方网站', '官网', '网站']);
}

function staffFromInfobox(infobox) {
  const roles = ['总导演', '导演', '系列构成', '脚本', '人物设定', '角色设计', '音乐', '原作', '制作'];
  const out = [];
  for (const role of roles) {
    for (const row of infobox) {
      if (row && row.key === role && row.value) {
        cleanValue(row.value)
          .split(/[、,，\n]/)
          .map((n) => n.trim())
          .filter(Boolean)
          .forEach((name) => out.push({ role, name }));
      }
    }
  }
  return out;
}

function addStaffFromPersons(staff, resp) {
  const data = Array.isArray(resp) ? resp : resp?.data;
  if (!Array.isArray(data)) return;
  for (const p of data) {
    if (!p || !p.name) continue;
    const role = p.relation || '制作';
    staff.push({ role, name: p.name });
  }
}

function castFromCharacters(resp) {
  const data = Array.isArray(resp) ? resp : resp?.data;
  const cast = [];
  if (!Array.isArray(data)) return cast;
  for (const c of data) {
    const character = c.name || '';
    for (const a of (c.actors || [])) {
      if (a && a.name) cast.push({ character, actor: a.name });
    }
  }
  return cast;
}

function dedupeStaff(staff) {
  const seen = new Set();
  return staff.filter((s) => {
    const k = s.role + '|' + s.name;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function isMetaTag(n) {
  if (META_TAGS.has(n)) return true;
  if (/^\d{4}$/.test(n)) return true;
  if (/^\d{4}年/.test(n)) return true;
  if (/^\d{1,2}月/.test(n)) return true;
  if (/^第.+季$/.test(n)) return true;
  if (/^[春秋冬夏]季$/.test(n)) return true;
  return false;
}

function pickTags(tags, excludeNames) {
  const out = [];
  const excluded = new Set((excludeNames || []).filter(Boolean));
  for (const t of (Array.isArray(tags) ? tags : [])) {
    if (!t || !t.name) continue;
    const n = String(t.name).trim();
    if (!n || excluded.has(n) || isMetaTag(n)) continue;
    out.push(n);
    if (out.length >= 8) break;
  }
  return out;
}

async function searchR18() {
  if (!TOKEN) throw new Error('缺少 BANGUMI_TOKEN');
  const all = [];
  let offset = 0;
  const limit = 50;
  for (let page = 0; page < 20; page++) {
    const res = await fetch(BGM + '/v0/search/subjects?limit=' + limit + '&offset=' + offset, {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify({ keyword: '', sort: 'heat', filter: { type: [2], nsfw: true } }),
    });
    if (!res.ok) throw new Error('搜索接口返回 HTTP ' + res.status);
    const data = await res.json();
    const items = (data && data.data) || [];
    all.push(...items);
    if (items.length < limit) break;
    offset += limit;
  }
  return all;
}

async function downloadCover(url, id) {
  const full = normalizeUrl(url);
  if (!full) return '';
  const dest = path.join(SITE, 'assets', 'covers', id + '.jpg');
  try {
    const res = await fetch(full, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(dest, buf);
    return 'assets/covers/' + id + '.jpg';
  } catch {
    return '';
  }
}

async function enrich(subject) {
  const id = subject.id;
  const base = {
    id,
    title: subject.name_cn || subject.name || '',
    originalTitle: subject.name_cn ? subject.name : '',
    cover: '',
    summary: subject.summary || '',
    rating: subject.rating?.score ?? null,
    platform: subject.platform || '',
    studio: '',
    airDate: subject.date || '',
    staff: [],
    cast: [],
    tags: [],
    website: '',
    bgmUrl: 'https://bgm.tv/subject/' + id,
  };

  try {
    const detail = await bgmGet(BGM + '/v0/subjects/' + id);
    const infobox = Array.isArray(detail.infobox) ? detail.infobox : [];
    base.title = detail.name_cn || detail.name || base.title;
    base.originalTitle = detail.name_cn ? detail.name : (detail.name || '');
    base.summary = detail.summary || base.summary;
    base.rating = detail.rating?.score ?? base.rating;
    base.platform = detail.platform || base.platform;
    base.airDate = detail.date || base.airDate;
    base.studio = extractStudio(infobox);
    base.website = extractWebsite(infobox) || base.website;
    base.staff = staffFromInfobox(infobox);
    base.tags = pickTags(detail.tags || [], [base.studio]);

    const [pRes, cRes] = await Promise.allSettled([
      bgmGet(BGM + '/v0/subjects/' + id + '/persons?limit=50'),
      bgmGet(BGM + '/v0/subjects/' + id + '/characters?limit=50'),
    ]);
    if (pRes.status === 'fulfilled') addStaffFromPersons(base.staff, pRes.value);
    if (cRes.status === 'fulfilled') base.cast = castFromCharacters(cRes.value);
    base.staff = dedupeStaff(base.staff);

    const coverUrl = detail.images?.common || detail.images?.large || detail.images?.medium;
    base.cover = await downloadCover(coverUrl, id);
    return base;
  } catch (err) {
    console.warn('  subject ' + id + ' enrichment failed: ' + err.message);
    base.cover = await downloadCover(subject.images?.common || subject.images?.large, id);
    return base;
  }
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
  if (!TOKEN) {
    console.warn('未配置 BANGUMI_TOKEN，使用种子数据（空列表）。');
    data = JSON.parse(await readFile(path.join(R18_ROOT, 'data.json'), 'utf8'));
    data.generatedAt = new Date().toISOString();
  } else {
    try {
      console.log('Searching R18 (里番) subjects…');
      const subjects = await searchR18();
      console.log('Found ' + subjects.length + ' R18 subjects.');
      if (!subjects.length) throw new Error('没有搜到里番条目');
      const enriched = await mapWithConcurrency(subjects, CONCURRENCY, enrich);
      enriched.sort((a, b) => (b.airDate || '').localeCompare(a.airDate || ''));
      data = { generatedAt: new Date().toISOString(), season: '里番', items: enriched };
    } catch (err) {
      console.warn('搜索里番失败：' + err.message + '，回退到种子数据。');
      data = JSON.parse(await readFile(path.join(R18_ROOT, 'data.json'), 'utf8'));
      data.generatedAt = new Date().toISOString();
    }
  }

  await assemble(data);
  console.log('Done. R18 site written to ' + SITE);
}

main().catch((err) => {
  console.error('Fatal: ' + err.message);
  process.exit(1);
});
