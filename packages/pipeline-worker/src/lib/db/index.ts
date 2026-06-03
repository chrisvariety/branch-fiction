import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import {
  CamelCasePlugin,
  CompiledQuery,
  IdentifierNode,
  Kysely,
  RawNode,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  createQueryId,
  type DatabaseConnection,
  type DatabaseIntrospector,
  type Dialect,
  type DialectAdapter,
  type Driver,
  type QueryCompiler,
  type QueryResult,
  type TransactionSettings
} from 'kysely';
import { SerializePlugin, defaultSerializer } from 'kysely-plugin-serialize';

import { BooleanPlugin } from '@/app/lib/db/boolean-plugin';
import type { Database as DB } from '@/app/lib/db/types';

class ConnectionMutex {
  #deferred?: PromiseWithResolvers<void>;

  async lock(): Promise<void> {
    while (this.#deferred) await this.#deferred.promise;
    this.#deferred = Promise.withResolvers<void>();
  }

  unlock(): void {
    const d = this.#deferred;
    this.#deferred = undefined;
    d?.resolve();
  }
}

class NodeSqliteConnection implements DatabaseConnection {
  constructor(private readonly db: DatabaseSync) {}

  executeQuery<O>(compiled: CompiledQuery): Promise<QueryResult<O>> {
    const stmt = this.db.prepare(compiled.sql);
    const params = compiled.parameters as ReadonlyArray<SQLInputValue>;

    if (stmt.columns().length > 0) {
      return Promise.resolve({ rows: stmt.all(...params) as O[] });
    }

    const { changes, lastInsertRowid } = stmt.run(...params);
    return Promise.resolve({
      rows: [],
      numAffectedRows: BigInt(changes),
      insertId: BigInt(lastInsertRowid)
    });
  }

  async *streamQuery<O>(compiled: CompiledQuery): AsyncIterableIterator<QueryResult<O>> {
    const stmt = this.db.prepare(compiled.sql);
    const params = compiled.parameters as ReadonlyArray<SQLInputValue>;
    for (const row of stmt.iterate(...params)) {
      yield { rows: [row as O] };
    }
  }
}

function savepointCommand(command: string, name: string): RawNode {
  return RawNode.createWithChildren([
    RawNode.createWithSql(`${command} `),
    IdentifierNode.create(name)
  ]);
}

class NodeSqliteDriver implements Driver {
  readonly #db: DatabaseSync;
  readonly #connection: NodeSqliteConnection;
  readonly #mutex = new ConnectionMutex();

  constructor(db: DatabaseSync) {
    this.#db = db;
    this.#connection = new NodeSqliteConnection(db);
  }

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    await this.#mutex.lock();
    return this.#connection;
  }

  async releaseConnection(): Promise<void> {
    this.#mutex.unlock();
  }

  async beginTransaction(c: DatabaseConnection, _s: TransactionSettings): Promise<void> {
    await c.executeQuery(CompiledQuery.raw('begin'));
  }

  async commitTransaction(c: DatabaseConnection): Promise<void> {
    await c.executeQuery(CompiledQuery.raw('commit'));
  }

  async rollbackTransaction(c: DatabaseConnection): Promise<void> {
    await c.executeQuery(CompiledQuery.raw('rollback'));
  }

  async savepoint(
    c: DatabaseConnection,
    name: string,
    compileQuery: QueryCompiler['compileQuery']
  ): Promise<void> {
    await c.executeQuery(
      compileQuery(savepointCommand('savepoint', name), createQueryId())
    );
  }

  async rollbackToSavepoint(
    c: DatabaseConnection,
    name: string,
    compileQuery: QueryCompiler['compileQuery']
  ): Promise<void> {
    await c.executeQuery(
      compileQuery(savepointCommand('rollback to', name), createQueryId())
    );
  }

  async releaseSavepoint(
    c: DatabaseConnection,
    name: string,
    compileQuery: QueryCompiler['compileQuery']
  ): Promise<void> {
    await c.executeQuery(
      compileQuery(savepointCommand('release', name), createQueryId())
    );
  }

  async destroy(): Promise<void> {
    this.#db.close();
  }
}

class NodeSqliteDialect implements Dialect {
  constructor(private readonly db: DatabaseSync) {}
  createDriver(): Driver {
    return new NodeSqliteDriver(this.db);
  }
  createQueryCompiler(): QueryCompiler {
    return new SqliteQueryCompiler();
  }
  createAdapter(): DialectAdapter {
    return new SqliteAdapter();
  }
  createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
    return new SqliteIntrospector(db);
  }
}

export function createKyselyDb(dbPath: string): Kysely<DB> {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  // FKs OFF: the worker DB references rows that live in main (books, users,
  // book_imports). Main DB enforces FKs at sync time via deferred constraints.
  db.exec('PRAGMA foreign_keys = OFF');

  return new Kysely<DB>({
    dialect: new NodeSqliteDialect(db),
    plugins: [
      new CamelCasePlugin(),
      new SerializePlugin({
        serializer: (value) =>
          typeof value === 'boolean' ? (value ? 1 : 0) : defaultSerializer(value)
      }),
      new BooleanPlugin()
    ]
  });
}

export function initDb(dbPath: string): void {
  setDb(createKyselyDb(dbPath));
}

let _db: Kysely<DB> | null = null;

export function setDb(instance: Kysely<DB>): void {
  _db = instance;
}

export function getDb(): Kysely<DB> {
  if (!_db) {
    throw new Error(
      'DB not initialized — host should call init({ dbPath, ... }) before any handler runs'
    );
  }
  return _db;
}
