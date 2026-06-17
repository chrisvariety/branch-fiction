export type { ProviderAuthShape, Slot } from './types';
export { isKnownSlot, SLOT_KEYS, SLOT_LABELS } from './types';

export type {
  ExtensionBookDataTable,
  ExtensionConfigField,
  ExtensionPath,
  ExtensionManifestV1,
  ExtensionPermission,
  ExtensionProviderOption,
  ExtensionProviderRequirement,
  ExtensionProviderRequirementOptions,
  ExtensionProviderRequirementSlot
} from './manifest';
export {
  ALWAYS_ALLOWED_FEATURES,
  buildExtensionIframeAllow,
  defaultsFromManifest,
  defineManifest,
  GATED_PERMISSIONS,
  hasMissingConfigFields,
  isOptionalRequirement,
  isUseSlotRequirement,
  NET_ALLOWLIST_ENTRY_REGEX,
  optionExpectsUserURL,
  optionURL,
  PERMISSION_LABELS,
  requirementHasModel,
  validateManifest
} from './manifest';

export type {
  ExtensionCtx,
  ExtensionHost,
  ExtensionProviderBinding,
  ExtensionSDK,
  WorkerSpawnHandle,
  WorkerSpawnOptions
} from './sdk-source';
export { isTaskAlreadyRunningError } from './sdk-source';
