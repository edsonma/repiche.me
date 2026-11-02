const { createApp, reactive, ref, onMounted, onBeforeUnmount } = Vue;

createApp({
  setup() {
    const slugFromPath = () => decodeURIComponent(location.pathname.slice(1)).toLowerCase() || 'home';

    const slug = ref(slugFromPath());
    const background = ref('brick');
    const posts = ref([]);
    const total = ref(0);
    const hasMore = ref(false);
    const loading = ref(true);
    const sending = ref(false);
    const error = ref('');
    const freshId = ref(null);
    const meta = reactive({ fonts: ['Permanent Marker'], backgrounds: ['brick'], maxText: 140 });
    const draft = reactive({ text: '', font: 'Permanent Marker', color: '#ffffff', size: 28, bold: false });
    const showNav = ref(false);
    const showBg = ref(false);
    const walls = ref([]);
    const newSlug = ref('');
    let poll = null;

    async function api(url, opts) {
      const res = await fetch(url, opts);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Erro inesperado');
      return data;
    }

    async function loadWall() {
      loading.value = true;
      try {
        const w = await api(`/api/walls/${encodeURIComponent(slug.value)}`);
        background.value = w.background;
        posts.value = w.posts;
        total.value = w.total;
        hasMore.value = w.hasMore;
        document.title = `/${slug.value} · piche.me (clone)`;
      } catch (e) {
        error.value = e.message;
      } finally {
        loading.value = false;
      }
    }

    // Pull in posts other people made since we last looked.
    async function refresh() {
      if (loading.value || sending.value) return;
      try {
        const w = await api(`/api/walls/${encodeURIComponent(slug.value)}`);
        const known = new Set(posts.value.map((p) => p.id));
        const incoming = w.posts.filter((p) => !known.has(p.id));
        if (incoming.length) posts.value = [...incoming, ...posts.value];
        total.value = w.total;
        background.value = w.background;
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

    async function setBackground(b) {
      try {
        await api(`/api/walls/${encodeURIComponent(slug.value)}/background`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ background: b }),
        });
        background.value = b;
      } catch (e) {
        error.value = e.message;
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
      meta, draft, showNav, showBg, walls, newSlug,
      submit, loadMore, setBackground, go, goCustom,
    };
  },
}).mount('#app');
