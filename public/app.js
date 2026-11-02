const { createApp, reactive, ref, computed, onMounted, onBeforeUnmount } = Vue;

// Zoom: in is capped, out is not (the floor only keeps the CSS zoom value a valid, positive number).
const ZOOM_MAX = 3;
const ZOOM_MIN = 0.001;

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
    const zoom = ref(1);
    const wallEl = ref(null);
    const sentinel = ref(null);
    let poll = null;
    let io = null;
    let moreFailed = false;
    let loadingMore = false;

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
      moreFailed = false;
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
        recheck();
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

    // ---- older scribbles: loaded by the button, or automatically when the end of the wall
    // comes into view (which is what happens when you zoom out) ----
    async function loadMore(manual = false) {
      if (manual === true) moreFailed = false;
      if (loadingMore || !hasMore.value) return;
      const oldest = posts.value[posts.value.length - 1];
      if (!oldest) return;
      loadingMore = true;
      const slugAtStart = slug.value;
      try {
        const w = await api(`/api/walls/${encodeURIComponent(slugAtStart)}?before=${oldest.id}`);
        if (slugAtStart !== slug.value) return; // navigated to another wall meanwhile
        const known = new Set(posts.value.map((p) => p.id));
        posts.value = [...posts.value, ...w.posts.filter((p) => !known.has(p.id))];
        hasMore.value = w.hasMore;
      } catch (e) {
        moreFailed = true; // stop auto-retrying; the button still works
        error.value = e.message;
      } finally {
        loadingMore = false;
        recheck();
      }
    }

    // IntersectionObserver only reports changes, so re-observe to get a fresh reading
    // (needed when the end of the wall is still on screen after a page loaded).
    function recheck() {
      if (!io || !sentinel.value) return;
      Vue.nextTick(() => {
        if (!sentinel.value) return;
        io.unobserve(sentinel.value);
        io.observe(sentinel.value);
      });
    }

    // ---- zoom ----
    const zoomLabel = computed(() => {
      const p = zoom.value * 100;
      return (p >= 10 ? Math.round(p) : p >= 1 ? p.toFixed(1) : p.toFixed(2)) + '%';
    });

    // Keeps the content under `anchorY` (viewport px) in place while the wall resizes.
    function setZoom(z, anchorY = window.innerHeight / 2) {
      z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
      if (!(Math.abs(z - zoom.value) > 1e-9)) return;
      const el = wallEl.value;
      const r0 = el.getBoundingClientRect();
      const frac = r0.height ? (anchorY - r0.top) / r0.height : 0;
      zoom.value = z;
      Vue.nextTick(() => {
        const r1 = el.getBoundingClientRect();
        window.scrollBy(0, r1.top - (anchorY - frac * r1.height));
        recheck();
      });
    }
    const zoomBy = (factor) => setZoom(zoom.value * factor);

    // Ctrl/Cmd + wheel (also what a trackpad pinch sends on desktop)
    function onWheel(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const k = e.deltaMode === 0 ? 0.0025 : 0.05;
      setZoom(zoom.value * Math.exp(-e.deltaY * k), e.clientY);
    }

    // two-finger pinch on touch screens
    let pinch = null;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    function onTouchStart(e) {
      if (e.touches.length === 2) pinch = { d0: dist(e.touches) || 1, z0: zoom.value };
    }
    function onTouchMove(e) {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const y = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      setZoom(pinch.z0 * (dist(e.touches) / pinch.d0), y);
    }
    function onTouchEnd(e) { if (e.touches.length < 2) pinch = null; }
    const stopGesture = (e) => e.preventDefault(); // iOS Safari page pinch

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
      if ('IntersectionObserver' in window && sentinel.value) {
        io = new IntersectionObserver((entries) => {
          if (entries.some((e) => e.isIntersecting) && hasMore.value && !loading.value && !moreFailed) loadMore();
        }, { rootMargin: '600px' });
        io.observe(sentinel.value);
      }
      window.addEventListener('wheel', onWheel, { passive: false });
      window.addEventListener('touchstart', onTouchStart, { passive: true });
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', onTouchEnd, { passive: true });
      window.addEventListener('touchcancel', onTouchEnd, { passive: true });
      document.addEventListener('gesturestart', stopGesture);
      document.addEventListener('gesturechange', stopGesture);

      Object.assign(meta, await api('/api/meta').catch(() => ({})));
      await loadWall();
      window.addEventListener('popstate', onPop);
      poll = setInterval(refresh, 5000);
    });
    onBeforeUnmount(() => {
      clearInterval(poll);
      if (io) io.disconnect();
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      document.removeEventListener('gesturestart', stopGesture);
      document.removeEventListener('gesturechange', stopGesture);
    });

    // load the wall list whenever the modal opens
    Vue.watch(showNav, (v) => v && openNav());

    return {
      slug, background, posts, total, hasMore, loading, sending, error, freshId,
      meta, draft, showNav, showBg, showCredits, walls, newSlug,
      zoom, zoomLabel, ZOOM_MAX, wallEl, sentinel, setZoom, zoomBy,
      pct, submit, loadMore, applyBackground, setColor, setTexture, isPreset, go, goCustom,
    };
  },
}).mount('#app');
