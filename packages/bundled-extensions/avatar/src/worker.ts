// Worker entry. Named exports = task handlers — `extensionSDK.worker.spawn(name)`

import '@branch-fiction/extension-sdk/worker/env-soft';

export { prepareAvatar, generateAvatarScenarios } from './worker/prepare-avatar';
