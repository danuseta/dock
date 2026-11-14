// The real routes of a Qonflo frontend change, read from the app's route list (src/v2/route-lists.tsx at the pull
// request head): each route's element names page components, the file declares where each component is imported
// from, and a changed file maps to the routes whose page is that file, or whose page imports it (one level).

export const ROUTE_LIST_PATH = 'src/v2/route-lists.tsx';
const SOURCE_ROOT = 'src/v2/';
const MAX_ROUTES = 3;

export interface ListedRoute { path: string; files: string[] }

const CODE_EXT = /\.(tsx?|jsx?)$/;

/** A repo path without its extension or a trailing /index, the way imports name a file. */
export const modulePath = (path: string) => path.replace(/\\/g, '/').replace(CODE_EXT, '').replace(/\/index$/, '');

/** Where an import points in the repo: `@/` is src/v2, `./` and `../` are relative to the importing file; packages are null. */
export function resolveImport(spec: string, fromFile: string): string | null {
  if (spec.startsWith('@/')) return modulePath(SOURCE_ROOT + spec.slice(2));
  if (!spec.startsWith('.')) return null;
  const parts = fromFile.replace(/\\/g, '/').split('/').slice(0, -1);
  for (const segment of spec.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.' && segment) parts.push(segment);
  }
  return modulePath(parts.join('/'));
}

