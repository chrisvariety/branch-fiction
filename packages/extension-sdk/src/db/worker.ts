import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import {
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

export type NodeSqliteDialectOptions = {
  // `immediate` avoids deferred-to-write upgrade deadlocks under concurrent writers.
  beginTransactionSql?: string;
};

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
  readonly #beginSql: string;

  constructor(db: DatabaseSync, beginSql: string) {
    this.#db = db;
    this.#connection = new NodeSqliteConnection(db);
    this.#beginSql = beginSql;
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
    await c.executeQuery(CompiledQuery.raw(this.#beginSql));
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

// Kysely dialect backed by node:sqlite's synchronous DatabaseSync.
export class NodeSqliteDialect implements Dialect {
  readonly #db: DatabaseSync;
  readonly #beginSql: string;

  constructor(db: DatabaseSync, options?: NodeSqliteDialectOptions) {
    this.#db = db;
    this.#beginSql = options?.beginTransactionSql ?? 'begin immediate';
  }

  createDriver(): Driver {
    return new NodeSqliteDriver(this.#db, this.#beginSql);
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
