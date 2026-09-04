(() => {
  'use strict';
  if (globalThis.__SVS_EXTENSION_LOADED__) return;
  globalThis.__SVS_EXTENSION_LOADED__ = true;

  const api = globalThis.browser ?? globalThis.chrome;
  const DEFAULTS = {
    whitelistedDomains: [
      'www.youtube.com', 'youtube.com', 'youtu.be', 'player.vimeo.com',
      'vimeo.com', 'www.twitch.tv', 'www.dailymotion.com', 'www.netflix.com',
      'www.primevideo.com', 'www.hotstar.com', 'www.zee5.com',
      'www.sonyliv.com', 'mxplayer.in', 'www.mxplayer.in', 'LOCAL_FILE'
    ],
    skipAmount: 60,
    autoSkipInterval: 10,
    backSkipAmount: 10,
    forwardSkipAmount: 10,
    hotkeySkipForward: 'ArrowRight',
    hotkeySkipBack: 'ArrowLeft',
    hotkeyAutoToggle: 'a',
    hotkeySpeedUp: ']',
    hotkeySpeedDown: '[',
    hotkeyBookmark: 'b',
    hotkeyPanelToggle: '`',
    overlayPosition: 'bottom',
    overlayOffset: 0,
    overlayOpacity: 0.92,
    accentColor: '#00e5ff',
    panelPosition: 'top-right',
    showProgressBar: true,
    showBookmarkToast: true,
    speedStep: 0.25,
    minSpeed: 0.25,
    maxSpeed: 4,
    enabled: false,
    autoSkipEnabled: false,
    muteOnSkip: false,
    preferForwardBuffering: true,
    bufferAwareSkipping: true,
    observeNewVideos: true
  };

  const host = location.protocol === 'file:' ? 'LOCAL_FILE' : location.hostname;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const isEditable = element => element?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element?.tagName);
  const formatTime = value => {
    if (!Number.isFinite(value) || value < 0) return '0:00';
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const seconds = Math.floor(value % 60);
    return hours
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  class Config {
    constructor(values) { this.values = { ...DEFAULTS, ...values }; }
    get(key) { return this.values[key]; }
    async set(key, value) { this.values[key] = value; await api.storage.local.set({ [key]: value }); }
    async reset() {
      await api.storage.local.remove(Object.keys(DEFAULTS));
      this.values = structuredClone(DEFAULTS);
    }
  }

  class App {
    constructor(config) {
      this.config = config;
      this.video = null;
      this.overlay = null;
      this.panel = null;
      this.toastBox = null;
      this.observer = null;
      this.autoTimer = null;
      this.preloadTimer = null;
      this.buffering = false;
      this.raf = null;
      this.bookmarks = [];
      this.keyHandler = event => this.onKey(event);
    }

    start() {
      this.applyTheme();
      this.mountGlobalUI();
      this.scan();
      addEventListener('keydown', this.keyHandler, true);
      addEventListener('yt-navigate-finish', () => setTimeout(() => this.scan(), 600));
      if (this.config.get('observeNewVideos')) {
        this.observer = new MutationObserver(() => {
          if (!this.video || !document.contains(this.video)) this.scan();
        });
        this.observer.observe(document.documentElement, { childList: true, subtree: true });
      }
      this.preloadTimer = setInterval(() => this.applyPreloadHint(), 5000);
      api.runtime.onMessage.addListener(message => {
        if (message?.type === 'svs:open-settings') this.openPanel();
      });
    }

    mountGlobalUI() {
      this.toastBox = document.createElement('div');
      this.toastBox.id = 'svs-toasts';
      document.documentElement.append(this.toastBox);
      this.panel = document.createElement('section');
      this.panel.id = 'svs-panel';
      this.panel.setAttribute('aria-label', 'SmartVideoSkipper settings');
      document.documentElement.append(this.panel);
      this.renderPanel();
    }

    applyTheme() {
      const style = document.documentElement.style;
      style.setProperty('--svs-accent', this.config.get('accentColor'));
      style.setProperty('--svs-opacity', this.config.get('overlayOpacity'));
      const top = this.config.get('overlayPosition') === 'top';
      const offset = Math.max(0, Number(this.config.get('overlayOffset')) || 0);
      style.setProperty('--svs-top', top ? `${offset}px` : 'auto');
      style.setProperty('--svs-bottom', top ? 'auto' : `${offset}px`);
      style.setProperty('--svs-direction', top ? 'column-reverse' : 'column');
    }

    scan() {
      const videos = [...document.querySelectorAll('video')]
        .filter(video => video.readyState > 0 || video.currentSrc || video.src);
      const playing = videos.filter(video => !video.paused && !video.ended);
      const candidates = playing.length ? playing : videos;
      const best = candidates.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
      if (best && best !== this.video) this.attach(best);
    }

    attach(video) {
      this.buffering = false;
      this.stopAutoSkip();
      this.detachOverlay();
      this.video = video;
      this.applyPreloadHint();
      if (this.config.get('enabled')) {
        this.renderOverlay();
        if (this.config.get('autoSkipEnabled')) this.startAutoSkip();
      }
    }

    applyPreloadHint() {
      if (!this.video || !this.config.get('preferForwardBuffering')) return;
      // This is honored by normal URL-backed media. YouTube may override it
      // because its MediaSource pipeline controls adaptive segment fetching.
      this.video.preload = 'auto';
      this.video.setAttribute('preload', 'auto');
    }

    seek(time) {
      if (!this.video || !Number.isFinite(time)) return;
      this.buffering = false;
      const duration = Number.isFinite(this.video.duration) ? this.video.duration : Infinity;
      this.video.currentTime = clamp(time, 0, duration);
    }

    bufferedRangeAt(video, time) {
      if (!video || !Number.isFinite(time)) return false;
      try {
        for (let index = 0; index < video.buffered.length; index += 1) {
          const start = video.buffered.start(index);
          const end = video.buffered.end(index);
          if (start <= time && end > time) return { start, end };
        }
      } catch { return false; }
      return false;
    }

    async bufferAwareSeek(time) {
      const video = this.video;
      if (!video || !Number.isFinite(time)) return { cancelled: true, timedOut: false };
      const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
      let target = clamp(time, 0, duration);
      if (this.config.get('bufferAwareSkipping')) {
        const range = this.bufferedRangeAt(video, video.currentTime);
        if (!range) return { cancelled: false, timedOut: false, limited: true };
        const safetyMargin = 0.1;
        const minimum = Math.min(video.currentTime, range.start + safetyMargin);
        const maximum = Math.max(video.currentTime, range.end - safetyMargin);
        target = clamp(target, minimum, maximum);
      }
      this.buffering = false;
      video.currentTime = target;
      return { cancelled: false, timedOut: false, limited: target !== time };
    }

    async skip(amount, toast = true) {
      if (!this.video || !this.config.get('enabled')) return;
      if (toast) this.showToast(`${amount >= 0 ? '+' : ''}${amount}s`, amount >= 0 ? '⏩' : '⏪');
      return this.bufferAwareSeek(this.video.currentTime + amount);
    }

    changeSpeed(direction) {
      if (!this.video || !this.config.get('enabled')) return;
      const step = Number(this.config.get('speedStep')) || 0.25;
      const next = clamp(
        Number((this.video.playbackRate + direction * step).toFixed(2)),
        Number(this.config.get('minSpeed')),
        Number(this.config.get('maxSpeed'))
      );
      this.video.playbackRate = next;
      this.showToast(`Speed ${next}×`, direction > 0 ? '🚀' : '🐢');
    }

    async toggleAuto() {
      if (!this.config.get('enabled')) return;
      const next = !this.config.get('autoSkipEnabled');
      await this.config.set('autoSkipEnabled', next);
      next ? this.startAutoSkip() : this.stopAutoSkip();
      this.overlay?.querySelector('.svs-auto')?.classList.toggle('svs-active', next);
      this.showToast(`Auto-skip ${next ? 'ON' : 'OFF'}`, next ? '✅' : '⏸');
    }

    startAutoSkip() {
      this.stopAutoSkip();
      const schedule = () => {
        const seconds = Number(this.config.get('autoSkipInterval'));
        if (!seconds || !this.config.get('autoSkipEnabled')) return;
        this.autoTimer = setTimeout(async () => {
          if (this.video && !this.video.paused && !this.video.ended) {
            const wasMuted = this.video.muted;
            if (this.config.get('muteOnSkip')) this.video.muted = true;
            const amount = Number(this.config.get('skipAmount')) || 0;
            await this.skip(amount, false);
            if (this.config.get('muteOnSkip') && this.video) this.video.muted = wasMuted;
            this.flash(`+${amount}s`);
          }
          schedule();
        }, seconds * 1000);
      };
      schedule();
    }

    stopAutoSkip() { clearTimeout(this.autoTimer); this.autoTimer = null; }

    addBookmark() {
      if (!this.video || !this.config.get('enabled')) return;
      const item = { time: this.video.currentTime, label: formatTime(this.video.currentTime) };
      this.bookmarks.push(item);
      this.bookmarks.sort((a, b) => a.time - b.time);
      this.renderBookmarks();
      if (this.config.get('showBookmarkToast')) this.showToast(`Bookmarked ${item.label}`, '🔖');
    }

    renderOverlay() {
      this.overlay = document.createElement('div');
      this.overlay.id = 'svs-overlay';
      this.overlay.innerHTML = `
        <div class="svs-bar">
          <div class="svs-group">
            <button data-action="back"></button>
            <button class="svs-auto" data-action="auto">⚡ AUTO</button>
            <button data-action="forward"></button>
          </div>
          <div class="svs-group svs-middle">
            <span class="svs-time">0:00 / 0:00</span>
            <button data-action="slower">−</button><span class="svs-speed">1.00×</span><button data-action="faster">+</button>
          </div>
          <div class="svs-group">
            <button data-action="bookmark" title="Bookmark">🔖</button>
            <button data-action="move" title="Move top/bottom">↕</button>
            <button data-action="settings" title="Settings">⚙</button>
          </div>
        </div>
        <div class="svs-progress"><i></i><b></b></div>
        <div class="svs-bookmarks"></div><div class="svs-flash"></div>`;
      this.overlay.querySelector('[data-action="back"]').textContent = `↩ ${this.config.get('backSkipAmount')}s`;
      this.overlay.querySelector('[data-action="forward"]').textContent = `↪ ${this.config.get('forwardSkipAmount')}s`;
      this.overlay.querySelector('.svs-auto').classList.toggle('svs-active', this.config.get('autoSkipEnabled'));
      this.overlay.querySelector('.svs-progress').hidden = !this.config.get('showProgressBar');
      document.documentElement.append(this.overlay);
      this.overlay.addEventListener('click', event => {
        const action = event.target.closest('button')?.dataset.action;
        const actions = {
          back: () => this.skip(-Number(this.config.get('backSkipAmount'))),
          forward: () => this.skip(Number(this.config.get('forwardSkipAmount'))),
          auto: () => this.toggleAuto(),
          slower: () => this.changeSpeed(-1),
          faster: () => this.changeSpeed(1),
          bookmark: () => this.addBookmark(),
          move: () => this.quickMove(),
          settings: () => this.openPanel()
        };
        actions[action]?.();
      });
      this.overlay.querySelector('.svs-progress')?.addEventListener('click', event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        this.seek(((event.clientX - bounds.left) / bounds.width) * (this.video?.duration || 0));
      });
      this.renderBookmarks();
      const update = () => {
        if (!this.video || !this.overlay) return;
        const duration = this.video.duration;
        const remaining = Number.isFinite(duration) ? (duration - this.video.currentTime) / (this.video.playbackRate || 1) : NaN;
        this.overlay.querySelector('.svs-time').textContent = `${this.buffering ? '⏳ ' : ''}${formatTime(this.video.currentTime)} / ${formatTime(duration)}${Number.isFinite(remaining) ? ` [-${formatTime(remaining)}]` : ''}`;
        this.overlay.querySelector('.svs-speed').textContent = `${this.video.playbackRate.toFixed(2)}×`;
        const percent = Number.isFinite(duration) && duration > 0 ? this.video.currentTime / duration * 100 : 0;
        const bar = this.overlay.querySelector('.svs-progress i');
        const thumb = this.overlay.querySelector('.svs-progress b');
        if (bar) bar.style.width = `${percent}%`;
        if (thumb) thumb.style.left = `${percent}%`;
        this.raf = requestAnimationFrame(update);
      };
      this.raf = requestAnimationFrame(update);
    }

    detachOverlay() { cancelAnimationFrame(this.raf); this.overlay?.remove(); this.overlay = null; }

    renderBookmarks() {
      const row = this.overlay?.querySelector('.svs-bookmarks');
      if (!row || !this.video) return;
      row.replaceChildren();
      const duration = this.video.duration || 1;
      this.bookmarks.forEach(bookmark => {
        const dot = document.createElement('button');
        dot.className = 'svs-bookmark-dot';
        dot.title = bookmark.label;
        dot.style.left = `${bookmark.time / duration * 100}%`;
        dot.addEventListener('click', () => this.seek(bookmark.time));
        row.append(dot);
      });
    }

    flash(text) {
      const element = this.overlay?.querySelector('.svs-flash');
      if (!element) return;
      element.textContent = text;
      element.classList.remove('svs-flash-in');
      requestAnimationFrame(() => element.classList.add('svs-flash-in'));
    }

    showToast(text, icon) {
      const toast = document.createElement('div');
      toast.className = 'svs-toast';
      const symbol = document.createElement('span');
      symbol.textContent = icon;
      const message = document.createElement('span');
      message.textContent = text;
      toast.append(symbol, message);
      this.toastBox?.append(toast);
      requestAnimationFrame(() => toast.classList.add('svs-toast-in'));
      setTimeout(() => { toast.classList.remove('svs-toast-in'); setTimeout(() => toast.remove(), 250); }, 1800);
    }

    async quickMove() {
      await this.config.set('overlayPosition', this.config.get('overlayPosition') === 'top' ? 'bottom' : 'top');
      this.applyTheme();
      this.showToast(`Moved ${this.config.get('overlayPosition')}`, '↕');
      this.syncPanelValue('overlayPosition');
    }

    onKey(event) {
      if (isEditable(event.target)) return;
      const panelKey = this.config.get('hotkeyPanelToggle');
      if (event.key === panelKey) {
        event.preventDefault(); event.stopImmediatePropagation(); this.togglePanel(); return;
      }
      if (!this.config.get('enabled')) return;
      const actions = new Map([
        [this.config.get('hotkeySkipForward'), () => this.skip(Number(this.config.get('forwardSkipAmount')))],
        [this.config.get('hotkeySkipBack'), () => this.skip(-Number(this.config.get('backSkipAmount')))],
        [this.config.get('hotkeyAutoToggle'), () => this.toggleAuto()],
        [this.config.get('hotkeySpeedUp'), () => this.changeSpeed(1)],
        [this.config.get('hotkeySpeedDown'), () => this.changeSpeed(-1)],
        [this.config.get('hotkeyBookmark'), () => this.addBookmark()]
      ]);
      const action = actions.get(event.key);
      if (action) { event.preventDefault(); event.stopImmediatePropagation(); action(); }
    }

    renderPanel() {
      const fields = [
        ['Enable controls', 'enabled', 'checkbox'], ['Enable auto-skip', 'autoSkipEnabled', 'checkbox'],
        ['Skip amount (seconds)', 'skipAmount', 'number'], ['Interval (seconds)', 'autoSkipInterval', 'number'],
        ['Mute during auto-skip', 'muteOnSkip', 'checkbox'], ['Back skip (seconds)', 'backSkipAmount', 'number'],
        ['Forward skip (seconds)', 'forwardSkipAmount', 'number'], ['Speed step', 'speedStep', 'number'],
        ['Minimum speed', 'minSpeed', 'number'], ['Maximum speed', 'maxSpeed', 'number'],
        ['Forward hotkey', 'hotkeySkipForward', 'text'], ['Back hotkey', 'hotkeySkipBack', 'text'],
        ['Auto hotkey', 'hotkeyAutoToggle', 'text'], ['Speed-up hotkey', 'hotkeySpeedUp', 'text'],
        ['Speed-down hotkey', 'hotkeySpeedDown', 'text'], ['Bookmark hotkey', 'hotkeyBookmark', 'text'],
        ['Panel hotkey', 'hotkeyPanelToggle', 'text'], ['Vertical offset', 'overlayOffset', 'number'],
        ['Overlay opacity', 'overlayOpacity', 'number'], ['Accent color', 'accentColor', 'color'],
        ['Show progress bar', 'showProgressBar', 'checkbox'], ['Bookmark toast', 'showBookmarkToast', 'checkbox'],
        ['Prefer forward buffering', 'preferForwardBuffering', 'checkbox'],
        ['Buffer-aware skipping', 'bufferAwareSkipping', 'checkbox'],
        ['Observe new videos', 'observeNewVideos', 'checkbox']
      ];
      const header = document.createElement('header');
      header.innerHTML = '<strong>⚡ SmartVideoSkipper</strong><button type="button" data-close>✕</button>';
      const form = document.createElement('form');
      for (const [labelText, key, type] of fields) {
        const label = document.createElement('label');
        const span = document.createElement('span');
        span.textContent = labelText;
        const input = document.createElement('input');
        input.type = type;
        input.dataset.key = key;
        if (type === 'checkbox') input.checked = Boolean(this.config.get(key));
        else input.value = this.config.get(key);
        if (type === 'number') input.step = 'any';
        label.append(span, input);
        form.append(label);
      }
      const position = document.createElement('select');
      position.dataset.key = 'overlayPosition';
      for (const value of ['bottom', 'top']) position.add(new Option(value, value, false, this.config.get('overlayPosition') === value));
      const positionLabel = document.createElement('label');
      const positionText = document.createElement('span');
      positionText.textContent = 'Overlay position';
      positionLabel.append(positionText, position);
      form.append(positionLabel);
      const buttons = document.createElement('div');
      buttons.className = 'svs-panel-actions';
      buttons.innerHTML = '<button type="submit">💾 Save</button><button type="button" data-reset>↺ Reset</button>';
      form.append(buttons);
      this.panel.replaceChildren(header, form);
      header.querySelector('[data-close]').addEventListener('click', () => this.closePanel());
      form.querySelector('[data-reset]').addEventListener('click', async () => { await this.config.reset(); location.reload(); });
      form.addEventListener('submit', event => { event.preventDefault(); this.savePanel(form); });
    }

    async savePanel(form) {
      const values = {};
      form.querySelectorAll('[data-key]').forEach(input => {
        values[input.dataset.key] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
      });
      Object.assign(this.config.values, values);
      await api.storage.local.set(values);
      this.applyTheme();
      this.stopAutoSkip();
      this.detachOverlay();
      if (this.config.get('enabled') && this.video) {
        this.renderOverlay();
        if (this.config.get('autoSkipEnabled')) this.startAutoSkip();
      }
      this.showToast('Settings saved', '✅');
      this.closePanel();
    }

    syncPanelValue(key) {
      const input = this.panel?.querySelector(`[data-key="${key}"]`);
      if (input) input.value = this.config.get(key);
    }
    openPanel() { this.panel?.classList.add('svs-panel-open'); }
    closePanel() { this.panel?.classList.remove('svs-panel-open'); }
    togglePanel() { this.panel?.classList.toggle('svs-panel-open'); }
  }

  async function boot() {
    const stored = await api.storage.local.get(Object.keys(DEFAULTS));
    const config = new Config(stored);
    const whitelist = Array.isArray(config.get('whitelistedDomains')) ? config.get('whitelistedDomains') : DEFAULTS.whitelistedDomains;
    if (!whitelist.includes(host)) return;
    new App(config).start();
  }

  boot().catch(error => console.error('[SmartVideoSkipper]', error));
})();
