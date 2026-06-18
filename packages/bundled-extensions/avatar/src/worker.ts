// Worker entry. Named exports = task handlers — `extensionSDK.worker.spawn(name)`

import '@branch-fiction/extension-sdk/worker/env-soft';

export { prepareAvatar } from './worker/prepare-avatar';
export { startAvatarSession } from './worker/start-avatar-session';
