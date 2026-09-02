(() => {
  'use strict';

  const api = globalThis.browser ?? globalThis.chrome;
  const DEFAULTS = {
    whitelistedDomains: [
      'www.youtube.com', 'youtube.com', 'youtu.be', 'player.vimeo.com',
      'vimeo.com', 'www.twitch.tv', 'www.dailymotion.com', 'www.netflix.com',
      'www.primevideo.com', 'www.hotstar.com', 'www.zee5.com',
      'www.sonyliv.com', 'mxplayer.in', 'www.mxplayer.in', 'LOCAL_FILE'
    ],
    enabled: false
  };

  const get = keys => api.storage.local.get(keys);
  const set = values => api.storage.local.set(values);
  const queryTabs = query => api.tabs.query(query);
  const reload = id => api.tabs.reload(id);
  const send = (id, message) => api.tabs.sendMessage(id, message);

  const hostFor = url => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'file:' ? 'LOCAL_FILE' : parsed.hostname;
    } catch { return ''; }
  };

  async function init() {
    const [tab] = await queryTabs({ active: true, currentWindow: true });
    const host = hostFor(tab?.url || '');
    const site = document.querySelector('#site');
    const allowed = document.querySelector('#allowed');
    const enabled = document.querySelector('#enabled');
    const settings = document.querySelector('#settings');
    const status = document.querySelector('#status');
    const stored = await get(['whitelistedDomains', 'enabled']);
    let whitelist = Array.isArray(stored.whitelistedDomains)
      ? stored.whitelistedDomains
      : [...DEFAULTS.whitelistedDomains];

    site.textContent = host || 'This browser page cannot be modified';
    allowed.checked = Boolean(host && whitelist.includes(host));
    enabled.checked = stored.enabled ?? DEFAULTS.enabled;
    allowed.disabled = !host;
    settings.disabled = !allowed.checked || !tab?.id;

    allowed.addEventListener('change', async () => {
      whitelist = allowed.checked
        ? [...new Set([...whitelist, host])]
        : whitelist.filter(item => item !== host);
      await set({ whitelistedDomains: whitelist });
      status.textContent = allowed.checked ? 'Site enabled; reloading…' : 'Site disabled; reloading…';
      settings.disabled = !allowed.checked;
      if (tab?.id) await reload(tab.id);
    });

    enabled.addEventListener('change', async () => {
      await set({ enabled: enabled.checked });
      status.textContent = enabled.checked ? 'Controls enabled; reloading…' : 'Controls disabled; reloading…';
      if (tab?.id) await reload(tab.id);
    });

    settings.addEventListener('click', async () => {
      try {
        await send(tab.id, { type: 'svs:open-settings' });
        window.close();
      } catch {
        status.textContent = 'Reload this page, then try again.';
      }
    });
  }

  init().catch(error => {
    document.querySelector('#status').textContent = error.message;
  });
})();
