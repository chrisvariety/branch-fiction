export const SETUP_UI_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Extension dev setup</title>
<style>
  :root {
    color-scheme: dark light;
    --fg: #1a1a1a;
    --bg: #fafafa;
    --muted: #707070;
    --border: #ddd;
    --primary: #2658d3;
    --warn: #b04a00;
    --ok: #1a7a3a;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --fg: #eee;
      --bg: #18181a;
      --muted: #999;
      --border: #333;
      --primary: #6691ff;
    }
  }
  * { box-sizing: border-box; }
  body {
    font: 14px/1.45 system-ui, -apple-system, sans-serif;
    margin: 0; padding: 32px 24px; max-width: 760px; margin-inline: auto;
    color: var(--fg); background: var(--bg);
  }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 24px 0 8px; }
  p.sub { color: var(--muted); margin: 0 0 24px; }
  .card { border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin: 12px 0; }
  .row { display: grid; grid-template-columns: 160px 1fr; gap: 12px; margin: 8px 0; align-items: center; }
  label { color: var(--muted); }
  input, select, textarea {
    font: inherit; padding: 6px 8px; border: 1px solid var(--border);
    border-radius: 4px; background: var(--bg); color: var(--fg); width: 100%;
  }
  input[type=checkbox] { width: auto; }
  button {
    font: inherit; padding: 8px 14px; border-radius: 4px; border: 1px solid var(--primary);
    background: var(--primary); color: white; cursor: pointer;
  }
  button.secondary { background: transparent; color: var(--primary); }
  button:disabled, button.secondary:disabled {
    background: transparent; color: var(--muted); border-color: var(--border);
    cursor: not-allowed; opacity: 0.7;
  }
  .small { font-size: 12px; color: var(--muted); }
  code { font: 12px/1.4 ui-monospace, "SF Mono", Menlo, monospace; padding: 1px 4px;
    background: var(--border); border-radius: 3px; }
  .actions { display: flex; gap: 8px; margin-top: 24px; }
  .err { color: var(--warn); margin: 8px 0; }
</style>
</head>
<body>
<h1>Extension dev setup</h1>
<p class="sub">Configure provider bindings + pick a book. Saved to <code>dev.config.json</code> in your extension dir.</p>
<div id="root">Loading…</div>
<script type="module">
const root = document.getElementById('root');

async function fetchStatus() {
  const r = await fetch('/__dev__/api/status');
  if (!r.ok) throw new Error('status: ' + r.status);
  return r.json();
}

function inputRow(label, value, onInput, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = label;
  const input = document.createElement('input');
  input.type = opts.type ?? 'text';
  if (opts.placeholder) input.placeholder = opts.placeholder;
  input.value = value ?? '';
  input.addEventListener('input', () => onInput(input.value));
  wrap.append(lab, input);
  return wrap;
}

function selectRow(label, value, options, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = label;
  const sel = document.createElement('select');
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === value) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  wrap.append(lab, sel);
  return wrap;
}

