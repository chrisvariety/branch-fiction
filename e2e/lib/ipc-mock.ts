// Vendored & patched from @srsholmes/tauri-playwright (MIT). The upstream
// does `JSON.parse(JSON.stringify(handlerResult))` synchronously,
// which collapses any Promise (any async handler) to "{}".
// Our patched version awaits the handler before serializing.

export interface CapturedInvoke {
  cmd: string;
  args: Record<string, unknown>;
  timestamp: number;
}

declare global {
  interface Window {
    isTauri: boolean;
    __TAURI_MOCK_CALLS__: CapturedInvoke[];
    __TAURI_MOCK_LISTENERS__: Record<string, string[]>;
    __TAURI_EMIT_MOCK_EVENT__: (event: string, payload: unknown) => void;
    __TAURI_GET_MOCK_CALLS__: () => CapturedInvoke[];
    __TAURI_CLEAR_MOCK_CALLS__: () => void;
    __TAURI_INTERNALS__: {
      invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
      convertFileSrc: (path: string) => string;
      transformCallback: (callback: (response: unknown) => void) => string;
      metadata: Record<string, unknown>;
    };
  }
}

export function generateIpcMockScript(
  mocks: Record<string, (args?: Record<string, unknown>) => unknown>,
  context?: Record<string, unknown>
): string {
  const contextDeclarations = context
    ? Object.entries(context)
        .map(([name, value]) => `  var ${name} = ${JSON.stringify(value)};`)
        .join('\n')
    : '';

  const mockEntries = Object.entries(mocks).map(
    ([cmd, handler]) => `    ${JSON.stringify(cmd)}: ${handler.toString()}`
  );

  return `
(function() {
  "use strict";

${contextDeclarations}

  var mockHandlers = {
${mockEntries.join(',\n')}
  };

  // isTauri() now checks window.isTauri (not __TAURI_INTERNALS__); without this
  // loadProviderCatalog() short-circuits and the catalog never populates.
  window.isTauri = true;

  window.__TAURI_MOCK_CALLS__ = [];
  window.__TAURI_MOCK_LISTENERS__ = {};

  function handleInvoke(cmd, args) {
    if (cmd === "plugin:event|listen") {
      var event = args && args.event;
      var handler = args && args.handler;
      if (event && handler) {
        if (!window.__TAURI_MOCK_LISTENERS__[event]) {
          window.__TAURI_MOCK_LISTENERS__[event] = [];
        }
        window.__TAURI_MOCK_LISTENERS__[event].push(handler);
      }
      return Promise.resolve(Math.floor(Math.random() * 1000000));
    }
    if (cmd === "plugin:event|unlisten") {
      return Promise.resolve();
    }

    window.__TAURI_MOCK_CALLS__.push({
      cmd: cmd,
      args: args || {},
      timestamp: Date.now()
    });

    if (cmd in mockHandlers) {
      // Wrap in Promise.resolve so async handlers are awaited before the
      // JSON-clone that mimics Tauri's IPC serialization boundary.
      return Promise.resolve(mockHandlers[cmd](args)).then(
        function (response) {
          return response !== null && typeof response === "object"
            ? JSON.parse(JSON.stringify(response))
            : response;
        },
        function (err) {
          console.error("[ipc-mock] handler error for", cmd, err);
          throw err;
        }
      );
    }

    console.warn("[ipc-mock] unhandled invoke:", cmd, args);
    return Promise.resolve(null);
  }

  window.__TAURI_INTERNALS__ = {
    invoke: handleInvoke,
    convertFileSrc: function(path) { return path; },
    transformCallback: function(callback) {
      var id = Math.random().toString(36).slice(2);
      window["_" + id] = callback;
      return id;
    },
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" }
    }
  };

  window.__TAURI_EMIT_MOCK_EVENT__ = function(event, payload) {
    var listeners = window.__TAURI_MOCK_LISTENERS__[event] || [];
    listeners.forEach(function(handlerId) {
      var callback = window["_" + handlerId];
      if (callback) {
        callback({ event: event, payload: payload });
      }
    });
  };

  window.__TAURI_GET_MOCK_CALLS__ = function() {
    return window.__TAURI_MOCK_CALLS__;
  };
  window.__TAURI_CLEAR_MOCK_CALLS__ = function() {
    window.__TAURI_MOCK_CALLS__ = [];
  };
})();
`;
}
