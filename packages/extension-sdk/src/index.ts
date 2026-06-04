export type { ProviderAuthShape, Slot } from './types';
export { isKnownSlot, SLOT_KEYS, SLOT_LABELS } from './types';

export type {
  ExtensionConfigField,
  ExtensionPath,
  ExtensionManifestV1,
  ExtensionProviderOption,
  ExtensionProviderRequirement,
  ExtensionProviderRequirementOptions,
  ExtensionProviderRequirementSlot
} from './manifest';
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
