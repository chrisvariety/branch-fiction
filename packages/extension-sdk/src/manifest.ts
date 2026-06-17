import { isKnownSlot, type ProviderAuthShape, SLOT_KEYS, type Slot } from './types';

const EXTENSION_ID_REGEX = /^@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;
const SQL_IDENT_REGEX = /^[a-z_][a-z0-9_]*$/;

// Host-managed extension db tables; keep in sync with RESERVED_TABLES in src-tauri/src/extension_db.rs.
const HOST_MANAGED_TABLES = new Set([
  'books',
  'chapters',
  'chapter_paragraphs',
  'book_entities',
  'book_arcs',
  'book_entity_hierarchies',
  'chapter_scenes',
  'chapter_scene_groups',
  'chapter_relationships',
  'chapter_entity_appellations',
  'chapter_entity_attributes',
  'book_categories',
  'book_character_place_scores',
  'book_styles',
  'book_migrations',
  'extension_seeds'
]);

export type ExtensionConfigField =
  | {
      key: string;
      label: string;
      type: 'text' | 'url';
      default?: string;
      required?: boolean;
      placeholder?: string;
      description?: string;
    }
  | {
      key: string;
      label: string;
      type: 'select';
      options: { value: string; label: string }[];
      default?: string;
      required?: boolean;
      description?: string;
    }
  | {
      key: string;
      label: string;
      type: 'boolean';
      default?: boolean;
      description?: string;
    };

type ExtensionProviderOptionCommon = {
  auth: ProviderAuthShape;
  model?: string;
  providerName?: string;
  // Markdown-with-links (a, strong, p, em) shown under the API key input.
  credentialHelp?: string;
};

// `baseURL`: fixed prefix declared by the extension (e.g. a public API origin).
// `fullURL`: user-supplied endpoint — manifest value is a placeholder/example.
export type ExtensionProviderOption = ExtensionProviderOptionCommon &
  ({ baseURL: string; fullURL?: never } | { fullURL: string; baseURL?: never });

export function optionURL(opt: ExtensionProviderOption): string {
  return 'baseURL' in opt && opt.baseURL ? opt.baseURL : opt.fullURL!;
}

export function optionExpectsUserURL(opt: ExtensionProviderOption): boolean {
  return 'fullURL' in opt && !!opt.fullURL;
}

export type ExtensionProviderRequirementOptions = {
  key: string;
  role?: string;
  options: ExtensionProviderOption[];
  optional?: boolean;
};

export type ExtensionProviderRequirementSlot = {
  key: string;
  role?: string;
  useSlot: Slot;
};

export type ExtensionProviderRequirement =
  | ExtensionProviderRequirementOptions
  | ExtensionProviderRequirementSlot;

export function isUseSlotRequirement(
  r: ExtensionProviderRequirement
): r is ExtensionProviderRequirementSlot {
  return 'useSlot' in r;
}

export function isOptionalRequirement(r: ExtensionProviderRequirement): boolean {
  return !isUseSlotRequirement(r) && r.optional === true;
}

// Book-scoped non-personal table in single-book exports; assetColumns hold portable file:// URLs.
export type ExtensionBookDataTable = {
  table: string;
  bookIdColumn: string;
  assetColumns?: string[];
};

export type ExtensionPath = {
  entry: string;
  worker?: string;
  // Path (relative to the extension root) to an icon asset.
  icon?: string;
  // Initial window sizing/launch options. Open-ended on purpose so future
  // launch hints (minSize, titleBarStyle, etc.) can be added here.
  window?: { width: number; height: number };
  // Whether this path can be launched via the phone-share flow.
  phoneCompatible?: boolean;
};

// Non-sensitive Permissions-Policy features always delegated to the extension iframe.
export const ALWAYS_ALLOWED_FEATURES = [
  'fullscreen',
  'autoplay',
  'gamepad',
  'screen-wake-lock'
] as const;

// Capture-class features delegated only when declared in `permissions` and consented.
export const GATED_PERMISSIONS = ['microphone', 'camera', 'display-capture'] as const;

