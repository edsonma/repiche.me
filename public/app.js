const { createApp, reactive, ref, onMounted, onBeforeUnmount } = Vue;

createApp({
  setup() {
    const slugFromPath = () => decodeURIComponent(location.pathname.slice(1)).toLowerCase() || 'home';

    const slug = ref(slugFromPath());
    // neutral until the wall's real background arrives (avoids a flash of the wrong color)
    const background = ref({ color: '#1c1c1e', texture: 'none' });
    const posts = ref([]);
    const total = ref(0);
    const hasMore = ref(false);
    const loading = ref(true);
    const sending = ref(false);
    const error = ref('');
    const freshId = ref(null);
    const meta = reactive({ fonts: ['Permanent Marker'], textures: [], presets: {}, maxText: 140 });
    const draft = reactive({ text: '', font: 'Permanent Marker', color: '#ffffff', size: 28, bold: false });
    const showNav = ref(false);
    const showBg = ref(false);
    const showCredits = ref(false);
    const walls = ref([]);
    const newSlug = ref('');
    let poll = null;

    // Background save state. A poll response that was requested before the latest local
    // change (or while a save is pending) must not overwrite what the user just picked.
    let bgVersion = 0;
    let bgTimer = null;
    let bgSaving = false;
    let bgSlug = null;

    async function api(url, opts) {
      const res = await fetch(url, opts);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Erro inesperado');
      return data;
    }

    // Horizontal spot as 0-100. `left: N%` + `translateX(-N%)` places the scribble at N% of the
    // free space, so it always stays fully inside the wall (no sideways scrolling on phones).
    // Stored x is 0-70 from the server.
    const pct = (p) => Math.min(100, Math.max(0, Math.round(p.x / 0.7)));

    const sameBg = (a, b) => a && b && a.color === b.color && a.texture === b.texture;

    async function loadWall() {
      loading.value = true;
      try {
        const w = await api(`/api/walls/${encodeURIComponent(slug.value)}`);
        background.value = w.background;
        posts.value = w.posts;
        total.value = w.total;
        hasMore.value = w.hasMore;
        document.title = `/${slug.value} · repiche.me`;
      } catch (e) {
        error.value = e.message;
      } finally {
        loading.value = false;
      }
    }

    // Pull in posts other people made since we last looked.
    async function refresh() {
      if (loading.value || sending.value) return;
      const versionAtRequest = bgVersion;
      try {
        const w = await api(`/api/walls/${encodeURIComponent(slug.value)}`);
        const known = new Set(posts.value.map((p) => p.id));
        const incoming = w.posts.filter((p) => !known.has(p.id));
        if (incoming.length) posts.value = [...incoming, ...posts.value];
        total.value = w.total;
        const bgBusy = bgTimer !== null || bgSaving || versionAtRequest !== bgVersion;
        if (!bgBusy && !sameBg(background.value, w.background)) background.value = w.background;
      } catch { /* ignore transient errors */ }
    }

    async function loadMore() {
      const oldest = posts.value[posts.value.length - 1];
      if (!oldest) return;
      const w = await api(`/api/walls/${encodeURIComponent(slug.value)}?before=${oldest.id}`);
      posts.value = [...posts.value, ...w.posts];
      hasMore.value = w.hasMore;
    }

    async function submit() {
      error.value = '';
      if (!draft.text.trim()) return;
      sending.value = true;
      try {
        const p = await api(`/api/walls/${encodeURIComponent(slug.value)}/posts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
        });
        posts.value = [p, ...posts.value];
        total.value++;
        freshId.value = p.id;
        draft.text = '';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (e) {
        error.value = e.message;
      } finally {
        sending.value = false;
      }
    }

    // ---- background: change locally right away, save (debounced) to the wall ----
    function applyBackground(bg) {
      background.value = { color: bg.color, texture: bg.texture };
      bgVersion++;
      bgSlug = slug.value;
      clearTimeout(bgTimer);
      bgTimer = setTimeout(saveBackground, 350);
    }
    const setColor = (color) => applyBackground({ color, texture: background.value.texture });
    const setTexture = (texture) => applyBackground({ color: background.value.color, texture });
    const isPreset = (p) => sameBg(background.value, p);

    async function saveBackground() {
      bgTimer = null;
      bgSaving = true;
      const bg = { ...background.value };
      try {
        await api(`/api/walls/${encodeURIComponent(bgSlug)}/background`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bg),
        });
      } catch (e) {
        error.value = e.message;
      } finally {
        bgSaving = false;
      }
    }

    async function openNav() {
      walls.value = await api('/api/walls').catch(() => []);
    }

    function go(target) {
      showNav.value = false;
      history.pushState({}, '', '/' + (target === 'home' ? '' : encodeURIComponent(target)));
      slug.value = slugFromPath();
      loadWall();
    }

    function goCustom() {
      const s = newSlug.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (s) { newSlug.value = ''; go(s); }
    }

    const onPop = () => { slug.value = slugFromPath(); loadWall(); };

    onMounted(async () => {
      Object.assign(meta, await api('/api/meta').catch(() => ({})));
      await loadWall();
      window.addEventListener('popstate', onPop);
      poll = setInterval(refresh, 5000);
    });
    onBeforeUnmount(() => { clearInterval(poll); window.removeEventListener('popstate', onPop); });

    // load the wall list whenever the modal opens
    Vue.watch(showNav, (v) => v && openNav());

    return {
      slug, background, posts, total, hasMore, loading, sending, error, freshId,
      meta, draft, showNav, showBg, showCredits, walls, newSlug,
      pct, submit, loadMore, applyBackground, setColor, setTexture, isPreset, go, goCustom,
    };
  },
}).mount('#app');
