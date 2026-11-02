const { createApp, reactive, ref, computed, onMounted, onBeforeUnmount } = Vue;

// Zoom: in is capped, out is not (the floor only keeps the scale a valid, positive number).
const ZOOM_MAX = 3;
const ZOOM_MIN = 0.001;
// Board width in px at 100%. Fixed (not tied to the screen) so every device sees the same wall:
// wide on purpose, so you scroll sideways, but bounded so it never gets lost. 2400 is about two
// desktop screens or six phone screens; change this one number to make the wall narrower/wider.
const WALL_W = 2400;
const MAX_Y = 20000;     // keep in sync with server.js
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

createApp({
  setup() {
    const slugFromPath = () => decodeURIComponent(location.pathname.slice(1)).toLowerCase() || 'home';

    const slug = ref(slugFromPath());
    // neutral until the wall's real background arrives (avoids a flash of the wrong color)
    const background = ref({ color: '#1c1c1e', texture: 'none' });
    const posts = ref([]);
    const total = ref(0);
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
    const viewportEl = ref(null);
    const wallEl = ref(null);
    const ghostEl = ref(null);
    const vp = reactive({ w: 0, h: 0 });          // size of the scroll area
    const placing = ref(null);                    // { x, y, rot } while a new scribble is being positioned
    const draggingGhost = ref(false);
    // creation step: a wall nobody named/styled yet and with no scribbles gets the "Crie seu muro" popup
    const wallSetup = ref(true);             // true until the server says otherwise (no flash while loading)
    const setupDismissed = ref(false);
    const setupName = ref('');
    const setupError = ref('');
    const existsName = ref('');
    const creating = ref(false);
    const showSetup = computed(() =>
      !loading.value && !wallSetup.value && posts.value.length === 0 && !setupDismissed.value);
    let poll = null;
    let ro = null;

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

    const sameBg = (a, b) => a && b && a.color === b.color && a.texture === b.texture;

    // ---- board geometry (the board is WALL_W wide at zoom 1; the viewport scrolls over it) ----
    const baseW = computed(() => WALL_W);
    const wallH = computed(() => {
      let bottom = 0;
      for (const p of posts.value) bottom = Math.max(bottom, p.y + p.size * 1.4);
      if (placing.value) bottom = Math.max(bottom, placing.value.y + draft.size * 1.4);
      return Math.max(vp.h || 600, Math.ceil(bottom) + 240); // always some room below the lowest scribble
    });
    function measure() {
      const v = viewportEl.value;
      if (v) { vp.w = v.clientWidth; vp.h = v.clientHeight; }
    }

    // x is the scribble's spot across the *free* width: `left: x%` + `translateX(-x%)` keeps it
    // fully inside the board at any width. y is px from the top.
    const scribbleStyle = (p) => ({
      left: p.x + '%',
      top: p.y + 'px',
      transform: `translateX(-${p.x}%) rotate(${p.rot}deg)`,
      color: p.color,
      fontFamily: `'${p.font}', cursive`,
      fontSize: p.size + 'px',
      fontWeight: p.bold ? 'bold' : 'normal',
    });
    const ghostStyle = computed(() => !placing.value ? {} : scribbleStyle({
      ...placing.value, color: draft.color, font: draft.font, size: draft.size, bold: draft.bold,
    }));

    // screen point -> board coordinates (the board is only ever scaled, never rotated)
    function toWall(clientX, clientY) {
      const r = wallEl.value.getBoundingClientRect();
      return { x: (clientX - r.left) / zoom.value, y: (clientY - r.top) / zoom.value };
    }

    async function loadWall() {
      loading.value = true;
      try {
        const w = await api(`/api/walls/${encodeURIComponent(slug.value)}`);
        background.value = w.background;
        posts.value = w.posts;
        total.value = w.total;
        wallSetup.value = w.setup !== false;
        setupDismissed.value = false;
        setupError.value = ''; existsName.value = '';
        setupName.value = slug.value === 'home' ? '' : slug.value; // the home page has no name yet
        document.title = `/${slug.value} · repiche.me`;
        // start at the top, in the middle of the wide board
        Vue.nextTick(() => {
          const v = viewportEl.value;
          if (v) { v.scrollTop = 0; v.scrollLeft = Math.max(0, (v.scrollWidth - v.clientWidth) / 2); }
        });
      } catch (e) {
        error.value = e.message;
      } finally {
        loading.value = false;
      }
    }

    // Pull in scribbles other people added since we last looked.
    async function refresh() {
      if (loading.value || sending.value) return;
      const versionAtRequest = bgVersion;
      try {
        const w = await api(`/api/walls/${encodeURIComponent(slug.value)}`);
        const known = new Set(posts.value.map((p) => p.id));
        const incoming = w.posts.filter((p) => !known.has(p.id));
        if (incoming.length) posts.value = [...posts.value, ...incoming];
        total.value = w.total;
        wallSetup.value = w.setup !== false; // someone else may have created this wall meanwhile
        const bgBusy = bgTimer !== null || bgSaving || versionAtRequest !== bgVersion || showSetup.value;
        if (!bgBusy && !sameBg(background.value, w.background)) background.value = w.background;
      } catch { /* ignore transient errors */ }
    }

    // ---- zoom (uniform scale of the board; the point under the cursor/fingers stays put) ----
    const zoomLabel = computed(() => {
      const p = zoom.value * 100;
      return (p >= 10 ? Math.round(p) : p >= 1 ? p.toFixed(1) : p.toFixed(2)) + '%';
    });

    function setZoom(z, ax, ay) {
      z = clamp(z, ZOOM_MIN, ZOOM_MAX);
      if (!(Math.abs(z - zoom.value) > 1e-9)) return;
      const v = viewportEl.value;
      const vr = v.getBoundingClientRect();
      if (ax === undefined) ax = vr.left + vr.width / 2;
      if (ay === undefined) ay = vr.top + vr.height / 2;
      const under = toWall(ax, ay); // board point under the anchor, before zooming
      zoom.value = z;
      Vue.nextTick(() => {
        const wr = wallEl.value.getBoundingClientRect();
        v.scrollLeft += wr.left + under.x * z - ax;
        v.scrollTop += wr.top + under.y * z - ay;
      });
    }
    const zoomBy = (factor) => setZoom(zoom.value * factor);

    // Ctrl/Cmd + wheel (also what a trackpad pinch sends on desktop)
    function onWheel(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const k = e.deltaMode === 0 ? 0.0025 : 0.05;
      setZoom(zoom.value * Math.exp(-e.deltaY * k), e.clientX, e.clientY);
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
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      setZoom(pinch.z0 * (dist(e.touches) / pinch.d0), cx, cy);
    }
    function onTouchEnd(e) { if (e.touches.length < 2) pinch = null; }
    const stopGesture = (e) => e.preventDefault(); // iOS Safari page pinch

    // ---- placing a new scribble: "Pichar" -> drag it -> "Fixar aqui" ----
    function startPlacing() {
      error.value = '';
      if (!draft.text.trim()) { error.value = 'Escreva algo!'; return; }
      const vr = viewportEl.value.getBoundingClientRect();
      // start in the middle of what you're looking at, above the compose bar
      const c = toWall(vr.left + vr.width / 2, vr.top + vr.height * 0.4);
      placing.value = {
        x: 50,
        y: clamp(Math.round(c.y - draft.size * 0.6), 0, MAX_Y),
        rot: Math.round((Math.random() * 30 - 15) * 10) / 10,
      };
      Vue.nextTick(() => {
        const g = ghostEl.value;
        if (!g || !placing.value) return;
        const free = baseW.value - g.offsetWidth;
        placing.value.x = free > 1 ? clamp(Math.round(((c.x - g.offsetWidth / 2) / free) * 1000) / 10, 0, 100) : 50;
      });
    }

    let drag = null;
    function dragStart(e) {
      if (!placing.value || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      const g = ghostEl.value;
      g.setPointerCapture(e.pointerId);
      const p = toWall(e.clientX, e.clientY);
      const left = (placing.value.x / 100) * (baseW.value - g.offsetWidth);
      drag = { gw: g.offsetWidth, offX: p.x - left, offY: p.y - placing.value.y };
      draggingGhost.value = true;
    }
    function dragMove(e) {
      if (!drag || !placing.value) return;
      // nudge the scroll area when the pointer is near its edge (long walls, zoomed in)
      const v = viewportEl.value, vr = v.getBoundingClientRect(), edge = 48;
      if (e.clientY < vr.top + edge) v.scrollTop -= 14;
      else if (e.clientY > vr.bottom - edge) v.scrollTop += 14;
      if (e.clientX < vr.left + edge) v.scrollLeft -= 14;
      else if (e.clientX > vr.right - edge) v.scrollLeft += 14;

      const p = toWall(e.clientX, e.clientY);
      const free = baseW.value - drag.gw;
      placing.value.x = free > 1 ? clamp(Math.round(((p.x - drag.offX) / free) * 1000) / 10, 0, 100) : 50;
      placing.value.y = clamp(Math.round(p.y - drag.offY), 0, MAX_Y);
    }
    function dragEnd() { drag = null; draggingGhost.value = false; }

    function cancelPlacing() { placing.value = null; error.value = ''; dragEnd(); }

    async function commitPlacing() {
      if (!placing.value || sending.value) return;
      error.value = '';
      sending.value = true;
      try {
        const p = await api(`/api/walls/${encodeURIComponent(slug.value)}/posts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...draft, x: placing.value.x, y: placing.value.y, rot: placing.value.rot }),
        });
        posts.value = [...posts.value, p];
        total.value++;
        freshId.value = p.id;
        draft.text = '';
        placing.value = null;
      } catch (e) {
        error.value = e.message; // stays in placing mode so nothing is lost
      } finally {
        sending.value = false;
      }
    }
    const onSubmit = () => (placing.value ? commitPlacing() : startPlacing());

    // ---- background: change locally right away, save (debounced) to the wall ----
    function applyBackground(bg) {
      background.value = { color: bg.color, texture: bg.texture };
      if (showSetup.value) return; // still creating the wall: saved together with the name by "Criar muro"
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

    // ---- creating a wall: name + look, then it exists ----
    function cleanSetupName() {
      setupName.value = setupName.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 30);
      setupError.value = ''; existsName.value = '';
    }
    async function createWall() {
      if (creating.value) return;
      cleanSetupName();
      const name = setupName.value;
      if (!name) { setupError.value = 'Escolha um nome para o muro.'; return; }
      creating.value = true;
      try {
        await api(`/api/walls/${encodeURIComponent(name)}/setup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ background: background.value }),
        });
        if (name === slug.value) wallSetup.value = true; // same URL: just close the popup
        else go(name);                                    // new name: open that wall
      } catch (e) {
        setupError.value = e.message;
        if (/já existe/.test(e.message)) existsName.value = name;
      } finally {
        creating.value = false;
      }
    }

    async function openNav() {
      walls.value = await api('/api/walls').catch(() => []);
    }

    function go(target) {
      showNav.value = false;
      cancelPlacing();
      history.pushState({}, '', '/' + (target === 'home' ? '' : encodeURIComponent(target)));
      slug.value = slugFromPath();
      loadWall();
    }

    function goCustom() {
      const s = newSlug.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (s) { newSlug.value = ''; go(s); }
    }

    const onPop = () => { cancelPlacing(); slug.value = slugFromPath(); loadWall(); };

    onMounted(async () => {
      measure();
      if ('ResizeObserver' in window) { ro = new ResizeObserver(measure); ro.observe(viewportEl.value); }
      else window.addEventListener('resize', measure);
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
      if (ro) ro.disconnect();
      window.removeEventListener('resize', measure);
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
      slug, background, posts, total, loading, sending, error, freshId,
      meta, draft, showNav, showBg, showCredits, walls, newSlug,
      zoom, zoomLabel, ZOOM_MAX, viewportEl, wallEl, ghostEl, baseW, wallH, placing, draggingGhost,
      showSetup, setupDismissed, setupName, setupError, existsName, creating, cleanSetupName, createWall,
      scribbleStyle, ghostStyle, setZoom, zoomBy,
      onSubmit, cancelPlacing, dragStart, dragMove, dragEnd,
      applyBackground, setColor, setTexture, isPreset, go, goCustom,
    };
  },
}).mount('#app');
