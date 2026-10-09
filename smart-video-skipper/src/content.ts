'use strict';

(() => {
  if (globalThis.__SVS_EXTENSION_LOADED__) return;
  globalThis.__SVS_EXTENSION_LOADED__ = true;

  const { SETTINGS, GROUPS, sanitizeSettings, sanitizeValue, sanitizePartial, getApi, hostFor, isEditable, formatTime, clamp } = globalThis.SVS;
  const api = getApi();
  const host = hostFor(location.href);

  interface Bookmark {
    time: number;
    label: string;
  }

  interface DockRefs {
    root: HTMLElement;
    body: HTMLElement;
    handle: HTMLButtonElement;
    back: HTMLButtonElement;
    forward: HTMLButtonElement;
    auto: HTMLButtonElement;
    time: HTMLElement;
    speed: HTMLElement;
    progress: HTMLElement;
    bar: HTMLElement;
    thumb: HTMLElement;
    bookmarks: HTMLElement;
    flash: HTMLElement;
  }

  const qs = <T extends Element>(root: ParentNode, selector: string): T | null => root.querySelector<T>(selector);

  class Config {
    values: Record<string, unknown>;

    constructor(raw: unknown) {
      this.values = sanitizeSettings(raw);
    }

    get<T = unknown>(key: string): T {
      return this.values[key] as T;
    }

    async set(key: string, value: unknown): Promise<unknown> {
      const clean = sanitizeValue(key, value);
      this.values[key] = clean;
      await api.storage.local.set({ [key]: clean });
      return clean;
    }

    merge(raw: unknown): void {
      Object.assign(this.values, sanitizePartial(raw));
    }

    async reset(): Promise<void> {
      const preserved = { whitelistedDomains: this.values.whitelistedDomains };
      const defaults = sanitizeSettings({});
      this.values = { ...defaults, ...preserved };
      delete defaults.whitelistedDomains;
      await api.storage.local.set(defaults);
    }
  }

  class App {
    config: Config;
    video: HTMLVideoElement | null = null;
    dock: DockRefs | null = null;
    panel: HTMLElement | null = null;
    toastBox: HTMLElement | null = null;
    observer: MutationObserver | null = null;
    autoTimer: ReturnType<typeof setTimeout> | null = null;
    scanTimer: ReturnType<typeof setTimeout> | null = null;
    watchdogTimer: ReturnType<typeof setInterval> | null = null;
    raf: number | null = null;
    active = false;
    bookmarks: Bookmark[] = [];
    private readonly onKeyDown = (event: KeyboardEvent): void => this.onKey(event);
    private readonly onStorageChange = (changes: Record<string, { newValue?: unknown }>): void => this.onStorage(changes);

    constructor(config: Config) {
      this.config = config;
    }

    async start(): Promise<void> {
      this.mountGlobalUI();
      this.applyTheme();
      addEventListener('keydown', this.onKeyDown, true);
      addEventListener('yt-navigate-finish', () => this.scheduleScan(600));
      document.addEventListener('fullscreenchange', () => this.reparent());
      document.addEventListener('pointerdown', event => {
        if (this.isPanelOpen() && this.panel && !this.panel.contains(event.target as Node)) this.closePanel();
      }, true);
      api.storage.onChanged.addListener(this.onStorageChange);
      api.runtime.onMessage.addListener(message => {
        if (message?.type === 'svs:open-settings') this.openPanel();
      });
      if (this.config.get('observeNewVideos')) {
        this.observer = new MutationObserver(() => this.scheduleScan(150));
        this.observer.observe(document.documentElement, { childList: true, subtree: true });
      }
      this.watchdogTimer = setInterval(() => {
        if (!this.video || !document.contains(this.video)) this.scheduleScan(0);
        else this.applyPreloadHint();
      }, 3000);
      this.refresh();
    }

    isActive(): boolean {
      const whitelist = this.config.get('whitelistedDomains');
      return Array.isArray(whitelist) && whitelist.includes(host);
    }

    refresh(): void {
      this.active = this.isActive();
      const enabled = this.active && Boolean(this.config.get('enabled'));
      if (!enabled) {
        this.stopAutoSkip();
        this.detachDock();
        this.detachVideo();
        this.syncPanelAvailability();
        return;
      }
      if (!this.video || !document.contains(this.video)) this.scan();
      if (this.video && !this.dock) this.mountDock();
      this.syncDock();
      if (this.config.get('autoSkipEnabled') && !this.autoTimer) this.startAutoSkip();
      this.syncPanelAvailability();
    }

    mountGlobalUI(): void {
      const toastBox = document.createElement('div');
      toastBox.id = 'svs-toasts';
      toastBox.setAttribute('aria-live', 'polite');
      document.documentElement.append(toastBox);
      this.toastBox = toastBox;

      const panel = document.createElement('section');
      panel.id = 'svs-panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'SmartVideoSkipper settings');
      panel.hidden = true;
      document.documentElement.append(panel);
      this.panel = panel;
      this.renderPanel();
    }

    applyTheme(): void {
      const style = document.documentElement.style;
      style.setProperty('--svs-accent', String(this.config.get('accentColor')));
      style.setProperty('--svs-opacity', String(clamp(Number(this.config.get('overlayOpacity')), 0.3, 1)));
      style.setProperty('--svs-offset', `${Math.max(0, Number(this.config.get('overlayOffset')) || 0)}px`);
      const top = this.config.get('overlayPosition') === 'top';
      this.dock?.root.classList.toggle('svs-at-top', top);
    }

    scheduleScan(delay = 150): void {
      if (this.scanTimer) return;
      this.scanTimer = setTimeout(() => {
        this.scanTimer = null;
        this.scan();
      }, delay);
    }

    scan(): void {
      const videos = [...document.querySelectorAll('video')]
        .filter(video => video.readyState > 0 || video.currentSrc || video.src);
      const playing = videos.filter(video => !video.paused && !video.ended);
      const candidates = playing.length ? playing : videos;
      const best = candidates.reduce<HTMLVideoElement | null>(
        (winner, video) => (!winner || video.clientWidth * video.clientHeight > winner.clientWidth * winner.clientHeight ? video : winner),
        null
      );
      if (best && best !== this.video) {
        this.attach(best);
      } else if (!best && this.video) {
        this.detachVideo();
      } else if (best && !document.contains(best)) {
        this.detachVideo();
      }
    }

    attach(video: HTMLVideoElement): void {
      this.detachVideo();
      this.video = video;
      this.bookmarks = [];
      this.applyPreloadHint();
      if (this.active && this.config.get('enabled')) {
        this.mountDock();
        if (this.config.get('autoSkipEnabled')) this.startAutoSkip();
      }
    }

    detachVideo(): void {
      this.stopAutoSkip();
      this.video = null;
    }

    applyPreloadHint(): void {
      if (!this.video || !this.config.get('enabled') || !this.config.get('preferForwardBuffering')) return;
      this.video.preload = 'auto';
      this.video.setAttribute('preload', 'auto');
    }

    seek(time: number): boolean {
      if (!this.video || !Number.isFinite(time)) return false;
      const duration = Number.isFinite(this.video.duration) ? this.video.duration : Infinity;
      try {
        this.video.currentTime = clamp(time, 0, duration);
        return true;
      } catch {
        return false;
      }
    }

    bufferedRangeAt(time: number): { start: number; end: number } | null {
      const video = this.video;
      if (!video || !Number.isFinite(time)) return null;
      try {
        for (let index = 0; index < video.buffered.length; index += 1) {
          const start = video.buffered.start(index);
          const end = video.buffered.end(index);
          if (start <= time && end > time) return { start, end };
        }
      } catch {
        return null;
      }
      return null;
    }

    bufferAwareSeek(time: number): { moved: boolean; limited: boolean } {
      const video = this.video;
      if (!video || !Number.isFinite(time)) return { moved: false, limited: false };
      const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
      let target = clamp(time, 0, duration);
      if (this.config.get('bufferAwareSkipping')) {
        const range = this.bufferedRangeAt(video.currentTime);
        if (!range) return { moved: false, limited: true };
        const margin = 0.1;
        const minimum = Math.min(video.currentTime, range.start + margin);
        const maximum = Math.max(video.currentTime, range.end - margin);
        target = clamp(target, minimum, maximum);
      }
      if (!this.seek(target)) return { moved: false, limited: false };
      return { moved: true, limited: target !== time };
    }

    skip(amount: number): void {
      if (!this.video || !this.config.get('enabled')) return;
      const value = Number(amount) || 0;
      const result = this.bufferAwareSeek(this.video.currentTime + value);
      if (result.moved && !result.limited) this.showToast(`${value >= 0 ? '+' : ''}${value}s`, value >= 0 ? '⏩' : '⏪');
      else if (result.limited) this.flash(value >= 0 ? `+${value}s` : `${value}s`);
    }

    changeSpeed(direction: number): void {
      if (!this.video || !this.config.get('enabled')) return;
      const step = Number(this.config.get('speedStep')) || 0.25;
      const min = Number(this.config.get('minSpeed'));
      const max = Number(this.config.get('maxSpeed'));
      const next = clamp(
        Number((this.video.playbackRate + direction * step).toFixed(2)),
        Math.min(min, max),
        Math.max(min, max)
      );
      this.video.playbackRate = next;
      this.showToast(`Speed ${next}×`, direction > 0 ? '🚀' : '🐢');
    }

    async toggleAuto(): Promise<void> {
      if (!this.active) return;
      const next = !this.config.get('autoSkipEnabled');
      await this.config.set('autoSkipEnabled', next);
      next ? this.startAutoSkip() : this.stopAutoSkip();
      this.dock?.auto.classList.toggle('svs-active', next);
      this.dock?.auto.setAttribute('aria-pressed', String(next));
      this.showToast(`Auto-skip ${next ? 'ON' : 'OFF'}`, next ? '✅' : '⏸');
    }

    startAutoSkip(): void {
      this.stopAutoSkip();
      if (!this.config.get('autoSkipEnabled')) return;
      const run = (): void => {
        const seconds = Number(this.config.get('autoSkipInterval'));
        if (!this.config.get('autoSkipEnabled') || !this.config.get('enabled') || !seconds || seconds < 1) return;
        this.autoTimer = setTimeout(() => {
          try {
            if (this.video && !this.video.paused && !this.video.ended) {
              const amount = Number(this.config.get('skipAmount')) || 0;
              const wasMuted = this.video.muted;
              if (this.config.get('muteOnSkip')) this.video.muted = true;
              try {
                const result = this.bufferAwareSeek(this.video.currentTime + amount);
                if (result.moved) this.flash(`+${amount}s`);
              } finally {
                if (this.config.get('muteOnSkip') && this.video) this.video.muted = wasMuted;
              }
            }
          } finally {
            run();
          }
        }, seconds * 1000);
      };
      run();
    }

    stopAutoSkip(): void {
      if (this.autoTimer) clearTimeout(this.autoTimer);
      this.autoTimer = null;
    }

    addBookmark(): void {
      if (!this.video || !this.config.get('enabled')) return;
      const time = this.video.currentTime;
      const item: Bookmark = { time, label: formatTime(time) };
      this.bookmarks = [...this.bookmarks.filter(bookmark => Math.abs(bookmark.time - time) > 1), item]
        .sort((a, b) => a.time - b.time);
      this.renderBookmarks();
      if (this.config.get('showBookmarkToast')) this.showToast(`Bookmarked ${item.label}`, '🔖');
    }

    mountDock(): void {
      this.detachDock();
      const root = document.createElement('div');
      root.id = 'svs-overlay';
      root.className = 'svs-dock';
      root.hidden = true;
      root.innerHTML = `
        <button type="button" class="svs-handle" data-action="collapse" aria-expanded="true" aria-label="Collapse controls">⚡</button>
        <div class="svs-body">
          <div class="svs-main">
            <div class="svs-group">
              <button type="button" data-action="back"></button>
              <button type="button" class="svs-auto" data-action="auto" aria-pressed="false" aria-label="Toggle auto-skip">⚡ AUTO</button>
              <button type="button" data-action="forward"></button>
            </div>
            <div class="svs-group svs-speedgroup">
              <button type="button" data-action="slower" aria-label="Slower">−</button>
              <span class="svs-speed">1.00×</span>
              <button type="button" data-action="faster" aria-label="Faster">+</button>
            </div>
            <div class="svs-group">
              <button type="button" data-action="bookmark" title="Add bookmark" aria-label="Add bookmark">🔖</button>
              <button type="button" data-action="move" title="Move dock" aria-label="Move dock">↕</button>
              <button type="button" data-action="settings" title="Settings" aria-label="Settings">⚙</button>
            </div>
          </div>
          <div class="svs-track">
            <div class="svs-progress" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i><b></b></div>
            <div class="svs-bookmarks"></div>
          </div>
          <span class="svs-time">0:00 / 0:00</span>
        </div>
        <div class="svs-flash" aria-live="polite"></div>`;

      this.dock = {
        root,
        body: qs<HTMLElement>(root, '.svs-body')!,
        handle: qs<HTMLButtonElement>(root, '.svs-handle')!,
        back: qs<HTMLButtonElement>(root, '[data-action="back"]')!,
        forward: qs<HTMLButtonElement>(root, '[data-action="forward"]')!,
        auto: qs<HTMLButtonElement>(root, '[data-action="auto"]')!,
        time: qs<HTMLElement>(root, '.svs-time')!,
        speed: qs<HTMLElement>(root, '.svs-speed')!,
        progress: qs<HTMLElement>(root, '.svs-progress')!,
        bar: qs<HTMLElement>(root, '.svs-progress i')!,
        thumb: qs<HTMLElement>(root, '.svs-progress b')!,
        bookmarks: qs<HTMLElement>(root, '.svs-bookmarks')!,
        flash: qs<HTMLElement>(root, '.svs-flash')!
      };

      root.addEventListener('click', event => {
        const action = (event.target as Element).closest('button')?.getAttribute('data-action');
        const actions: Record<string, () => void> = {
          back: () => this.skip(-Number(this.config.get('backSkipAmount'))),
          forward: () => this.skip(Number(this.config.get('forwardSkipAmount'))),
          auto: () => void this.toggleAuto(),
          slower: () => this.changeSpeed(-1),
          faster: () => this.changeSpeed(1),
          bookmark: () => this.addBookmark(),
          move: () => void this.quickMove(),
          settings: () => this.togglePanel(),
          collapse: () => void this.toggleCollapsed()
        };
        if (action && actions[action]) actions[action]();
      });
      this.bindProgress();
      this.appendDockRoot(root);
      this.syncDock();
      this.renderBookmarks();
      this.startTicker();
    }

    appendDockRoot(root: HTMLElement): void {
      const fullscreen = document.fullscreenElement;
      if (fullscreen && fullscreen.tagName !== 'VIDEO') fullscreen.append(root);
      else document.documentElement.append(root);
    }

    reparent(): void {
      if (this.dock) this.appendDockRoot(this.dock.root);
    }

    detachDock(): void {
      if (this.raf !== null) cancelAnimationFrame(this.raf);
      this.raf = null;
      this.dock?.root.remove();
      this.dock = null;
    }

    syncDock(): void {
      if (!this.dock) return;
      const collapsed = Boolean(this.config.get('dockCollapsed'));
      this.dock.root.classList.toggle('svs-collapsed', collapsed);
      this.dock.handle.setAttribute('aria-expanded', String(!collapsed));
      this.dock.back.textContent = `↩ ${this.config.get('backSkipAmount')}s`;
      this.dock.forward.textContent = `↪ ${this.config.get('forwardSkipAmount')}s`;
      this.dock.auto.classList.toggle('svs-active', Boolean(this.config.get('autoSkipEnabled')));
      this.dock.auto.setAttribute('aria-pressed', String(Boolean(this.config.get('autoSkipEnabled'))));
      this.dock.root.classList.toggle('svs-no-progress', !this.config.get('showProgressBar'));
      this.dock.root.hidden = false;
    }

    async toggleCollapsed(): Promise<void> {
      await this.config.set('dockCollapsed', !this.config.get('dockCollapsed'));
      this.syncDock();
    }

    bindProgress(): void {
      const progress = this.dock?.progress;
      if (!progress) return;
      const seekFromEvent = (event: PointerEvent): void => {
        if (!this.video || !Number.isFinite(this.video.duration) || this.video.duration <= 0) return;
        const bounds = progress.getBoundingClientRect();
        const ratio = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
        this.seek(ratio * this.video.duration);
      };
      progress.addEventListener('pointerdown', event => {
        progress.setPointerCapture(event.pointerId);
        seekFromEvent(event);
      });
      progress.addEventListener('pointermove', event => {
        if (progress.hasPointerCapture(event.pointerId)) seekFromEvent(event);
      });
      progress.addEventListener('keydown', event => {
        if (!this.video || !Number.isFinite(this.video.duration)) return;
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.seek(this.video.currentTime + (event.key === 'ArrowRight' ? 5 : -5));
      });
    }

    startTicker(): void {
      if (this.raf !== null) cancelAnimationFrame(this.raf);
      const update = (): void => {
        const video = this.video;
        const dock = this.dock;
        if (!video || !dock) return;
        const { duration, currentTime, playbackRate } = video;
        const remaining = Number.isFinite(duration) ? (duration - currentTime) / (playbackRate || 1) : NaN;
        const timeText = `${formatTime(currentTime)} / ${formatTime(duration)}${Number.isFinite(remaining) ? ` [-${formatTime(remaining)}]` : ''}`;
        if (dock.time.textContent !== timeText) dock.time.textContent = timeText;
        const speedText = `${playbackRate.toFixed(2)}×`;
        if (dock.speed.textContent !== speedText) dock.speed.textContent = speedText;
        const percent = Number.isFinite(duration) && duration > 0 ? (currentTime / duration) * 100 : 0;
        dock.bar.style.width = `${percent}%`;
        dock.thumb.style.left = `${percent}%`;
        dock.progress.setAttribute('aria-valuenow', String(Math.round(percent)));
        this.raf = requestAnimationFrame(update);
      };
      this.raf = requestAnimationFrame(update);
    }

    renderBookmarks(): void {
      const row = this.dock?.bookmarks;
      if (!row || !this.video) return;
      row.replaceChildren();
      const duration = Number.isFinite(this.video.duration) && this.video.duration > 0 ? this.video.duration : 1;
      for (const bookmark of this.bookmarks) {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'svs-bookmark-dot';
        dot.title = bookmark.label;
        dot.setAttribute('aria-label', `Seek to bookmark ${bookmark.label}`);
        dot.style.left = `${clamp((bookmark.time / duration) * 100, 0, 100)}%`;
        dot.addEventListener('click', () => this.seek(bookmark.time));
        row.append(dot);
      }
    }

    flash(text: string): void {
      const element = this.dock?.flash;
      if (!element) return;
      element.textContent = text;
      element.classList.remove('svs-flash-in');
      requestAnimationFrame(() => element.classList.add('svs-flash-in'));
    }

    showToast(text: string, icon: string): void {
      if (!this.toastBox) return;
      const toast = document.createElement('div');
      toast.className = 'svs-toast';
      const symbol = document.createElement('span');
      symbol.textContent = icon;
      const message = document.createElement('span');
      message.textContent = text;
      toast.append(symbol, message);
      this.toastBox.append(toast);
      while (this.toastBox.childElementCount > 4) this.toastBox.firstElementChild?.remove();
      requestAnimationFrame(() => toast.classList.add('svs-toast-in'));
      setTimeout(() => {
        toast.classList.remove('svs-toast-in');
        setTimeout(() => toast.remove(), 250);
      }, 1800);
    }

    async quickMove(): Promise<void> {
      await this.config.set('overlayPosition', this.config.get('overlayPosition') === 'top' ? 'bottom' : 'top');
      this.applyTheme();
      this.showToast(`Moved ${this.config.get('overlayPosition')}`, '↕');
      this.syncPanelValue('overlayPosition');
    }

    hotkeyMap(): Map<string, () => void> {
      const config = this.config;
      return new Map<string, () => void>([
        [String(config.get('hotkeySkipForward')), () => this.skip(Number(config.get('forwardSkipAmount')))],
        [String(config.get('hotkeySkipBack')), () => this.skip(-Number(config.get('backSkipAmount')))],
        [String(config.get('hotkeyAutoToggle')), () => void this.toggleAuto()],
        [String(config.get('hotkeySpeedUp')), () => this.changeSpeed(1)],
        [String(config.get('hotkeySpeedDown')), () => this.changeSpeed(-1)],
        [String(config.get('hotkeyBookmark')), () => this.addBookmark()]
      ]);
    }

    onKey(event: KeyboardEvent): void {
      if (isEditable(event.target)) return;
      const panelKey = String(this.config.get('hotkeyPanelToggle'));
      if (panelKey && event.key === panelKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.togglePanel();
        return;
      }
      if (event.key === 'Escape' && this.isPanelOpen()) {
        this.closePanel();
        return;
      }
      if (!this.active || !this.config.get('enabled')) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const action = this.hotkeyMap().get(event.key);
      if (action) {
        event.preventDefault();
        event.stopImmediatePropagation();
        action();
      }
    }

    renderPanel(): void {
      if (!this.panel) return;
      const header = document.createElement('header');
      const title = document.createElement('strong');
      title.textContent = '⚡ SmartVideoSkipper';
      const close = document.createElement('button');
      close.type = 'button';
      close.dataset.close = '';
      close.setAttribute('aria-label', 'Close settings');
      close.textContent = '✕';
      header.append(title, close);

      const form = document.createElement('form');
      for (const group of GROUPS) {
        const fieldset = document.createElement('fieldset');
        const legend = document.createElement('legend');
        legend.textContent = group.title;
        fieldset.append(legend);
        for (const key of group.fields) fieldset.append(this.buildField(key));
        form.append(fieldset);
      }

      const actions = document.createElement('div');
      actions.className = 'svs-panel-actions';
      const save = document.createElement('button');
      save.type = 'submit';
      save.textContent = '💾 Save';
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.dataset.reset = '';
      reset.textContent = '↺ Reset';
      actions.append(save, reset);
      form.append(actions);

      this.panel.replaceChildren(header, form);
      close.addEventListener('click', () => this.closePanel());
      reset.addEventListener('click', () => void this.resetPanel());
      form.addEventListener('submit', event => {
        event.preventDefault();
        void this.savePanel(form);
      });
    }

    buildField(key: string): HTMLLabelElement {
      const spec = SETTINGS[key];
      const label = document.createElement('label');
      const text = document.createElement('span');
      text.textContent = spec.label ?? key;
      label.append(text);

      let input: HTMLInputElement | HTMLSelectElement;
      if (spec.type === 'select') {
        const select = document.createElement('select');
        for (const option of spec.options ?? []) {
          const element = document.createElement('option');
          element.value = option;
          element.textContent = option;
          select.append(element);
        }
        select.value = String(this.config.get(key));
        input = select;
      } else {
        const element = document.createElement('input');
        element.type = spec.type === 'boolean' ? 'checkbox'
          : spec.type === 'number' ? 'number'
            : spec.type === 'color' ? 'color'
              : 'text';
        if (spec.type === 'boolean') element.checked = Boolean(this.config.get(key));
        else element.value = String(this.config.get(key));
        if (spec.type === 'number') {
          element.min = String(spec.min ?? '');
          element.max = String(spec.max ?? '');
          element.step = String(spec.step ?? 'any');
        }
        input = element;
      }
      input.dataset.key = key;
      label.append(input);
      return label;
    }

    async savePanel(form: HTMLFormElement): Promise<void> {
      const raw: Record<string, unknown> = {};
      form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]').forEach(input => {
        raw[input.dataset.key as string] = input.type === 'checkbox' ? (input as HTMLInputElement).checked : input.value;
      });
      const values = sanitizePartial(raw);
      this.config.merge(values);
      await api.storage.local.set(values);
      this.applyAfterSettingsChange();
      this.renderPanel();
      this.showToast('Settings saved', '✅');
      this.closePanel();
    }

    async resetPanel(): Promise<void> {
      await this.config.reset();
      this.applyAfterSettingsChange();
      this.renderPanel();
      this.showToast('Settings reset', '↺');
    }

    applyAfterSettingsChange(): void {
      this.applyTheme();
      this.stopAutoSkip();
      this.detachDock();
      this.refresh();
    }

    syncPanelValue(key: string): void {
      const input = this.panel?.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-key="${key}"]`);
      if (!input) return;
      if (input.type === 'checkbox') (input as HTMLInputElement).checked = Boolean(this.config.get(key));
      else input.value = String(this.config.get(key));
    }

    syncPanelAvailability(): void {
      const disabled = !this.active;
      this.panel?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]').forEach(input => {
        input.disabled = disabled && input.dataset.key !== 'enabled' && input.dataset.key !== 'autoSkipEnabled';
      });
    }

    isPanelOpen(): boolean {
      return Boolean(this.panel && !this.panel.hidden);
    }

    openPanel(): void {
      if (!this.panel) return;
      if (!this.active) {
        this.showToast('Enable this site first', '⚠️');
        return;
      }
      this.panel.hidden = false;
      this.panel.classList.add('svs-panel-open');
      this.panel.querySelector<HTMLElement>('input, select, button')?.focus();
    }

    closePanel(): void {
      if (!this.panel) return;
      this.panel.hidden = true;
      this.panel.classList.remove('svs-panel-open');
    }

    togglePanel(): void {
      this.isPanelOpen() ? this.closePanel() : this.openPanel();
    }

    onStorage(changes: Record<string, { newValue?: unknown }>): void {
      const relevant = Object.keys(changes).filter(key => Object.hasOwn(SETTINGS, key));
      if (!relevant.length) return;
      const raw: Record<string, unknown> = {};
      for (const key of relevant) raw[key] = changes[key].newValue;
      this.config.merge(raw);
      this.applyTheme();
      if (relevant.some(key => ['overlayPosition', 'overlayOffset', 'overlayOpacity', 'accentColor', 'enabled', 'whitelistedDomains'].includes(key))) {
        this.refresh();
      }
      this.syncDock();
      if (relevant.includes('autoSkipEnabled')) {
        if (this.config.get('autoSkipEnabled')) this.startAutoSkip();
        else this.stopAutoSkip();
      }
      if (this.isPanelOpen()) {
        for (const key of relevant) this.syncPanelValue(key);
      }
    }
  }

  async function boot(): Promise<void> {
    const stored = await api.storage.local.get(null);
    const config = new Config(stored);
    await new App(config).start();
  }

  boot().catch(error => console.error('[SmartVideoSkipper]', error));
})();
