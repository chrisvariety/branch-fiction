import http from 'node:http';

export const DEFAULT_BRIDGE_PORT = 1421;

export class BridgeError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'BridgeError';
  }
}

export class UnpairedError extends Error {
  constructor(message = 'not paired') {
    super(message);
    this.name = 'UnpairedError';
  }
}

export type PreparedDb = {
  dataDir: string;
  dbPath: string;
  assetsDir: string;
  denoBin?: string;
};

export type Bridge = {
  port: number;
  setToken(token: string | undefined): void;
  pair(extensionId: string, code: string): Promise<string>;
  prepareDb(extensionId: string): Promise<PreparedDb>;
};

export type CreateBridgeOptions = {
  port?: number;
  token?: string;
};

export function createBridge(opts: CreateBridgeOptions = {}): Bridge {
  const envPort = Number(process.env.BRANCH_FICTION_BRIDGE_PORT);
  const port =
    opts.port ??
    (Number.isFinite(envPort) && envPort > 0 ? envPort : DEFAULT_BRIDGE_PORT);
  let token = opts.token;

  async function pair(extensionId: string, code: string): Promise<string> {
    const r = await request(port, '/v1/extension-dev/pair', {
      method: 'POST',
      body: JSON.stringify({ extensionId, code })
    });
    if (r.status === 200) {
      const parsed = JSON.parse(r.body) as { token: string };
      token = parsed.token;
      return parsed.token;
    }
    if (r.status === 401)
      throw new BridgeError(r.status, r.body || 'invalid or expired code');
    throw new BridgeError(r.status, r.body || `pair failed (${r.status})`);
  }

  async function prepareDb(extensionId: string): Promise<PreparedDb> {
    if (!token) throw new UnpairedError();
    const r = await request(port, '/v1/extension-dev/extension-db/prepare', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ extensionId })
    });
    if (r.status === 200) return JSON.parse(r.body) as PreparedDb;
    if (r.status === 401) throw new UnpairedError(r.body || 'unpaired');
    throw new BridgeError(r.status, r.body || `prepareDb failed (${r.status})`);
  }

  return {
    port,
    setToken: (t) => {
      token = t;
    },
    pair,
    prepareDb
  };
}

type RequestInit = {
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
};

type Response = { status: number; body: string };

function request(port: number, path: string, init: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: init.method,
        headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      }
    );
    req.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        reject(
          new BridgeError(
            0,
            `could not reach Branch Fiction on port ${port} — is the app running?`
          )
        );
      } else {
        reject(err);
      }
    });
    if (init.body) req.write(init.body);
    req.end();
  });
}