const PROVIDER_TYPES = [
  { value: 'google_gemini', label: 'Google Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta', auth: { kind: 'header', header: 'x-goog-api-key' } },
  { value: 'openai', label: 'OpenAI', baseURL: 'https://api.openai.com/v1', auth: { kind: 'bearer' } },
  { value: 'anthropic', label: 'Anthropic', baseURL: 'https://api.anthropic.com', auth: { kind: 'header', header: 'x-api-key' } },
  { value: 'openrouter', label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', auth: { kind: 'bearer' } },
  { value: 'xai', label: 'xAI', baseURL: 'https://api.x.ai/v1', auth: { kind: 'bearer' } },
  { value: 'fal', label: 'Fal', baseURL: 'https://fal.run', auth: { kind: 'bearer', headerPrefix: 'Key' } },
  { value: 'ollama', label: 'Ollama', baseURL: 'http://localhost:11434', auth: { kind: 'none' } },
  { value: 'openai_compatible', label: 'OpenAI Compatible', baseURL: '', auth: { kind: 'bearer' } }
];

function defaultBindingForReq(req, existing) {
  if ('useSlot' in req) {
    const e = existing && existing.kind === 'useSlot' ? existing : null;
    const preset = PROVIDER_TYPES[0];
    return {
      kind: 'useSlot',
      providerType: e?.providerType ?? preset.value,
      modelKey: e?.modelKey ?? '',
      baseURL: e?.baseURL ?? preset.baseURL,
      auth: e?.auth ?? preset.auth,
      apiKey: e?.apiKey ?? '',
      reasoning: e?.reasoning
    };
  }
  const e = existing && existing.kind === 'options' ? existing : null;
  return {
    kind: 'options',
    useIndex: e?.useIndex ?? 0,
    fullURL: e?.fullURL,
    apiKey: e?.apiKey ?? ''
  };
}

function renderRequirement(req, binding, onChange) {
  const card = document.createElement('div');
  card.className = 'card';
  const h = document.createElement('h2');
  h.textContent = req.role ? req.role + ' (' + req.key + ')' : req.key;
  card.appendChild(h);

  if ('useSlot' in req) {
    const small = document.createElement('p');
    small.className = 'small';
    small.textContent = 'useSlot: ' + req.useSlot + ' — pick any provider+model that fits this slot.';
    card.appendChild(small);

    card.appendChild(selectRow('Provider type', binding.providerType,
      PROVIDER_TYPES.map((p) => ({ value: p.value, label: p.label })),
      (v) => {
        const preset = PROVIDER_TYPES.find((p) => p.value === v);
        binding.providerType = v;
        if (preset) {
          binding.baseURL = preset.baseURL;
          binding.auth = preset.auth;
        }
        onChange();
      }));
    card.appendChild(inputRow('Model id', binding.modelKey, (v) => { binding.modelKey = v; onChange(); }, { placeholder: 'e.g. gemini-2.5-flash' }));
    card.appendChild(inputRow('Base URL', binding.baseURL, (v) => { binding.baseURL = v; onChange(); }));
    card.appendChild(inputRow('API key', binding.apiKey, (v) => { binding.apiKey = v; onChange(); }, { type: 'password' }));
  } else {
    card.appendChild(selectRow('Option', String(binding.useIndex),
      req.options.map((o, i) => ({ value: String(i), label: (o.providerName ?? '') + ' ' + (o.baseURL ?? o.fullURL) + (o.model ? ' / ' + o.model : '') })),
      (v) => { binding.useIndex = Number(v); onChange(); }));
    const opt = req.options[binding.useIndex];
    if (opt && 'fullURL' in opt && opt.fullURL) {
      card.appendChild(inputRow('Endpoint URL', binding.fullURL ?? opt.fullURL, (v) => { binding.fullURL = v; onChange(); }));
    }
    if (opt && opt.auth.kind !== 'none') {
      card.appendChild(inputRow('API key', binding.apiKey, (v) => { binding.apiKey = v; onChange(); }, { type: 'password' }));
    }
  }
  return card;
}

function renderConfigField(field, value, onChange) {
  const wrap = document.createElement('div');
  if (field.type === 'boolean') {
    wrap.className = 'row';
    const lab = document.createElement('label');
    lab.textContent = field.label;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!value;
    cb.addEventListener('change', () => onChange(cb.checked));
    wrap.append(lab, cb);
  } else if (field.type === 'select') {
    wrap.appendChild(selectRow(field.label, String(value ?? field.default ?? ''),
      field.options.map((o) => ({ value: o.value, label: o.label })),
      (v) => onChange(v)));
  } else {
    wrap.appendChild(inputRow(field.label, value ?? field.default ?? '', (v) => onChange(v), { placeholder: field.placeholder }));
  }
  return wrap;
}

let manifest, config;
let books = [];

async function saveConfig() {
  const r = await fetch('/__dev__/api/save', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });
  if (!r.ok) throw new Error(await r.text());
}

