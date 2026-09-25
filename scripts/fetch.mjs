import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, '_site');

const BGM = 'https://api.bgm.tv';
const BGM_DATA = 'https://unpkg.com/bangumi-data@0.3/dist/data.json';
const USER_AGENT = 'anime-guide/1.0 (https://github.com/xyyling/anime-guide)';
const CONCURRENCY = 3;

// 2026 秋季新番：北京时间 2026-09-01 00:00 ~ 2027-01-01 00:00（即 UTC 范围）。
const SEASON_LABEL = '2026 秋季';
const SEASON_START = Date.parse('2026-08-31T16:00:00.000Z');
const SEASON_END = Date.parse('2026-12-31T16:00:00.000Z');
const BEIJING_OFFSET = 8 * 3600 * 1000;

const WEEKDAY_LABELS = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(url) {
  if (!url) return '';
  if (url.startsWith('//')) return 'https:' + url;
  return url;
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

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  return res.json();
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

function getBangumiId(item) {
  const site = (item.sites || []).find((s) => s && s.site === 'bangumi');
  return site && site.id ? Number(site.id) : null;
}

function zhTitle(item) {
  const t = item.titleTranslate || {};
  const zh = t['zh-Hans'] || t['zh-Hant'] || [];
  return (Array.isArray(zh) && zh[0]) || item.title || '';
}

function beijingParts(beginIso) {
  const bj = new Date(Date.parse(beginIso) + BEIJING_OFFSET);
  return {
    weekday: bj.getUTCDay() === 0 ? 7 : bj.getUTCDay(),
    date: bj.toISOString().slice(0, 10),
  };
}

function mapPlatform(type) {
  if (type === 'tv') return 'TV';
  if (type === 'web') return 'WEB';
  if (type === 'movie') return '剧场版';
  if (type === 'ova') return 'OVA';
  return type ? type.toUpperCase() : '';
}

const META_TAGS = new Set([
  '动画', '漫画改', '小说改', '游戏改', '原创', '轻小说改', '日本',
  'TV', 'WEB', '剧场版', 'OVA', '动漫', '新番', '连载', '完结', '改编',
  '动画制作', 'bilibili', '哔哩哔哩',
]);
const R18_TAGS = new Set(['里番', '成人向', '18禁', 'R18']);

function isMetaTag(n) {
  if (META_TAGS.has(n)) return true;
  if (/^\d{4}$/.test(n)) return true;          // 2026
  if (/^\d{4}年/.test(n)) return true;         // 2026年、2026年10月
  if (/^\d{1,2}月/.test(n)) return true;       // 10月、10月新番
  if (/^第.+季$/.test(n)) return true;         // 第二季
  if (/^[春秋冬夏]季$/.test(n)) return true;   // 秋季、春季
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

async function enrich(bd) {
  const id = bd.bangumiId;
  const base = {
    id,
    title: bd.nameCn || bd.title,
    originalTitle: bd.nameCn ? bd.title : '',
    cover: '',
    summary: '',
    rating: null,
    platform: bd.platform,
    studio: '',
    airDate: bd.airDate,
    weekday: bd.weekday,
    staff: [],
    cast: [],
    tags: [],
    isR18: false,
    website: bd.website || '',
    bgmUrl: 'https://bgm.tv/subject/' + id,
  };

  try {
    const subject = await bgmGet(BGM + '/v0/subjects/' + id);
    const infobox = Array.isArray(subject.infobox) ? subject.infobox : [];
    base.title = subject.name_cn || subject.name || base.title;
    base.originalTitle = subject.name_cn ? subject.name : (subject.name || '');
    base.summary = subject.summary || base.summary;
    base.rating = subject.rating?.score ?? base.rating;
    base.platform = subject.platform || base.platform;
    base.airDate = subject.date || base.airDate;
    base.studio = extractStudio(infobox);
    base.website = extractWebsite(infobox) || base.website;
    base.staff = staffFromInfobox(infobox);
    base.tags = pickTags(subject.tags || [], [base.studio]);
    const rawTags = Array.isArray(subject.tags) ? subject.tags.map((t) => t && t.name) : [];
    base.isR18 = rawTags.some((n) => R18_TAGS.has(n));

    const [pRes, cRes] = await Promise.allSettled([
      bgmGet(BGM + '/v0/subjects/' + id + '/persons?limit=50'),
      bgmGet(BGM + '/v0/subjects/' + id + '/characters?limit=50'),
    ]);
    if (pRes.status === 'fulfilled') addStaffFromPersons(base.staff, pRes.value);
    if (cRes.status === 'fulfilled') base.cast = castFromCharacters(cRes.value);
    base.staff = dedupeStaff(base.staff);

    const coverUrl = subject.images?.large || subject.images?.common;
    base.cover = await downloadCover(coverUrl, id);
    return base;
  } catch (err) {
    console.warn('  subject ' + id + ' enrichment failed: ' + err.message);
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

  console.log('Fetching bangumi-data season dataset…');
  const dataset = await getJson(BGM_DATA);
  const items = Array.isArray(dataset) ? dataset : (dataset.items || []);

  const seasonItems = [];
  for (const item of items) {
    const bangumiId = getBangumiId(item);
    if (!bangumiId || !item.begin) continue;
    const ts = Date.parse(item.begin);
    if (!Number.isFinite(ts) || ts < SEASON_START || ts >= SEASON_END) continue;
    const bj = beijingParts(item.begin);
    seasonItems.push({
      bangumiId,
      nameCn: zhTitle(item),
      title: item.title || '',
      platform: mapPlatform(item.type),
      airDate: bj.date,
      weekday: bj.weekday,
      website: item.officialSite || '',
    });
  }

  console.log('Selected ' + seasonItems.length + ' entries for ' + SEASON_LABEL + '.');
  if (!seasonItems.length) throw new Error('No season entries found in dataset.');

  const enriched = await mapWithConcurrency(seasonItems, CONCURRENCY, enrich);
  const filtered = enriched.filter((e) => !e.isR18);
  console.log('Filtered out ' + (enriched.length - filtered.length) + ' R18 entries.');
  const days = [];
  for (let w = 1; w <= 7; w++) {
    days.push({ weekday: w, label: WEEKDAY_LABELS[w], items: filtered.filter((e) => e.weekday === w) });
  }

  const data = { generatedAt: new Date().toISOString(), season: SEASON_LABEL, days };
  await assemble(data);
  console.log('Done. Site written to ' + SITE);
}

main().catch((err) => {
  console.error('Fatal: ' + err.message);
  process.exit(1);
});
