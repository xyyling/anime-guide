import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, '_site');

const BGM = 'https://api.bgm.tv';
const USER_AGENT = 'anime-guide/1.0 (https://github.com/your-repo)';
const CONCURRENCY = 3;

const WEEKDAY_LABELS = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(url) {
  if (!url) return '';
  if (url.startsWith('//')) return 'https:' + url;
  return url;
}

function asList(resp) {
  if (Array.isArray(resp)) return resp;
  if (resp && Array.isArray(resp.data)) return resp.data;
  return [];
}

async function bgmGet(url) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
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
  for (const p of asList(resp)) {
    if (!p || !p.name) continue;
    const role = p.relation || '制作';
    staff.push({ role, name: p.name });
  }
}

function castFromCharacters(resp) {
  const cast = [];
  for (const c of asList(resp)) {
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

async function enrich(cal) {
  const id = cal.id;
  const base = {
    id,
    title: cal.name_cn || cal.name || '',
    originalTitle: cal.name_cn ? cal.name : '',
    cover: '',
    summary: cal.summary || '',
    rating: cal.rating?.score ?? null,
    platform: '',
    studio: '',
    airDate: cal.air_date || '',
    weekday: cal.weekday,
    staff: [],
    cast: [],
    website: '',
    bgmUrl: 'https://bgm.tv/subject/' + id,
  };

  try {
    const subject = await bgmGet(BGM + '/v0/subjects/' + id);
    const infobox = Array.isArray(subject.infobox) ? subject.infobox : [];
    base.title = subject.name_cn || subject.name || base.title;
    base.originalTitle = subject.name_cn ? subject.name : (subject.name || '');
    base.summary = subject.summary || base.summary;
    base.rating = subject.rating?.score ?? base.rating;
    base.platform = subject.platform || '';
    base.airDate = subject.date || base.airDate;
    base.studio = extractStudio(infobox);
    base.website = extractWebsite(infobox);
    base.staff = staffFromInfobox(infobox);

    const [pRes, cRes] = await Promise.allSettled([
      bgmGet(BGM + '/v0/subjects/' + id + '/persons?limit=50'),
      bgmGet(BGM + '/v0/subjects/' + id + '/characters?limit=50'),
    ]);
    if (pRes.status === 'fulfilled') addStaffFromPersons(base.staff, pRes.value);
    if (cRes.status === 'fulfilled') base.cast = castFromCharacters(cRes.value);
    base.staff = dedupeStaff(base.staff);

    const coverUrl =
      subject.images?.large || subject.images?.common || cal.images?.large || cal.images?.common;
    base.cover = await downloadCover(coverUrl, id);
    return base;
  } catch (err) {
    console.warn('  subject ' + id + ' enrichment failed: ' + err.message);
    base.cover = await downloadCover(cal.images?.large || cal.images?.common, id);
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
  await copyFile(path.join(ROOT, 'index.html'), path.join(SITE, 'index.html'));
  await copyFile(path.join(ROOT, 'css', 'style.css'), path.join(SITE, 'css', 'style.css'));
  await copyFile(path.join(ROOT, 'js', 'app.js'), path.join(SITE, 'js', 'app.js'));
  await copyFile(path.join(ROOT, 'assets', 'placeholder.svg'), path.join(SITE, 'assets', 'placeholder.svg'));
}

async function main() {
  await mkdir(path.join(SITE, 'assets', 'covers'), { recursive: true });

  console.log('Fetching Bangumi calendar…');
  const calendar = await bgmGet(BGM + '/calendar');
  const groups = asList(calendar);
  const flat = [];
  for (const g of groups) {
    const weekday = Number(g.weekday);
    for (const item of (g.items || [])) flat.push({ ...item, weekday });
  }
  console.log('Found ' + flat.length + ' airing entries.');

  const enriched = await mapWithConcurrency(flat, CONCURRENCY, enrich);
  const days = [];
  for (let w = 1; w <= 7; w++) {
    days.push({ weekday: w, label: WEEKDAY_LABELS[w], items: enriched.filter((e) => e.weekday === w) });
  }

  const data = { generatedAt: new Date().toISOString(), days };
  await assemble(data);
  console.log('Done. Site written to ' + SITE);
}

main().catch((err) => {
  console.error('Fatal: ' + err.message);
  process.exit(1);
});
