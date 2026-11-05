// Serves the built web app (WEB_DIST) with an SPA fallback to index.html.
import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import type { Res } from "./types.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

const file = (p: string): Res => ({
  status: 200,
  body: readFileSync(p),
  headers: { "content-type": TYPES[extname(p)] ?? "application/octet-stream" },
});

/// A file under `dir`, `index.html` for any other non-API path, or `undefined` (the caller answers 404 JSON).
export function serveStatic(dir: string, pathname: string): Res | undefined {
  if (/^\/(console|checkout|api)(\/|$)/.test(pathname)) return undefined;
  const root = normalize(dir);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const target = normalize(join(root, decoded));
  if (target.startsWith(root + sep) && isFile(target)) return file(target);
  const index = join(root, "index.html");
  return isFile(index) ? file(index) : undefined;
}
