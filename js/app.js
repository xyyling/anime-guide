(() => {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const stripTags = (s) => String(s ?? '').replace(/<[^>]*>/g, '');

  const state = {
    data: null,
    allItems: [],
    favorites: new Set(JSON.parse(localStorage.getItem('anime-guide:favorites') || '[]')),
    filters: { q: '', type: '', studio: '', tag: '' },
    today: 1,
  };

  const $ = (sel) => document.querySelector(sel);
  const el = {
    search: $('#search'),
    typeFilter: $('#typeFilter'),
    studioFilter: $('#studioFilter'),
    tagFilter: $('#tagFilter'),
    themeBtn: $('#themeBtn'),
    favBtn: $('#favBtn'),
    favCount: $('#favCount'),
    favPanel: $('#favorites'),
    favList: $('#favList'),
    hero: $('#hero'),
    heroBg: $('#hero .hero-bg'),
    heroDate: $('#heroDate'),
    heroTitle: $('#heroTitle'),
    heroMeta: $('#heroMeta'),
    heroSummary: $('#heroSummary'),
    heroMore: $('#heroMore'),
    main: $('#main'),
    modal: $('#modal'),
    modalBody: $('#modal .modal-body'),
  };

  function todayWeekday() {
    const d = new Date().getDay();
    return d === 0 ? 7 : d;
  }

  function allDays() { return (state.data && state.data.days) || []; }
  function flatten() { return allDays().flatMap((d) => d.items || []); }
  function coverOf(item) { return item.cover || 'assets/placeholder.svg'; }
  function isFav(id) { return state.favorites.has(id); }

  function persistFavorites() {
    localStorage.setItem('anime-guide:favorites', JSON.stringify([...state.favorites]));
    el.favCount.textContent = state.favorites.size;
  }

  function applyTheme(light) {
    document.body.classList.toggle('light', light);
    el.themeBtn.textContent = light ? '🌙' : '☀️';
    localStorage.setItem('anime-guide:theme', light ? 'light' : 'dark');
  }

  function toggleFav(id) {
    if (state.favorites.has(id)) state.favorites.delete(id);
    else state.favorites.add(id);
    persistFavorites();
    renderFavorites();
    document.querySelectorAll('.card-heart').forEach((h) => {
      h.classList.toggle('active', state.favorites.has(Number(h.dataset.id)));
    });
    syncModalHeart(id);
  }

  function syncModalHeart(id) {
    const btn = $('#modalHeart');
    if (btn) btn.textContent = isFav(id) ? '♥ 已追番' : '♡ 追番收藏';
  }

  function metaLine(item) {
    const parts = [];
    if (item.rating != null) parts.push('★ ' + Number(item.rating).toFixed(1));
    if (item.platform) parts.push(item.platform);
    if (item.airDate) parts.push(item.airDate);
    if (item.studio) parts.push(item.studio);
    return parts.join(' · ');
  }

  function matchesFilters(item) {
    const q = state.filters.q.trim().toLowerCase();
    if (q && !(item.title || '').toLowerCase().includes(q) && !(item.originalTitle || '').toLowerCase().includes(q)) return false;
    if (state.filters.type && item.platform !== state.filters.type) return false;
    if (state.filters.studio && item.studio !== state.filters.studio) return false;
    if (state.filters.tag && !(item.tags || []).includes(state.filters.tag)) return false;
    return true;
  }

  function fillSelect(sel, values, placeholder) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">' + placeholder + '</option>' +
      values.map((v) => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('');
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  }

  function setupFilters() {
    const types = [...new Set(state.allItems.map((i) => i.platform).filter(Boolean))].sort();
    const studios = [...new Set(state.allItems.map((i) => i.studio).filter(Boolean))].sort();
    const tags = [...new Set(state.allItems.flatMap((i) => i.tags || []).filter(Boolean))].sort();
    fillSelect(el.typeFilter, types, '全部类型');
    fillSelect(el.studioFilter, studios, '全部制作公司');
    fillSelect(el.tagFilter, tags, '全部标签');
  }

  function renderHero() {
    const todayItems = (allDays().find((d) => d.weekday === state.today)?.items || []).filter(matchesFilters);
    const item = todayItems[0] || state.allItems.filter(matchesFilters)[0];
    el.heroDate.textContent = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
    if (!item) {
      el.heroBg.style.backgroundImage = '';
      el.heroTitle.textContent = '今日暂无新番更新';
      el.heroMeta.textContent = '';
      el.heroSummary.textContent = '请稍后刷新，或运行数据抓取脚本获取最新内容。';
      el.heroMore.hidden = true;
      return;
    }
    el.heroBg.style.backgroundImage = 'linear-gradient(90deg, rgba(20,20,20,.9), rgba(20,20,20,.2)), url("' + esc(coverOf(item)) + '")';
    el.heroTitle.textContent = item.title;
    el.heroMeta.textContent = metaLine(item);
    const summary = stripTags(item.summary || '暂无简介');
    el.heroSummary.textContent = summary.slice(0, 160) + (summary.length > 160 ? '…' : '');
    el.heroMore.hidden = false;
    el.heroMore.onclick = () => openModal(item);
  }

  function cardHtml(item) {
    const tags = item.tags || [];
    return '<button class="card" type="button" data-id="' + item.id + '">' +
      '<span class="card-poster">' +
        '<img src="' + esc(coverOf(item)) + '" alt="' + esc(item.title) + '" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'assets/placeholder.svg\'">' +
        (tags.length ? '<span class="card-tags">' + tags.map((t) => '<span class="card-tag-chip">' + esc(t) + '</span>').join('') + '</span>' : '') +
      '</span>' +
      '<span class="card-title">' + esc(item.title) + '</span>' +
      '<span class="card-original">' + esc(item.originalTitle && item.originalTitle !== item.title ? item.originalTitle : '') + '</span>' +
      '<span class="card-heart' + (isFav(item.id) ? ' active' : '') + '" data-id="' + item.id + '" title="追番">♥</span>' +
      '</button>';
  }

  function renderRows() {
    const rows = allDays()
      .map((d) => ({ day: d, items: (d.items || []).filter(matchesFilters) }))
      .filter((r) => r.items.length > 0);
    if (!rows.length) {
      el.main.innerHTML = '<div class="empty">没有符合条件的番剧。</div>';
      return;
    }
    el.main.innerHTML = rows.map(({ day, items }) =>
      '<section class="row">' +
        '<h2 class="row-title">' + esc(day.label) + ' <span class="row-count">' + items.length + ' 部</span></h2>' +
        '<div class="row-grid">' + items.map(cardHtml).join('') + '</div>' +
      '</section>').join('');
  }

  function modalHtml(item) {
    const staff = item.staff || [];
    const cast = item.cast || [];
    const fav = isFav(item.id);
    return '<div class="modal-hero" style="background-image:linear-gradient(180deg, rgba(0,0,0,.2), var(--panel)), url(\'' + esc(coverOf(item)) + '\')"></div>' +
      '<div class="modal-inner">' +
        '<img class="modal-poster" src="' + esc(coverOf(item)) + '" alt="' + esc(item.title) + '" decoding="async" onerror="this.onerror=null;this.src=\'assets/placeholder.svg\'">' +
        '<div class="modal-info">' +
          '<h2>' + esc(item.title) + '</h2>' +
          (item.originalTitle && item.originalTitle !== item.title ? '<p class="modal-orig">' + esc(item.originalTitle) + '</p>' : '') +
          '<p class="modal-meta">' + esc(metaLine(item)) + '</p>' +
          '<div class="actions">' +
            '<button class="accent-btn" id="modalHeart" data-id="' + item.id + '" type="button">' + (fav ? '♥ 已追番' : '♡ 追番收藏') + '</button>' +
            '<a class="outlink" href="' + esc(item.bgmUrl) + '" target="_blank" rel="noopener">在 Bangumi 查看 ↗</a>' +
            (item.website ? '<a class="outlink" href="' + esc(item.website) + '" target="_blank" rel="noopener">官方网站 ↗</a>' : '') +
          '</div>' +
          '<h3>简介</h3><p class="modal-summary">' + esc(stripTags(item.summary || '暂无简介')) + '</p>' +
          (item.studio ? '<h3>制作公司</h3><div class="chip-row"><span class="chip">' + esc(item.studio) + '</span></div>' : '') +
          (item.tags && item.tags.length ? '<h3>题材标签</h3><div class="chip-row">' + item.tags.map((t) => '<span class="chip">' + esc(t) + '</span>').join('') + '</div>' : '') +
          (staff.length ? '<h3>制作人员 Staff</h3><ul class="staff-list">' + staff.map((s) => '<li><span class="role">' + esc(s.role) + '</span>' + esc(s.name) + '</li>').join('') + '</ul>' : '') +
          (cast.length ? '<h3>主要角色与声优</h3><ul class="cast-list">' + cast.map((c) => '<li><span class="role">' + esc(c.character) + '</span>CV ' + esc(c.actor) + '</li>').join('') + '</ul>' : '') +
        '</div>' +
      '</div>';
  }

  function openModal(item) {
    el.modalBody.innerHTML = modalHtml(item);
    el.modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    el.modal.hidden = true;
    document.body.style.overflow = '';
  }

  function renderFavorites() {
    const favs = state.allItems.filter((i) => isFav(i.id));
    el.favList.innerHTML = favs.length
      ? favs.map((f) =>
          '<div class="fav-item" data-id="' + f.id + '">' +
            '<img src="' + esc(coverOf(f)) + '" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'assets/placeholder.svg\'">' +
            '<span class="t">' + esc(f.title) + '</span>' +
            '<button class="rm" data-remove="' + f.id + '" title="取消追番">✕</button>' +
          '</div>').join('')
      : '<p class="fav-empty">还没有追番的动画。</p>';
  }

  function render() {
    state.allItems = flatten();
    setupFilters();
    renderHero();
    renderRows();
    renderFavorites();
    el.favCount.textContent = state.favorites.size;
  }

  el.main.addEventListener('click', (e) => {
    const heart = e.target.closest('.card-heart');
    if (heart) { e.stopPropagation(); toggleFav(Number(heart.dataset.id)); return; }
    const card = e.target.closest('.card');
    if (card) {
      const item = state.allItems.find((i) => i.id === Number(card.dataset.id));
      if (item) openModal(item);
    }
  });

  el.modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { closeModal(); return; }
    const heart = e.target.closest('#modalHeart');
    if (heart) toggleFav(Number(heart.dataset.id));
  });

  el.favPanel.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) { toggleFav(Number(rm.dataset.remove)); return; }
    const itemEl = e.target.closest('.fav-item');
    if (itemEl) {
      const item = state.allItems.find((i) => i.id === Number(itemEl.dataset.id));
      if (item) openModal(item);
    }
  });

  el.favBtn.addEventListener('click', () => { el.favPanel.hidden = !el.favPanel.hidden; });
  el.themeBtn.addEventListener('click', () => {
    applyTheme(!document.body.classList.contains('light'));
  });
  el.search.addEventListener('input', (e) => { state.filters.q = e.target.value; renderRows(); renderHero(); });
  el.typeFilter.addEventListener('change', (e) => { state.filters.type = e.target.value; renderRows(); renderHero(); });
  el.studioFilter.addEventListener('change', (e) => { state.filters.studio = e.target.value; renderRows(); renderHero(); });
  el.tagFilter.addEventListener('change', (e) => { state.filters.tag = e.target.value; renderRows(); renderHero(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(); el.favPanel.hidden = true; }
  });

  async function init() {
    state.today = todayWeekday();
    applyTheme(localStorage.getItem('anime-guide:theme') === 'light');
    try {
      const res = await fetch('data.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      state.data = await res.json();
    } catch (err) {
      el.heroTitle.textContent = '数据加载失败';
      el.heroSummary.textContent = '请使用本地静态服务器（如 npx serve）预览，并确认 data.json 存在。';
      el.heroMore.hidden = true;
      el.main.innerHTML = '<div class="empty">无法加载数据。</div>';
      return;
    }
    render();
  }

  init();
})();
