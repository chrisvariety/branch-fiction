// Browser-side Kysely. Wraps `window.extensionSDK.db.query`

import {
  CamelCasePlugin,
  type CompiledQuery,
  type DatabaseConnection,
  type DatabaseIntrospector,
  type Dialect,
  type DialectAdapter,
  type Driver,
  Kysely,
  type QueryResult,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler
} from 'kysely';
import { SerializePlugin } from 'kysely-plugin-serialize';

import { BooleanPlugin } from './boolean-plugin';
import type { SeededDatabase } from './types';

export type IframeQueryFn = (
  sql: string,
  params: readonly unknown[]
) => Promise<{ rows: unknown[]; changes: number }>;

function defaultQuery(): IframeQueryFn {
  const sdk = (
    globalThis as unknown as { extensionSDK?: { db?: { query?: IframeQueryFn } } }
  ).extensionSDK;
  if (!sdk?.db?.query) {
    throw new Error(
      'createIframeKysely: window.extensionSDK.db.query is not available — was the extension SDK script loaded?'
    );
  }
  return sdk.db.query.bind(sdk.db);
}

class IframeConnection implements DatabaseConnection {
  constructor(private readonly query: IframeQueryFn) {}

  async executeQuery<O>(compiled: CompiledQuery): Promise<QueryResult<O>> {
    const { rows, changes } = await this.query(compiled.sql, compiled.parameters);
    return { rows: rows as O[], numAffectedRows: BigInt(changes) };
  }

  // eslint-disable-next-line require-yield
  async *streamQuery<O>(): AsyncIterableIterator<QueryResult<O>> {
    throw new Error('streamQuery is not supported in the iframe driver');
  }
}

class IframeDriver implements Driver {
  readonly #connection: IframeConnection;

  constructor(query: IframeQueryFn) {
    this.#connection = new IframeConnection(query);
  }

  async init(): Promise<void> {}
  async acquireConnection(): Promise<DatabaseConnection> {
    return this.#connection;
  }
  async releaseConnection(): Promise<void> {}

  async beginTransaction(): Promise<void> {
    throw new Error(
      'transactions are not supported in the iframe driver (use the worker side)'
    );
  }
  async commitTransaction(): Promise<void> {
    throw new Error('transactions are not supported in the iframe driver');
  }
  async rollbackTransaction(): Promise<void> {
    throw new Error('transactions are not supported in the iframe driver');
  }

  async destroy(): Promise<void> {}
}

class IframeDialect implements Dialect {
  constructor(private readonly query: IframeQueryFn) {}
  createDriver(): Driver {
    return new IframeDriver(this.query);
  }
  createQueryCompiler() {
    return new SqliteQueryCompiler();
  }
  createAdapter(): DialectAdapter {
    return new SqliteAdapter();
  }
  createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
    return new SqliteIntrospector(db);
  }
}

export interface CreateIframeKyselyOptions {
  // Override the transport. Defaults to `window.extensionSDK.db.query`.
  query?: IframeQueryFn;
}

export function createIframeKysely<Extra>(
  options: CreateIframeKyselyOptions = {}
): Kysely<SeededDatabase & Extra> {
  const query = options.query ?? defaultQuery();
  return new Kysely<SeededDatabase & Extra>({
    dialect: new IframeDialect(query),
    plugins: [new CamelCasePlugin(), new BooleanPlugin(), new SerializePlugin()]
  });
}