export type ExtensionPermission = (typeof GATED_PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<ExtensionPermission, string> = {
  microphone: 'Microphone',
  camera: 'Camera',
  'display-capture': 'Screen capture'
};

// Builds the iframe `allow` attribute: always-on features plus any consented capture permissions.
export function buildExtensionIframeAllow(
  permissions: ExtensionPermission[] | undefined
): string {
  const gated = (permissions ?? []).filter((p): p is ExtensionPermission =>
    (GATED_PERMISSIONS as readonly string[]).includes(p)
  );
  return [...ALWAYS_ALLOWED_FEATURES, ...gated].join('; ');
}

export type ExtensionManifestV1 = {
  manifestVersion: 'v1';
  // "@scope/name", lowercase kebab-case.
  id: string;
  name: string;
  // Extension's own semver. Distinct from `manifestVersion`.
  version: string;
  author?: string;
  description?: string;
  // GitHub URL the update checker polls for newer releases. Required for bundled
  // extensions to be updatable (they have no install provenance); GitHub-
  // installed extensions fall back to the URL they were installed from.
  // Accepts github.com/owner/repo or github.com/owner/repo/tree/<ref>/<subdir>.
  repository?: string;
  path?: ExtensionPath;
  providers?: ExtensionProviderRequirement[];
  config?: ExtensionConfigField[];
  // SQLite file (relative to the extension root, optionally .gz) copied into the extension DB once.
  // Tracked by path, so rename to re-seed. Bundled extensions only.
  seed?: string;
  // Tables packed into single-book exports (never personal data); list FK parents before children.
  bookData?: ExtensionBookDataTable[];
  // Extra outbound hosts the worker is allowed to reach
  // (provider baseURLs do NOT belong here as those are reached through the local proxy)
  net?: string[];
  // Capture-class iframe features (microphone/camera/screen) the extension needs.
  permissions?: ExtensionPermission[];
};

// Bare host or host:port, with an optional single leading-label wildcard (*.example.com).
export const NET_ALLOWLIST_ENTRY_REGEX = /^(\*\.)?[a-z0-9.-]+(:\d+)?$/;

// Identity helper for type-checked manifest authoring.
//   export default defineManifest({ ... });
export function defineManifest(m: ExtensionManifestV1): ExtensionManifestV1 {
  return m;
}

export function requirementHasModel(req: ExtensionProviderRequirement): boolean {
  if (isUseSlotRequirement(req)) return true;
  return req.options.length > 0 && !!req.options[0].model;
}

export function defaultsFromManifest(
  manifest: ExtensionManifestV1
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of manifest.config ?? []) {
    if (f.type === 'boolean') {
      if (f.default !== undefined) out[f.key] = f.default;
    } else if (f.default !== undefined && f.default !== '') {
      out[f.key] = f.default;
    }
  }
  return out;
}

export function hasMissingConfigFields(
  manifest: ExtensionManifestV1,
  config: Record<string, unknown>
): boolean {
  for (const f of manifest.config ?? []) {
    if (f.type === 'boolean') continue;
    if (!f.required) continue;
    const v = config[f.key];
    if (typeof v !== 'string' || v.length === 0) return true;
  }
  return false;
}

