export {
  defaultsFromManifest,
  defineManifest,
  hasMissingConfigFields,
  isOptionalRequirement,
  isUseSlotRequirement,
  NET_ALLOWLIST_ENTRY_REGEX,
  optionExpectsUserURL,
  optionURL,
  requirementHasModel,
  validateManifest
} from '@branch-fiction/extension-sdk';
export type {
  ExtensionBookDataTable,
  ExtensionConfigField,
  ExtensionPath,
  ExtensionManifestV1,
  ExtensionProviderOption,
  ExtensionProviderRequirement,
  ExtensionProviderRequirementOptions,
  ExtensionProviderRequirementSlot
} from '@branch-fiction/extension-sdk';

export type ResolvedOption =
  | {
      kind: 'existing';
      providerId: string;
      providerName: string;
      providerType: string;
      // used for the cloud, could be used for other extension purposes in the future
      overrideBaseUrl?: string;
    }
  | {
      kind: 'preset';
      presetType: string;
      presetName: string;
    }
  | {
      kind: 'unknown';
      suggestedName: string;
    };

export type SlotCandidate = {
  providerModelId: string;
  providerId: string;
  providerName: string;
  providerType: string;
  modelKey: string;
};

// A `useSlot` area reflects the org's default text model; switching it updates the global default.
export type ResolvedSlot =
  | {
      kind: 'configured';
      selectedProviderModelId: string;
      candidates: SlotCandidate[];
    }
  | { kind: 'empty' };

import type {
  ExtensionManifestV1,
  ExtensionProviderRequirementOptions,
  ExtensionProviderRequirementSlot
} from '@branch-fiction/extension-sdk';

export type ResolvedRequirement =
  | {
      requirement: ExtensionProviderRequirementOptions;
      // Per manifest option: every provider that can satisfy it (user credentials before cloud), or a single preset/unknown fallback.
      options: ResolvedOption[][];
      // Previously-saved binding for an already-installed extension, used to re-seed the configure screen
      binding?: {
        providerId: string;
        modelKey: string | null;
        overrideBaseUrl: string | null;
      };
    }
  | {
      requirement: ExtensionProviderRequirementSlot;
      slot: ResolvedSlot;
    };

export type ExtensionProvenanceGithub = {
  kind: 'github';
  url: string;
  owner: string;
  repo: string;
  ref: string;
  sha: string;
  subdir?: string;
};

export type ExtensionProvenanceLocal = {
  kind: 'local';
  sourcePath: string;
};

export type ExtensionProvenanceBundled = {
  kind: 'bundled';
};

export type ExtensionProvenance =
  | ExtensionProvenanceGithub
  | ExtensionProvenanceLocal
  | ExtensionProvenanceBundled;

export function provenanceFromRow(row: {
  provenanceType: string;
  provenanceConfig: Record<string, unknown>;
}): ExtensionProvenance {
  switch (row.provenanceType) {
    case 'bundled':
      return { kind: 'bundled' };
    case 'local': {
      const sp = row.provenanceConfig.sourcePath;
      return { kind: 'local', sourcePath: typeof sp === 'string' ? sp : '' };
    }
    case 'github':
      return {
        kind: 'github',
        ...(row.provenanceConfig as Omit<ExtensionProvenanceGithub, 'kind'>)
      };
    default:
      return { kind: 'local', sourcePath: '' };
  }
}

// Cloud provider access requires first-party trust: bundled extensions are trusted by construction; others need a valid signature.
export function isCloudEligible(
  provenance: ExtensionProvenance | undefined,
  signed: boolean
): boolean {
  if (provenance?.kind === 'bundled') return true;
  return signed;
}

export function provenanceToRow(p: ExtensionProvenance): {
  provenanceType: ExtensionProvenance['kind'];
  provenanceConfig: Record<string, unknown>;
} {
  switch (p.kind) {
    case 'bundled':
      return { provenanceType: 'bundled', provenanceConfig: {} };
    case 'local':
      return { provenanceType: 'local', provenanceConfig: { sourcePath: p.sourcePath } };
    case 'github': {
      const { kind: _kind, ...rest } = p;
      return { provenanceType: 'github', provenanceConfig: rest };
    }
  }
}

export type StagedExtensionInstall = {
  sourcePath: string;
  manifest: ExtensionManifestV1;
  isReinstall: boolean;
  requirements: ResolvedRequirement[];
  provenance: ExtensionProvenance;
  // Valid first-party signature on the staged bytes.
  signed: boolean;
  // 'configure' rebinds providers without copying files.
  mode: 'install' | 'configure';
  // Pre-fills the config form on reinstall/configure.
  existingConfig?: Record<string, unknown>;
};
