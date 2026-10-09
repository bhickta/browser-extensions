'use strict';

(() => {
  const DEFAULT_WHITELIST: string[] = [
    'www.youtube.com', 'youtube.com', 'youtu.be', 'player.vimeo.com',
    'vimeo.com', 'www.twitch.tv', 'www.dailymotion.com', 'www.netflix.com',
    'www.primevideo.com', 'www.hotstar.com', 'www.zee5.com',
    'www.sonyliv.com', 'mxplayer.in', 'www.mxplayer.in', 'LOCAL_FILE'
  ];

  const register = (
    type: SettingType,
    value: unknown,
    label: string,
    group: SettingsGroup['title'],
    extra: Partial<SettingSpec> = {}
  ): SettingSpec => ({ type, default: value, label, group, ...extra });

  const SETTINGS: Record<string, SettingSpec> = {
    whitelistedDomains: { type: 'list', default: DEFAULT_WHITELIST },
    enabled: register('boolean', false, 'Enable video controls', 'Core'),
    autoSkipEnabled: register('boolean', false, 'Enable auto-skip', 'Core'),
    observeNewVideos: register('boolean', true, 'Watch for new videos', 'Core'),
    skipAmount: register('number', 60, 'Auto-skip amount (s)', 'Skipping', { min: 1, max: 36000, step: 1 }),
    autoSkipInterval: register('number', 10, 'Auto-skip interval (s)', 'Skipping', { min: 1, max: 3600, step: 1 }),
    backSkipAmount: register('number', 10, 'Back skip (s)', 'Skipping', { min: 1, max: 36000, step: 1 }),
    forwardSkipAmount: register('number', 10, 'Forward skip (s)', 'Skipping', { min: 1, max: 36000, step: 1 }),
    muteOnSkip: register('boolean', false, 'Mute during auto-skip', 'Skipping'),
    bufferAwareSkipping: register('boolean', true, 'Buffer-aware skipping', 'Skipping'),
    preferForwardBuffering: register('boolean', true, 'Prefer forward buffering', 'Skipping'),
    speedStep: register('number', 0.25, 'Speed step', 'Speed', { min: 0.05, max: 1, step: 0.05 }),
    minSpeed: register('number', 0.25, 'Minimum speed', 'Speed', { min: 0.1, max: 4, step: 0.05 }),
    maxSpeed: register('number', 4, 'Maximum speed', 'Speed', { min: 0.5, max: 16, step: 0.05 }),
    hotkeySkipForward: register('hotkey', 'ArrowRight', 'Forward skip key', 'Hotkeys'),
    hotkeySkipBack: register('hotkey', 'ArrowLeft', 'Back skip key', 'Hotkeys'),
    hotkeyAutoToggle: register('hotkey', 'a', 'Auto-skip toggle key', 'Hotkeys'),
    hotkeySpeedUp: register('hotkey', ']', 'Speed up key', 'Hotkeys'),
    hotkeySpeedDown: register('hotkey', '[', 'Speed down key', 'Hotkeys'),
    hotkeyBookmark: register('hotkey', 'b', 'Bookmark key', 'Hotkeys'),
    hotkeyPanelToggle: register('hotkey', '`', 'Settings panel key', 'Hotkeys'),
    overlayPosition: register('select', 'bottom', 'Dock position', 'Overlay', { options: ['bottom', 'top'] }),
    overlayOffset: register('number', 0, 'Vertical offset (px)', 'Overlay', { min: 0, max: 500, step: 1 }),
    overlayOpacity: register('number', 0.92, 'Dock opacity', 'Overlay', { min: 0.3, max: 1, step: 0.01 }),
    accentColor: register('color', '#00e5ff', 'Accent color', 'Overlay'),
    showProgressBar: register('boolean', true, 'Show progress bar', 'Overlay'),
    showBookmarkToast: register('boolean', true, 'Show bookmark toast', 'Overlay'),
    dockCollapsed: register('boolean', false, 'Start collapsed', 'Overlay')
  };

  const GROUP_ORDER: SettingsGroup['title'][] = ['Core', 'Skipping', 'Speed', 'Hotkeys', 'Overlay'];

  const DEFAULTS: Record<string, unknown> = Object.fromEntries(
    Object.entries(SETTINGS).map(([key, spec]) => [key, Array.isArray(spec.default) ? [...spec.default] : spec.default])
  );

  const GROUPS: SettingsGroup[] = GROUP_ORDER
    .map(title => ({
      title,
      fields: Object.entries(SETTINGS).filter(([, spec]) => spec.group === title).map(([key]) => key)
    }))
    .filter(group => group.fields.length > 0);

  const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

  const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

  const copyDefault = (spec: SettingSpec): unknown =>
    Array.isArray(spec.default) ? [...spec.default] : spec.default;

  function sanitizeValue(key: string, value: unknown): unknown {
    const spec = SETTINGS[key];
    if (!spec) return undefined;
    if (value === undefined || value === null) return copyDefault(spec);
    switch (spec.type) {
      case 'boolean':
        return typeof value === 'boolean' ? value : spec.default;
      case 'number': {
        const number = Number(value);
        return Number.isFinite(number) ? clamp(number, spec.min ?? number, spec.max ?? number) : spec.default;
      }
      case 'hotkey':
        return typeof value === 'string' && value.trim() ? value.trim() : spec.default;
      case 'color':
        return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : spec.default;
      case 'select':
        return spec.options?.includes(String(value)) ? String(value) : spec.default;
      case 'list':
        if (!Array.isArray(value)) return copyDefault(spec);
        return [...new Set(value.filter(item => typeof item === 'string' && item.trim()).map(item => String(item).trim()))];
      default:
        return typeof value === 'string' ? value : spec.default;
    }
  }

  function sanitizeSettings(raw: unknown): Record<string, unknown> {
    const source = isPlainObject(raw) ? raw : {};
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(SETTINGS)) out[key] = sanitizeValue(key, source[key]);
    return out;
  }

  function sanitizePartial(raw: unknown): Record<string, unknown> {
    const source = isPlainObject(raw) ? raw : {};
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      if (Object.hasOwn(SETTINGS, key)) out[key] = sanitizeValue(key, source[key]);
    }
    return out;
  }

  const getApi = (): SvsWebExtApi => (globalThis.browser ?? globalThis.chrome) as SvsWebExtApi;

  const hostFor = (url: string): string => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'file:' ? 'LOCAL_FILE' : parsed.hostname;
    } catch {
      return '';
    }
  };

  const isEditable = (element: EventTarget | null): boolean => {
    const node = element as HTMLElement | null;
    return Boolean(node?.isContentEditable) || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node?.tagName ?? '');
  };

  const formatTime = (value: number): string => {
    if (!Number.isFinite(value) || value < 0) return '0:00';
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const seconds = Math.floor(value % 60);
    return hours
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  globalThis.SVS = Object.freeze({
    SETTINGS,
    GROUPS,
    DEFAULTS,
    sanitizeValue,
    sanitizeSettings,
    sanitizePartial,
    getApi,
    hostFor,
    isEditable,
    formatTime,
    clamp
  });
})();