export function validateManifest(m: ExtensionManifestV1): void {
  if (!m || typeof m !== 'object') {
    throw new Error('manifest.json must contain a JSON object');
  }
  if (m.manifestVersion !== 'v1') {
    throw new Error(
      `Unsupported manifestVersion: ${JSON.stringify(m.manifestVersion)} (expected "v1")`
    );
  }
  if (!m.id || typeof m.id !== 'string' || !EXTENSION_ID_REGEX.test(m.id)) {
    throw new Error(
      `Invalid extension id: ${m.id} (expected "@scope/name", lowercase kebab-case)`
    );
  }
  if (!m.name || typeof m.name !== 'string') {
    throw new Error('Extension manifest missing "name"');
  }
  if (!m.version || typeof m.version !== 'string') {
    throw new Error('Extension manifest missing "version"');
  }

  if (m.repository !== undefined) {
    if (typeof m.repository !== 'string') {
      throw new Error(`Extension ${m.id}: "repository" must be a string`);
    }
    let host: string;
    try {
      host = new URL(m.repository).host;
    } catch {
      throw new Error(`Extension ${m.id}: "repository" must be a valid URL`);
    }
    if (host !== 'github.com' && host !== 'www.github.com') {
      throw new Error(`Extension ${m.id}: "repository" must be a github.com URL`);
    }
  }

  if (m.path) {
    if (!m.path.entry) {
      throw new Error(`Extension ${m.id}: path.entry is required`);
    }
  }

  if (m.seed !== undefined) {
    if (typeof m.seed !== 'string' || m.seed.length === 0) {
      throw new Error(`Extension ${m.id}: "seed" must be a non-empty string`);
    }
    const parts = m.seed.split('/');
    if (m.seed.startsWith('/') || m.seed.includes('\\') || parts.includes('..')) {
      throw new Error(
        `Extension ${m.id}: "seed" must be a relative path inside the extension (got ${JSON.stringify(m.seed)})`
      );
    }
  }

  if (m.bookData !== undefined) {
    if (!Array.isArray(m.bookData)) {
      throw new Error(`Extension ${m.id}: "bookData" must be an array`);
    }
    const seenTables = new Set<string>();
    for (let i = 0; i < m.bookData.length; i++) {
      const entry = m.bookData[i];
      const where = `Extension ${m.id}, bookData[${i}]`;
      if (!entry || typeof entry !== 'object') {
        throw new Error(`${where}: must be an object`);
      }
      if (typeof entry.table !== 'string' || !SQL_IDENT_REGEX.test(entry.table)) {
        throw new Error(`${where}: "table" must be a lowercase snake_case identifier`);
      }
      if (HOST_MANAGED_TABLES.has(entry.table)) {
        throw new Error(`${where}: table "${entry.table}" is host-managed`);
      }
      if (seenTables.has(entry.table)) {
        throw new Error(`${where}: duplicate table "${entry.table}"`);
      }
      seenTables.add(entry.table);
      if (
        typeof entry.bookIdColumn !== 'string' ||
        !SQL_IDENT_REGEX.test(entry.bookIdColumn)
      ) {
        throw new Error(
          `${where}: "bookIdColumn" must be a lowercase snake_case identifier`
        );
      }
      if (entry.assetColumns !== undefined) {
        if (
          !Array.isArray(entry.assetColumns) ||
          entry.assetColumns.some(
            (c) => typeof c !== 'string' || !SQL_IDENT_REGEX.test(c)
          )
        ) {
          throw new Error(
            `${where}: "assetColumns" must be lowercase snake_case identifiers`
          );
        }
      }
    }
  }

  if (m.providers) {
    if (!Array.isArray(m.providers)) {
      throw new Error(`Extension ${m.id}: providers must be an array`);
    }
    const seen = new Set<string>();
    for (const r of m.providers) {
      if (!r || typeof r !== 'object' || !r.key) {
        throw new Error(`Invalid provider entry in ${m.id}: ${JSON.stringify(r)}`);
      }
      if (seen.has(r.key)) {
        throw new Error(`Duplicate provider key in ${m.id}: ${r.key}`);
      }
      seen.add(r.key);

      const reqKey = r.key;
      const raw = r as Record<string, unknown>;
      const hasUseSlot = 'useSlot' in raw;
      const hasOptions = 'options' in raw;
      if (hasUseSlot && hasOptions) {
        throw new Error(
          `Provider ${reqKey} in ${m.id}: cannot declare both "useSlot" and "options"`
        );
      }
      if (!hasUseSlot && !hasOptions) {
        throw new Error(
          `Provider ${reqKey} in ${m.id}: must declare either "useSlot" or "options"`
        );
      }

      if (hasUseSlot) {
        const slot = raw.useSlot;
        if (typeof slot !== 'string' || !isKnownSlot(slot)) {
          throw new Error(
            `Provider ${reqKey} in ${m.id}: useSlot must be one of ${SLOT_KEYS.join(', ')} (got ${JSON.stringify(slot)})`
          );
        }
        continue;
      }

      const optionsReq = r as ExtensionProviderRequirementOptions;
      if (!Array.isArray(optionsReq.options) || optionsReq.options.length === 0) {
        throw new Error(
          `Provider ${r.key} in ${m.id} must declare a non-empty "options" array`
        );
      }
      if (optionsReq.optional !== undefined && typeof optionsReq.optional !== 'boolean') {
        throw new Error(`Provider ${reqKey} in ${m.id}: "optional" must be a boolean`);
      }
      const seenOriginAuth = new Set<string>();
      const firstHasModel = !!optionsReq.options[0]?.model;
      for (let i = 0; i < optionsReq.options.length; i++) {
        const opt = optionsReq.options[i];
        const where = `Provider ${reqKey} in ${m.id}, option ${i}`;
        if (!opt || typeof opt !== 'object') {
          throw new Error(`${where}: must be an object`);
        }
        const rawOpt = opt as Record<string, unknown>;
        const hasBase = typeof rawOpt.baseURL === 'string' && rawOpt.baseURL.length > 0;
        const hasFull = typeof rawOpt.fullURL === 'string' && rawOpt.fullURL.length > 0;
        if (hasBase && hasFull) {
          throw new Error(`${where}: cannot declare both "baseURL" and "fullURL"`);
        }
        if (!hasBase && !hasFull) {
          throw new Error(`${where}: must declare either "baseURL" or "fullURL"`);
        }
        const urlString = (hasBase ? rawOpt.baseURL : rawOpt.fullURL) as string;
        try {
          new URL(urlString);
        } catch {
          throw new Error(
            `${where}: invalid ${hasBase ? 'baseURL' : 'fullURL'}: ${urlString}`
          );
        }
        if (!opt.auth || typeof opt.auth !== 'object') {
          throw new Error(`${where}: must declare an auth block`);
        }
        const validKinds = ['none', 'bearer', 'header', 'queryParam', 'body'] as const;
        if (!validKinds.includes(opt.auth.kind as (typeof validKinds)[number])) {
          throw new Error(`${where}: auth.kind must be one of ${validKinds.join(', ')}`);
        }
        if (opt.auth.kind === 'header' && !('header' in opt.auth && opt.auth.header)) {
          throw new Error(`${where}: auth.kind="header" requires "header"`);
        }
        if (opt.auth.kind === 'queryParam' && !('param' in opt.auth && opt.auth.param)) {
          throw new Error(`${where}: auth.kind="queryParam" requires "param"`);
        }
        if (opt.auth.kind === 'body' && !('field' in opt.auth && opt.auth.field)) {
          throw new Error(`${where}: auth.kind="body" requires "field"`);
        }
        if (opt.model !== undefined && (typeof opt.model !== 'string' || !opt.model)) {
          throw new Error(`${where}: model must be a non-empty string when provided`);
        }
        if (!!opt.model !== firstHasModel) {
          throw new Error(
            `Provider ${reqKey} in ${m.id}: every option must declare "model" or none of them — mixed states aren't allowed`
          );
        }
        const originKey = (() => {
          try {
            return new URL(urlString).origin;
          } catch {
            return urlString;
          }
        })();
        const authKey = JSON.stringify(opt.auth);
        const dedupeKey = `${originKey}|${authKey}`;
        if (seenOriginAuth.has(dedupeKey)) {
          throw new Error(
            `Provider ${reqKey} in ${m.id}: option ${i} duplicates an earlier (origin, auth) pair (${originKey})`
          );
        }
        seenOriginAuth.add(dedupeKey);
      }
    }
  }

  if (m.net !== undefined) {
    if (!Array.isArray(m.net)) {
      throw new Error(`Extension ${m.id}: net must be an array of strings`);
    }
    const seenNet = new Set<string>();
    for (let i = 0; i < m.net.length; i++) {
      const entry = m.net[i];
      const where = `Extension ${m.id}, net[${i}]`;
      if (typeof entry !== 'string' || entry.length === 0) {
        throw new Error(`${where}: must be a non-empty string`);
      }
      if (entry !== entry.toLowerCase()) {
        throw new Error(`${where}: must be lowercase (got ${JSON.stringify(entry)})`);
      }
      if (!NET_ALLOWLIST_ENTRY_REGEX.test(entry)) {
        throw new Error(
          `${where}: must be a bare host or host:port, with an optional leading "*." wildcard — no scheme or path (got ${JSON.stringify(entry)})`
        );
      }
      if (seenNet.has(entry)) {
        throw new Error(`${where}: duplicate entry ${JSON.stringify(entry)}`);
      }
      seenNet.add(entry);
    }
  }

  if (m.permissions !== undefined) {
    if (!Array.isArray(m.permissions)) {
      throw new Error(`Extension ${m.id}: permissions must be an array of strings`);
    }
    const seenPerms = new Set<string>();
    for (let i = 0; i < m.permissions.length; i++) {
      const entry = m.permissions[i];
      const where = `Extension ${m.id}, permissions[${i}]`;
      if (
        typeof entry !== 'string' ||
        !(GATED_PERMISSIONS as readonly string[]).includes(entry)
      ) {
        throw new Error(
          `${where}: must be one of ${GATED_PERMISSIONS.join(', ')} (got ${JSON.stringify(entry)})`
        );
      }
      if (seenPerms.has(entry)) {
        throw new Error(`${where}: duplicate entry ${JSON.stringify(entry)}`);
      }
      seenPerms.add(entry);
    }
  }

  if (m.config) {
    if (!Array.isArray(m.config)) {
      throw new Error(`Extension ${m.id}: config must be an array`);
    }
    const seenKeys = new Set<string>();
    for (const f of m.config) {
      if (!f || typeof f !== 'object' || !f.key) {
        throw new Error(`Invalid config field in ${m.id}: ${JSON.stringify(f)}`);
      }
      if (seenKeys.has(f.key)) {
        throw new Error(`Duplicate config key in ${m.id}: ${f.key}`);
      }
      seenKeys.add(f.key);
    }
  }
}
