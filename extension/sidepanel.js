const MAX_CHARS = 50000;
const PREVIEW_CHARS = 500;
const MIN_MAIN_CHARS = 200;
const MAX_LINKS = 100;
const SERVER_URL = 'http://127.0.0.1:8787';
const SERVER_CHECK_MS = 5000;
const JOB_CHECK_MS = 5000;

const serverStatusEl = document.getElementById('server-status');
const serverSetupEl = document.getElementById('server-setup');
const extensionIdEl = document.getElementById('extension-id');
const tokenForm = document.getElementById('token-form');
const tokenInput = document.getElementById('token-input');
const titleEl = document.getElementById('page-title');
const urlEl = document.getElementById('page-url');
const knownInput = document.getElementById('known-input');
const analyzeButton = document.getElementById('analyze-button');
const readButton = document.getElementById('read-button');
const analysisStatusEl = document.getElementById('analysis-status');
const reportEl = document.getElementById('report');
const reportMetaEl = document.getElementById('report-meta');
const reportTextEl = document.getElementById('report-text');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const countEl = document.getElementById('result-count');
const previewEl = document.getElementById('result-preview');
const extraEl = document.getElementById('result-extra');

let currentTab = null;

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
  statusEl.hidden = false;
}

function setAnalysisStatus(text, kind) {
  analysisStatusEl.textContent = text;
  analysisStatusEl.className = `status ${kind}`;
  analysisStatusEl.hidden = false;
}

function clearResult() {
  statusEl.hidden = true;
  resultEl.hidden = true;
}

function isSamePage(a, b) {
  return a?.id === b?.id && a?.url === b?.url;
}

async function showCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // Прочитаний текст стосується лише тієї сторінки, з якої його взяли.
  if (!isSamePage(tab, currentTab)) clearResult();
  currentTab = tab;
  // textContent, а не innerHTML: заголовок сторінки — чужі дані.
  titleEl.textContent = tab?.title || 'Немає активної вкладки';
  urlEl.textContent = tab?.url || '';
}

// Виконується всередині сторінки, тому не може звертатися до змінних панелі.
function readPage(limit, minMainChars, maxLinks) {
  const bodyText = (document.body?.innerText || '').trim();
  const mainEl = document.querySelector('main');
  const mainText = (mainEl?.innerText || '').trim();

  // Залогінений Instagram показує дані акаунта: повідомлення, меню, спільних підписників.
  // Тому там беремо лише основний вміст профілю.
  const isInstagram = /(^|\.)instagram\.com$/.test(location.hostname);
  const mutualText = isInstagram
    ? (mainEl?.querySelector('a[href*="/followers/mutual"]')?.innerText || '').trim()
    : '';
  const scope = isInstagram ? mainEl : document;

  let text;
  if (isInstagram) {
    text = mutualText ? mainText.replace(mutualText, '').trim() : mainText;
  } else {
    // Основний вміст без меню, якщо сайт його позначив і в ньому є достатньо тексту.
    text = mainText.length >= minMainChars ? mainText : bodyText;
  }

  // Посилання беремо з усієї сторінки: кнопки-значки соцмереж не мають видимого тексту.
  const seen = new Set();
  const links = [];
  for (const anchor of scope?.querySelectorAll('a[href]') ?? []) {
    const { href } = anchor;
    if (!/^https?:\/\//.test(href) || seen.has(href) || href.includes('/followers/mutual')) continue;
    seen.add(href);
    links.push({
      href: href.slice(0, 500),
      label: (
        anchor.innerText
        || anchor.getAttribute('aria-label')
        || anchor.title
        || anchor.querySelector('img[alt]')?.alt
        || ''
      ).trim().slice(0, 100),
    });
    if (links.length >= maxLinks) break;
  }

  const buttons = [...new Set(
    [...(scope?.querySelectorAll('button, [role="button"]') ?? [])]
      .map((button) => (button.innerText || button.getAttribute('aria-label') || '').trim().slice(0, 100))
      .filter(Boolean),
  )].slice(0, maxLinks);

  return {
    text: text.slice(0, limit),
    total: text.length,
    headerText: isInstagram ? '' : (document.querySelector('header')?.innerText || '').trim().slice(0, 1000),
    buttons,
    description: (document.querySelector('meta[name="description"]')?.content || '').trim().slice(0, 500),
    links,
  };
}

function showResult({ text, total, links, buttons, headerText }) {
  const shown = text.length.toLocaleString('uk-UA');
  if (total > text.length) {
    countEl.textContent = `Прочитано ${shown} із ${total.toLocaleString('uk-UA')} символів`;
    setStatus('Текст задовгий, тому його обрізано.', 'info');
  } else {
    countEl.textContent = `Прочитано символів: ${shown}`;
    setStatus('Сторінку прочитано.', 'ok');
  }
  // textContent, а не innerHTML: текст сторінки — чужі дані.
  previewEl.textContent = text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
  extraEl.textContent = [
    `Шапка сайту: ${headerText.replace(/\s+/g, ' ') || 'не знайдено'}`,
    `Кнопки: ${buttons.join(' | ') || 'не знайдено'}`,
    `Посилання: ${links.map((link) => link.label || '(без тексту)').join(' | ') || 'не знайдено'}`,
  ].join('\n');
  resultEl.hidden = false;
}

// Повертає текст сторінки або null, якщо вже показано причину відмови.
async function readTab(tab) {
  if (!tab?.url || !/^https?:\/\//.test(tab.url)) {
    setStatus('Цю сторінку прочитати не можна. Відкрийте звичайний сайт.', 'error');
    return null;
  }

  try {
    // Запит дозволу має йти першим: Chrome приймає його лише одразу після кліку.
    const granted = await chrome.permissions.request({
      origins: [`${new URL(tab.url).origin}/*`],
    });
    if (!granted) {
      setStatus('Без дозволу на цей сайт сторінку не прочитати.', 'error');
      return null;
    }

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readPage,
      args: [MAX_CHARS, MIN_MAIN_CHARS, MAX_LINKS],
    });

    // Поки йшло читання, користувач міг перейти на іншу сторінку.
    if (!isSamePage(tab, currentTab)) {
      setStatus('Сторінка змінилася під час читання. Спробуйте ще раз.', 'info');
      return null;
    }

    if (!injection?.result?.text) {
      setStatus('На сторінці не знайдено видимого тексту.', 'error');
      return null;
    }
    return injection.result;
  } catch (error) {
    console.error(error);
    setStatus('Не вдалося прочитати сторінку. Chrome міг заборонити доступ до неї.', 'error');
    return null;
  }
}

