import { curve, decode, encode, fingerprint, releaseKey } from './crypto.js';

const installation = document.getElementById('installation');
const pairing = document.getElementById('pairing');
const createKey = document.getElementById('create-key');
const publicKeyField = document.getElementById('public-key');
const codePanel = document.getElementById('pairing-code');
const retry = document.getElementById('retry');
const status = document.getElementById('status');
const releaseUrl = new URL('./release.json', import.meta.url);
const revisionUrl = new URL('./revision.json', import.meta.url);
const releaseCache = 'wavebox-iphone-release-v1';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('wavebox-iphone-device-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('keys');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function storedKey(database) {
  return new Promise((resolve, reject) => {
    const request = database.transaction('keys').objectStore('keys').get('device');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function saveKey(database, keyPair) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('keys', 'readwrite');
    transaction.objectStore('keys').add(keyPair, 'device');
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
  });
}

async function timedFetch(url, wait) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), wait);
  try {
    return await fetch(url, { cache: 'no-store', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function retrieveRelease() {
  const cache = await caches.open(releaseCache).catch(() => null);
  const cached = await cache?.match(releaseUrl).catch(() => null);
  const fallback = cached ? { response: cached, cache, fromCache: true } : null;
  if (fallback && !navigator.onLine) return fallback;

  try {
    const probe = new URL(revisionUrl);
    probe.searchParams.set('t', String(Date.now()));
    const revisionResponse = await timedFetch(probe, 4500);
    const revision = revisionResponse.ok ? await revisionResponse.json() : null;
    const digest = /^[\w-]{43}$/.test(revision?.sha256) ? revision.sha256 : null;
    const previousRevision = await cache?.match(revisionUrl);
    if (fallback && (!digest || digest === (await previousRevision?.json())?.sha256)) return fallback;

    const onlineUrl = new URL(releaseUrl);
    onlineUrl.searchParams.set('v', digest || String(Date.now()));
    const response = await timedFetch(onlineUrl, 12000);
    if (!response.ok) return fallback;
    if (digest) {
      const contents = await response.clone().arrayBuffer();
      const actual = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', contents)));
      if (actual !== digest) return fallback;
    }
    return { response, cache, revision: digest ? revision : null };
  } catch {
    return fallback;
  }
}

async function renderPlayer(payload) {
  const markup = document.createElement('template');
  markup.innerHTML = payload.html;
  const style = document.createElement('style');
  style.textContent = payload.css;
  document.getElementById('setup-style').replaceWith(style);
  document.body.replaceChildren(markup.content);

  const scriptUrl = URL.createObjectURL(new Blob([payload.script], { type: 'text/javascript' }));
  const script = document.createElement('script');
  script.src = scriptUrl;
  try {
    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = () => reject(new Error('Не удалось запустить плеер.'));
      document.body.append(script);
    });
  } finally {
    URL.revokeObjectURL(scriptUrl);
  }
}

async function checkRelease(keyPair, rawPublicKey) {
  retry.disabled = true;
  status.textContent = 'Проверяю активацию…';
  try {
    const entry = await retrieveRelease();
    if (!entry) {
      status.textContent = 'Для первого запуска понадобится интернет.';
      return;
    }

    const release = await entry.response.clone().json();
    if (release.status === 'pending') {
      status.textContent = 'Плеер ждёт привязки к этой установке.';
      return;
    }
    if (release.version !== 1 || release.recipient !== await fingerprint(rawPublicKey)) {
      status.textContent = 'Этой установке нужен выпуск, зашифрованный по её коду.';
      return;
    }

    const key = await releaseKey(keyPair.privateKey, decode(release.ephemeral), decode(release.salt), 'decrypt');
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(release.iv) }, key, decode(release.ciphertext));
    const payload = JSON.parse(new TextDecoder().decode(decrypted));
    if (![payload.html, payload.css, payload.script].every(value => typeof value === 'string' && value)) {
      throw new Error('Повреждён выпуск Wavebox.');
    }
    let offlineReady = Boolean(entry.fromCache);
    try {
      if (entry.cache && !entry.fromCache) {
        // Drop the old comparison value before replacing the encrypted body.
        await entry.cache.delete(revisionUrl);
        await entry.cache.put(releaseUrl, entry.response);
        offlineReady = true;
        if (entry.revision) await entry.cache.put(revisionUrl, Response.json(entry.revision));
      }
    } catch {
      // Playback can still start when offline storage is unavailable.
    }
    await renderPlayer(payload);
    if (!offlineReady) document.getElementById('message').textContent = 'Не удалось сохранить плеер для работы без интернета.';
  } catch {
    const playerMessage = document.getElementById('message');
    (playerMessage || status).textContent = 'Не удалось открыть плеер. Проверь интернет и попробуй ещё раз.';
  } finally {
    retry.disabled = false;
  }
}

async function showKey(keyPair) {
  const rawPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
  createKey.hidden = true;
  publicKeyField.value = `WB1.${encode(rawPublicKey)}`;
  codePanel.hidden = false;
  retry.onclick = () => checkRelease(keyPair, rawPublicKey);
  await checkRelease(keyPair, rawPublicKey);
}

document.getElementById('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(publicKeyField.value);
    status.textContent = 'Код скопирован.';
  } catch {
    publicKeyField.focus();
    publicKeyField.select();
    publicKeyField.setSelectionRange(0, publicKeyField.value.length);
    status.textContent = 'Скопируй выделенный код.';
  }
});

async function initialize() {
  if (!(navigator.standalone === true || matchMedia('(display-mode: standalone)').matches)) return;

  installation.hidden = true;
  pairing.hidden = false;
  createKey.disabled = true;
  navigator.serviceWorker?.register('./sw.js').catch(() => {});
  const database = await openDatabase();
  const existing = await storedKey(database);
  if (existing) return showKey(existing);

  createKey.disabled = false;
  createKey.addEventListener('click', async () => {
    createKey.disabled = true;
    try {
      const keyPair = await crypto.subtle.generateKey(curve, false, ['deriveBits']);
      await saveKey(database, keyPair);
      await showKey(keyPair);
    } catch {
      status.textContent = 'Не удалось сохранить ключ. Закрой Wavebox и открой снова с иконки.';
      createKey.disabled = false;
    }
  });
}

initialize().catch(() => {
  status.textContent = 'Хранилище приложения недоступно. Закрой Wavebox и открой снова с иконки.';
});
