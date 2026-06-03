type Method = (...args: unknown[]) => unknown;
type API = Record<string, Method>;

type Request = { jsonrpc: '2.0'; id: number; method: string; params?: unknown[] };
type Response =
  | { jsonrpc: '2.0'; id: number; result: unknown }
  | {
      jsonrpc: '2.0';
      id: number;
      error: { message: string; stack?: string; name?: string };
    };

const encoder = new TextEncoder();

function writeStdout(line: string) {
  Deno.stdout.writeSync(encoder.encode(line + '\n'));
}

function writeStderr(line: string) {
  Deno.stderr.writeSync(encoder.encode(line + '\n'));
}

function fmtArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) {
        const extras = Object.entries(a).filter(
          ([k]) => !['name', 'message', 'stack'].includes(k)
        );
        const tail = extras.length
          ? ` ${JSON.stringify(Object.fromEntries(extras))}`
          : '';
        return `${a.name}: ${a.message}${tail}\n${a.stack ?? ''}`;
      }
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

for (const k of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
  console[k] = (...args: unknown[]) => writeStderr(fmtArgs(args));
}

export async function serveRPC(api: API): Promise<never> {
  writeStderr('[rpc] worker ready');
  const reader = Deno.stdin.readable.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.trim()) void handleLine(line, api);
    }
  }
  // EOF — host closed stdin.
  Deno.exit(0);
}

async function handleLine(line: string, api: API) {
  let req: Request;
  try {
    req = JSON.parse(line);
  } catch (e) {
    writeStderr(`[rpc] bad request: ${(e as Error).message}: ${line}`);
    return;
  }
  const method = api[req.method];
  let resp: Response;
  if (typeof method !== 'function') {
    resp = {
      jsonrpc: '2.0',
      id: req.id,
      error: { message: `unknown method: ${req.method}` }
    };
  } else {
    try {
      const result = await method(...(req.params ?? []));
      resp = { jsonrpc: '2.0', id: req.id, result };
    } catch (e) {
      const err = e as Error;
      resp = {
        jsonrpc: '2.0',
        id: req.id,
        error: { message: err.message, stack: err.stack, name: err.name }
      };
    }
  }
  writeStdout(JSON.stringify(resp));
}