/** The files a source imports, statically or lazily, resolved to repo paths. */
export function importsOf(source: string, fromFile: string): string[] {
  const specs = [
    ...[...source.matchAll(/\bimport\s+[^'"`;]*?\bfrom\s*["']([^"']+)["']/g)].map((match) => match[1]),
    ...[...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]),
  ];
  return [...new Set(specs.map((spec) => resolveImport(spec, fromFile)).filter((path): path is string => Boolean(path)))];
}

/** Component name to the file it comes from: `const X = lazy(() => import("..."))` and `import X from "..."`. */
function componentFiles(source: string, file: string): Map<string, string> {
  const map = new Map<string, string>();
  const add = (name: string, spec: string) => {
    const resolved = resolveImport(spec, file);
    if (resolved) map.set(name, resolved);
  };
  for (const match of source.matchAll(/\bconst\s+([A-Z]\w*)\s*=\s*lazy\(\s*\(\s*\)\s*=>\s*import\(\s*["']([^"']+)["']\s*\)/g)) add(match[1], match[2]);
  for (const match of source.matchAll(/\bimport\s+([A-Z]\w*)\s+from\s*["']([^"']+)["']/g)) add(match[1], match[2]);
  for (const match of source.matchAll(/\bimport\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
    for (const name of match[1].split(',').map((item) => item.trim().split(/\s+as\s+/).pop()!.trim()).filter((item) => /^[A-Z]/.test(item))) add(name, match[2]);
  }
  return map;
}

interface Frame { kind: string; route: { path: string | null; index: boolean; tags: string[]; lazy: string[]; parent: Frame | null } | null }

/** Joins a route path under its parent the way React Router does; a top level relative path hangs under the dashboard at /. */
const joinPath = (parent: string | null, path: string) => (path.startsWith('/') ? path : `${parent && parent !== '/' ? parent : ''}/${path}`);

/** The routes the route list declares, each with the page files its element (or lazy import) loads. */
export function parseRouteList(source: string, file = ROUTE_LIST_PATH): ListedRoute[] {
  const components = componentFiles(source, file);
  const stack: Frame[] = [];
  const closed: Array<NonNullable<Frame['route']>> = [];
  const innermostObject = () => [...stack].reverse().find((frame) => frame.kind === '{') ?? null;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); if (i < 0) break; continue; }
    if (char === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i + 2) + 1; if (i <= 0) break; continue; }
    const object = innermostObject();
    if (object?.route && /[^\w$]/.test(source[i - 1] ?? ' ')) {
      const rest = source.slice(i, i + 300);
      const path = /^path\s*:\s*(["'`])([^"'`]*)\1/.exec(rest);
      if (path) { object.route.path = path[2]; i += path[0].length - 1; continue; }
      if (/^index\s*:\s*true\b/.test(rest)) object.route.index = true;
      const lazyImport = /^import\(\s*["']([^"']+)["']\s*\)/.exec(rest);
      if (lazyImport) { const resolved = resolveImport(lazyImport[1], file); if (resolved) object.route.lazy.push(resolved); i += lazyImport[0].length - 1; continue; }
      const tag = /^<([A-Z][A-Za-z0-9]*)/.exec(rest);
      if (tag) object.route.tags.push(tag[1]);
    }
    if (char === '"' || char === "'" || char === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== char) j += source[j] === '\\' ? 2 : 1;
      i = j;
      continue;
    }
    if (char === '{' || char === '[' || char === '(') {
      const parentObject = innermostObject();
      stack.push({ kind: char, route: char === '{' ? { path: null, index: false, tags: [], lazy: [], parent: parentObject } : null });
    } else if (char === '}' || char === ']' || char === ')') {
      const frame = stack.pop();
      const route = frame?.route;
      if (!route) continue;
      // A brace that is not a route (a JSX expression, a loader argument) gives its components to the route around it.
      if (route.path === null && !route.index) route.parent?.route?.tags.push(...route.tags);
      else closed.push(route);
    }
  }
  const fullPath = (route: NonNullable<Frame['route']>): string | null => {
    const parent = route.parent?.route ?? null;
    const above = parent && (parent.path !== null || parent.index) ? fullPath(parent) : null;
    if (route.index) return above ?? '/';
    return route.path === null ? above : joinPath(above, route.path);
  };
  const routes: ListedRoute[] = [];
  for (const route of closed) {
    const path = fullPath(route);
    const files = [...route.tags.map((tag) => components.get(tag)).filter((item): item is string => Boolean(item)), ...route.lazy];
    if (path && !path.includes('*') && files.length) routes.push({ path, files });
  }
  for (const match of source.matchAll(/\bdualPathRoute\(\s*["']([^"']+)["']\s*,\s*<([A-Z]\w*)/g)) {
    const page = components.get(match[2]);
    if (page) routes.push({ path: match[1], files: [page] });
  }
  return routes;
}

/** The pages of the routes, each once, for reading their imports. */
export const routePages = (routes: readonly ListedRoute[]) => [...new Set(routes.flatMap((route) => route.files))];

/**
 * The real routes a change touches: a route whose page is a changed file, else whose page imports one (`pageImports`
 * holds the imports of the pages that were read). At most three, in route list order.
 */
export function routesForFiles(routes: readonly ListedRoute[], changedFiles: readonly string[], pageImports: ReadonlyMap<string, readonly string[]> = new Map()): string[] {
  const changed = new Set(changedFiles.filter((path) => CODE_EXT.test(path)).map(modulePath));
  const touches = (page: string) => changed.has(page) || (pageImports.get(page) ?? []).some((path) => changed.has(path));
  const out: string[] = [];
  for (const route of routes) {
    if (!route.files.some(touches) || out.includes(route.path)) continue;
    out.push(route.path);
    if (out.length >= MAX_ROUTES) break;
  }
  return out;
}

/** The pages worth reading for a changed component: the ones whose folder shares the component's module name. */
export function pagesNear(routes: readonly ListedRoute[], changedFiles: readonly string[], max = 12): string[] {
  const modules = changedFiles.map((path) => /(?:^|\/)modules\/([^/]+)\//.exec(path.replace(/\\/g, '/'))?.[1]).filter((name): name is string => Boolean(name));
  if (!modules.length) return [];
  const stem = (name: string) => name.toLowerCase().replace(/s$/, '');
  return routePages(routes).filter((page) => {
    const folder = /(?:^|\/)pages\/([^/]+)\//.exec(page)?.[1];
    return folder && modules.some((name) => stem(name) === stem(folder));
  }).slice(0, max);
}
