(() => {
  'use strict';

  const INSTANCE_KEY = '__wineMdVoiceLiteWidget';
  if (window[INSTANCE_KEY]) return;

  const currentScript = document.currentScript;
  if (!currentScript) return;

  const clientId = currentScript.dataset.clientId || '';
  if (!/^[a-z0-9_-]{2,40}$/i.test(clientId)) {
    console.error('[Wine.md Voice Lite] Invalid client id.');
    return;
  }

  const baseUrl = new URL(currentScript.src, window.location.href).origin;
  const host = document.createElement('div');
  host.id = 'wine-md-voice-lite-host';
  host.style.position = 'fixed';
  host.style.right = '20px';
  host.style.bottom = '20px';
  host.style.zIndex = '2147483000';
  host.style.fontFamily = 'Inter, system-ui, sans-serif';

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    .launcher { width: 72px; height: 72px; border-radius: 999px; border: 3px solid #b97445; cursor: pointer; display: block; padding: 0; overflow: hidden; background: #2a0d12; color: white; box-shadow: 0 16px 40px rgba(62, 12, 27, .34), inset 0 0 0 2px rgba(255,236,205,.35); transition: transform .18s ease, box-shadow .18s ease; }
    .launcher img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 24%; display: block; transform: scale(1.08); }
    .launcher::after { content: ''; position: absolute; inset: 0; border-radius: inherit; box-shadow: inset 0 -16px 24px rgba(39,8,16,.18); pointer-events: none; }
    .launcher:hover { transform: translateY(-2px); box-shadow: 0 20px 46px rgba(62, 12, 27, .36); }
    .launcher:focus-visible { outline: 3px solid white; outline-offset: 3px; }
    .panel { position: absolute; right: 0; bottom: 82px; width: min(390px, calc(100vw - 24px)); height: min(690px, calc(100vh - 104px)); border: 0; border-radius: 22px; background: white; box-shadow: 0 24px 80px rgba(35, 16, 22, .28); opacity: 0; transform: translateY(12px) scale(.98); pointer-events: none; transition: opacity .18s ease, transform .18s ease; }
    .panel.open { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
    @media (max-width: 540px) { .panel { position: fixed; right: 10px; left: 10px; bottom: 82px; width: auto; height: min(690px, calc(100vh - 104px)); border-radius: 20px; } .launcher { width: 60px; height: 60px; } }
    @media (prefers-reduced-motion: reduce) { .launcher, .panel { transition: none; } }
  `;

  const launcher = document.createElement('button');
  launcher.className = 'launcher';
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Открыть голосового сомелье');
  launcher.setAttribute('aria-expanded', 'false');
  const launcherImage = document.createElement('img');
  launcherImage.src = `${baseUrl}/widget/launcher-avatar.png`;
  launcherImage.alt = '';
  launcherImage.setAttribute('aria-hidden', 'true');
  launcher.appendChild(launcherImage);

  const iframe = document.createElement('iframe');
  iframe.className = 'panel';
  iframe.title = 'Wine.md AI Sommelier';
  iframe.allow = 'microphone';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  iframe.src = `${baseUrl}/widget/embed.html?clientId=${encodeURIComponent(clientId)}`;

  function setOpen(isOpen) {
    iframe.classList.toggle('open', isOpen);
    launcher.setAttribute('aria-expanded', String(isOpen));
    launcher.setAttribute('aria-label', isOpen ? 'Закрыть голосового сомелье' : 'Открыть голосового сомелье');
  }

  launcher.addEventListener('click', () => {
    setOpen(!iframe.classList.contains('open'));
  });

  window.addEventListener('message', (event) => {
    if (event.origin !== baseUrl) return;
    if (event.data?.type === 'wine-md-voice-lite:close') setOpen(false);
  });

  shadow.append(style, iframe, launcher);
  document.body.append(host);

  window[INSTANCE_KEY] = Object.freeze({ host, open: () => setOpen(true), close: () => setOpen(false) });
})();
