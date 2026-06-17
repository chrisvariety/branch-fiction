import {
  hasMissingConfigFields,
  isOptionalRequirement,
  isUseSlotRequirement,
  type ExtensionManifestV1
} from './manifest';

// True if a required config field is empty or a required options provider binding is missing (useSlot and optional providers are excluded).
export function extensionNeedsSetup(
  manifest: ExtensionManifestV1,
  config: Record<string, unknown>,
  bindings: { providerKey: string }[]
): boolean {
  if (hasMissingConfigFields(manifest, config)) return true;
  const bound = new Set(bindings.map((b) => b.providerKey));
  return (manifest.providers ?? []).some(
    (req) =>
      !isUseSlotRequirement(req) && !isOptionalRequirement(req) && !bound.has(req.key)
  );
}
