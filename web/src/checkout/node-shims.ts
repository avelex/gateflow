// wallet-selector's bundles read Node's `global` and `process` while loading. Imported first by wallet.ts only.
const g = globalThis as { global?: unknown; process?: unknown };
g.global ??= globalThis;
g.process ??= { env: {}, versions: {}, browser: true };