async function init() {
  let status;
  try {
    status = await fetchStatus();
  } catch (e) {
    root.innerHTML = '<div class="err">Failed to load status: ' + e.message + '</div>';
    return;
  }

  manifest = status.manifest;
  config = status.config ?? {};
  config.providers ??= {};
  config.config ??= {};
  books = status.books ?? [];

  for (const req of manifest.providers ?? []) {
    config.providers[req.key] = defaultBindingForReq(req, config.providers[req.key]);
  }

  const ready = status.ok && books.length > 0 && !!config.bookId
    && books.some((b) => b.id === config.bookId);

  // Auto-launch when Vite redirected us here (?auto=1) and there's nothing
  // left to configure. Manual visits always show the wizard.
  const params = new URLSearchParams(window.location.search);
  if (params.has('auto') && ready) {
    root.innerHTML = '<p class="small">Launching…</p>';
    try {
      const r = await fetch('/__dev__/api/launch-url');
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok !== false && j.url) {
        window.location.replace(j.url);
        return;
      }
      console.warn('[extension-dev] auto-launch failed:', j.error ?? r.statusText);
    } catch (e) {
      console.warn('[extension-dev] auto-launch failed:', e);
    }
  }

  render();
}

let darkMode = false;

function render() {
  root.innerHTML = '';

  if ((manifest.providers ?? []).length > 0) {
    const head = document.createElement('h2');
    head.textContent = 'Provider requirements';
    root.appendChild(head);
    for (const req of manifest.providers ?? []) {
      root.appendChild(renderRequirement(req, config.providers[req.key], () => undefined));
    }
  }

  if ((manifest.config ?? []).length > 0) {
    const head = document.createElement('h2');
    head.textContent = 'Extension config';
    root.appendChild(head);
    const card = document.createElement('div');
    card.className = 'card';
    for (const field of manifest.config) {
      card.appendChild(renderConfigField(field, config.config[field.key], (v) => {
        config.config[field.key] = v;
      }));
    }
    root.appendChild(card);
  }

  const bookHead = document.createElement('h2');
  bookHead.textContent = 'Book context';
  const bookCard = document.createElement('div');
  bookCard.className = 'card';
  if (books.length === 0) {
    bookCard.textContent = 'No books found in your app DB. Import a book in Branch Fiction first, then reload.';
  } else {
    if (!config.bookId || !books.some((b) => b.id === config.bookId)) {
      config.bookId = books[0].id;
    }
    bookCard.appendChild(selectRow('Book', config.bookId,
      books.map((b) => ({ value: b.id, label: b.title + '  (' + b.id + ')' })),
      (v) => { config.bookId = v; }));
  }
  root.append(bookHead, bookCard);

  const darkRow = document.createElement('div');
  darkRow.className = 'row';
  const darkLab = document.createElement('label');
  darkLab.style.display = 'flex';
  darkLab.style.alignItems = 'center';
  darkLab.style.gap = '8px';
  darkLab.style.cursor = 'pointer';
  const darkCb = document.createElement('input');
  darkCb.type = 'checkbox';
  darkCb.checked = darkMode;
  darkCb.addEventListener('change', () => { darkMode = darkCb.checked; });
  darkLab.append(darkCb, document.createTextNode('Dark mode?'));
  darkRow.appendChild(darkLab);
  root.appendChild(darkRow);

  const actions = document.createElement('div');
  actions.className = 'actions';
  const launch = document.createElement('button');
  launch.textContent = 'Save & launch';
  launch.disabled = books.length === 0;
  actions.append(launch);
  root.appendChild(actions);

  const err = document.createElement('div');
  err.className = 'err';
  root.appendChild(err);

  launch.addEventListener('click', async () => {
    err.textContent = '';
    if (!config.bookId) {
      err.textContent = 'Pick a book before launching.';
      return;
    }
    try {
      await saveConfig();
    } catch (e) {
      err.textContent = 'Save failed: ' + e.message;
      return;
    }
    const r = await fetch('/__dev__/api/launch-url');
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) {
      err.textContent = 'Launch failed: ' + (j.error ?? r.statusText);
      return;
    }
    const u = new URL(j.url, window.location.href);
    if (darkMode) u.searchParams.set('dark', '1');
    window.location.href = u.toString();
  });
}

void init();
</script>
</body>
</html>`;
