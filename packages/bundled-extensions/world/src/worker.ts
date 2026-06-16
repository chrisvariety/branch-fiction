// Worker entry. Named exports = task handlers — `extensionSDK.worker.spawn(name)`

import './lib/env-soft';

export { prepareWorld } from './worker/prepare-world';
