import type {
  KyselyPlugin,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  RootOperationNode,
  UnknownRow
} from 'kysely';

// Keys are matched after CamelCasePlugin runs, so they're camelCase here.
// Every boolean column in the reserved extension schema (0001_init.sql) must be
// listed or it arrives as a raw SQLite 0/1 integer.
const BOOLEAN_COLUMNS = new Set([
  'hasVoice', // bookEntities
  'isPreliminary', // chapterScenes
  'isMajority' // bookStyles
]);

export class BooleanPlugin implements KyselyPlugin {
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return args.node;
  }

  async transformResult(
    args: PluginTransformResultArgs
  ): Promise<QueryResult<UnknownRow>> {
    if (args.result.rows) {
      for (const row of args.result.rows) {
        for (const key of Object.keys(row as Record<string, unknown>)) {
          if (BOOLEAN_COLUMNS.has(key)) {
            const rec = row as Record<string, unknown>;
            rec[key] = rec[key] === 1 ? true : rec[key] === 0 ? false : rec[key];
          }
        }
      }
    }
    return args.result;
  }
}