async function readCurrentPage() {
  clearResult();
  readButton.disabled = true;
  const page = await readTab(currentTab);
  if (page) showResult(page);
  readButton.disabled = false;
}

async function serverFetch(path, options = {}) {
  const { serverToken } = await chrome.storage.local.get('serverToken');
  return fetch(`${SERVER_URL}${path}`, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${serverToken}` },
  });
}

function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function showReport(job) {
  const meta = [
    `Сторінка: ${job.url}`,
    `Вердикт рецензента: ${job.verdict ?? 'не знайдено'}`,
    job.check.passed ? 'Структура звіту: усі обов\'язкові частини є.' : `Структура звіту: є проблеми. ${job.check.output}`,
  ];
  if (job.costUsd !== null) {
    meta.push(`Еквівалент вартості запуску: $${job.costUsd.toFixed(2)} (за підпискою витрачає ліміт).`);
  }
  meta.push(job.denials.length
    ? `Заблоковані дії: ${job.denials.join('; ')}`
    : 'Заблокованих дій немає.');

  reportMetaEl.textContent = meta.join('\n');
  // textContent, а не innerHTML: звіт може цитувати чужий текст.
  reportTextEl.textContent = job.report;
  reportEl.hidden = false;
  setAnalysisStatus(
    job.verdict === 'ПРОЙШОВ' ? 'Звіт готовий. Перевірте ключові висновки перед використанням.' : 'Звіт готовий, але рецензент знайшов проблеми.',
    job.verdict === 'ПРОЙШОВ' && job.check.passed ? 'ok' : 'info',
  );
}

async function waitForJob(jobId) {
  while (true) {
    const response = await serverFetch(`/jobs/${jobId}`);
    if (response.status === 404) {
      // Сервер зберігає завдання в пам'яті, тому після перезапуску вже не знає про них.
      await chrome.storage.local.remove('activeJobId');
      throw new Error('job_not_found');
    }
    if (!response.ok) throw new Error(`job_status_${response.status}`);
    const job = await response.json();

    if (job.status === 'done') {
      showReport(job);
      return;
    }
    if (job.status === 'error') {
      const denials = job.denials?.length ? ` Заблоковані дії: ${job.denials.join('; ')}` : '';
      setAnalysisStatus(`${job.error}${denials}`, 'error');
      return;
    }

    const minutes = Math.floor((Date.now() - job.startedAt) / 60000);
    setAnalysisStatus(`Агент працює, минуло хвилин: ${minutes}. Панель можна закрити: аудит продовжиться.`, 'info');
    await delay(JOB_CHECK_MS);
  }
}

function setAnalysisBusy(isBusy) {
  analyzeButton.disabled = isBusy;
  readButton.disabled = isBusy;
}

function analyzeErrorMessage(status) {
  if (status === 401) return 'Токен не підходить.';
  if (status === 413) return 'Сторінка завелика для передавання агенту.';
  return 'Сервер не зміг запустити аудит. Деталі в терміналі сервера.';
}

// Після повторного відкриття панель підхоплює останній аудит, а не пропонує запускати новий.
async function resumeLastJob() {
  const { activeJobId, serverToken } = await chrome.storage.local.get(['activeJobId', 'serverToken']);
  if (!activeJobId || !serverToken) return;

  setAnalysisBusy(true);
  try {
    await waitForJob(activeJobId);
  } catch {
    // Сервер вимкнено або він уже не знає про це завдання: це очікувано, стан сервера показано окремо.
  } finally {
    setAnalysisBusy(false);
  }
}

async function analyzeCurrentPage() {
  const tab = currentTab;
  clearResult();
  reportEl.hidden = true;
  analysisStatusEl.hidden = true;
  setAnalysisBusy(true);

  try {
    const page = await readTab(tab);
    if (!page) return;
    showResult(page);

    setAnalysisStatus('Передаю сторінку агенту…', 'info');
    const response = await serverFetch('/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: tab.url,
        // Без лічильника непрочитаного на початку заголовка, наприклад «(8) Instagram».
        title: (tab.title || '').replace(/^\(\d+\)\s*/, ''),
        text: page.text,
        total: page.total,
        description: page.description,
        links: page.links,
        buttons: page.buttons,
        headerText: page.headerText,
        known: knownInput.value,
      }),
    });
    // 409: аудит уже виконується, тому показуємо його, а не запускаємо новий.
    if (!response.ok && response.status !== 409) {
      setAnalysisStatus(analyzeErrorMessage(response.status), 'error');
      return;
    }

    const { jobId } = await response.json();
    await chrome.storage.local.set({ activeJobId: jobId });
    await waitForJob(jobId);
  } catch (error) {
    console.error(error);
    setAnalysisStatus('Зв\'язок із сервером перервано. Перевірте, чи сервер запущено, і спробуйте ще раз.', 'error');
  } finally {
    setAnalysisBusy(false);
  }
}

function showServerState(text, kind) {
  serverStatusEl.textContent = text;
  serverStatusEl.className = `status ${kind}`;
  serverSetupEl.hidden = kind === 'ok';
}

async function checkServer() {
  const { serverToken } = await chrome.storage.local.get('serverToken');
  if (!serverToken) {
    showServerState('Потрібен токен сервера.', 'info');
    return;
  }

  try {
    const response = await fetch(`${SERVER_URL}/health`, {
      headers: { Authorization: `Bearer ${serverToken}` },
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      showServerState('Сервер підключено.', 'ok');
    } else if (response.status === 401) {
      showServerState('Токен не підходить.', 'error');
    } else {
      showServerState('Сервер повернув помилку.', 'error');
    }
  } catch {
    // Браузер не показує причину відмови, тому чужий ID виглядає так само, як вимкнений сервер.
    showServerState('Сервер вимкнено або він не приймає це розширення.', 'error');
  }
}

tokenForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await chrome.storage.local.set({ serverToken: tokenInput.value.trim() });
  tokenInput.value = '';
  await checkServer();
});

readButton.addEventListener('click', readCurrentPage);
analyzeButton.addEventListener('click', analyzeCurrentPage);

chrome.tabs.onActivated.addListener(showCurrentTab);
chrome.tabs.onUpdated.addListener((_tabId, change) => {
  if (change.title || change.url) showCurrentTab();
});

extensionIdEl.textContent = chrome.runtime.id;

showCurrentTab();
checkServer();
setInterval(checkServer, SERVER_CHECK_MS);
resumeLastJob();
