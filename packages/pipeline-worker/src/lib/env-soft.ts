// Third-party libs probe and mutate many env vars at import/init time
// (e.g. `debug` deletes `process.env.DEBUG`). Strict `--allow-env=...`
// causes Deno to throw `NotCapable` on each unallowed call, breaking
// module load. So we work around that.
const realGet = Deno.env.get.bind(Deno.env);
const realHas = Deno.env.has.bind(Deno.env);
const realToObject = Deno.env.toObject.bind(Deno.env);
const realSet = Deno.env.set.bind(Deno.env);
const realDelete = Deno.env.delete.bind(Deno.env);

function isNotCapable(e: unknown): boolean {
  return e instanceof Error && e.name === 'NotCapable';
}

Deno.env.get = (key: string): string | undefined => {
  try {
    return realGet(key);
  } catch (e) {
    if (isNotCapable(e)) return undefined;
    throw e;
  }
};

Deno.env.has = (key: string): boolean => {
  try {
    return realHas(key);
  } catch (e) {
    if (isNotCapable(e)) return false;
    throw e;
  }
};

Deno.env.toObject = (): Record<string, string> => {
  try {
    return realToObject();
  } catch (e) {
    if (isNotCapable(e)) return {};
    throw e;
  }
};

Deno.env.set = (key: string, value: string): void => {
  try {
    realSet(key, value);
  } catch (e) {
    if (isNotCapable(e)) return;
    throw e;
  }
};

Deno.env.delete = (key: string): void => {
  try {
    realDelete(key);
  } catch (e) {
    if (isNotCapable(e)) return;
    throw e;
  }
};
