'use strict';

(() => {
  const { sanitizeSettings, getApi, hostFor } = globalThis.SVS;
  const api = getApi();

  const el = <T extends HTMLElement>(selector: string): T => {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing popup element: ${selector}`);
    return element;
  };

  const setStatus = (text: string, tone: '' | 'ok' | 'error' = ''): void => {
    const status = el<HTMLElement>('#status');
    status.textContent = text;
    status.dataset.tone = tone;
  };

  async function init(): Promise<void> {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    const host = hostFor(tab?.url ?? '');
    const site = el<HTMLElement>('#site');
    const allowed = el<HTMLInputElement>('#allowed');
    const enabled = el<HTMLInputElement>('#enabled');
    const settings = el<HTMLButtonElement>('#settings');

    const stored = sanitizeSettings(await api.storage.local.get(['whitelistedDomains', 'enabled']));
    let whitelist = stored.whitelistedDomains as string[];

    site.textContent = host || 'This browser page cannot be modified';
    site.title = tab?.url ?? '';
    allowed.checked = Boolean(host) && whitelist.includes(host);
    enabled.checked = Boolean(stored.enabled);
    allowed.disabled = !host;
    settings.disabled = !allowed.checked || !tab?.id;

    allowed.addEventListener('change', async () => {
      whitelist = allowed.checked
        ? [...new Set([...whitelist, host])]
        : whitelist.filter(item => item !== host);
      await api.storage.local.set({ whitelistedDomains: whitelist });
      settings.disabled = !allowed.checked || !tab?.id;
      setStatus(allowed.checked ? 'Site enabled' : 'Site disabled', 'ok');
    });

    enabled.addEventListener('change', async () => {
      await api.storage.local.set({ enabled: enabled.checked });
      setStatus(enabled.checked ? 'Controls enabled' : 'Controls disabled', 'ok');
    });

    settings.addEventListener('click', async () => {
      if (!tab?.id) return;
      try {
        await api.tabs.sendMessage(tab.id, { type: 'svs:open-settings' });
        window.close();
      } catch {
        setStatus('Reload this page, then try again.', 'error');
      }
    });
  }

  init().catch(error => setStatus(error instanceof Error ? error.message : String(error), 'error'));
})();
