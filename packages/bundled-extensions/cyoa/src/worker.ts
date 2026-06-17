// Worker entry. Named exports = task handlers — `extensionSDK.worker.spawn(name)`

import '@branch-fiction/extension-sdk/worker/env-soft';

export { runFirstLaunch } from './worker/orchestrator';
export { buildWorld } from './book/server/build-world';
export { createNewChat } from './book/server/create-chat';
export { generateScenarios } from './book/server/generate-scenarios';
export { generateChatImage } from './book/server/generate-chat-image';
export { generateWorldImage } from './book/server/generate-world-image';
export {
  loadChatNode,
  performChatAction,
  streamChatResponse
} from './book/server/stream-chat-response';
