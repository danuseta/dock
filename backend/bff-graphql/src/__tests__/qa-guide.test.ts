import assert from 'node:assert';
import test from 'node:test';
import { QA_GUIDE_END, QA_GUIDE_START, currentGuide, guideLines, guideRoutes, routesFromFiles, withGuide, writeQaGuide, type QaGuideDeps } from '../integrations/qa-guide';
import { importsOf, parseRouteList, resolveImport, routesForFiles } from '../integrations/qa-guide-routes';

const ROUTE_LIST = `import { lazy } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
const LoginPage = lazy(() => import("./pages/auth/login-page"));
import RoboSidebar from "@/modules/robo/components/robo-sidebar";
import { PinGate } from "@/modules/pin-gate";
const DataPointDetailPage = lazy(() => import("./pages/robo/datapoint-detail"));
const RoboListPage = lazy(() => import("./pages/robo/robo"));
const WorkflowDetailPage = lazy(
	() => import("./pages/robo/workflow-detail")
);
const TeamSettingPage = lazy(() => import("./pages/setting/team-page"));
// { path: "commented-out", element: <TeamSettingPage /> },
const dashboardChildren = (): RouteObject[] => [
	{ index: true, element: <Navigate to="chat" replace /> },
	{
		path: "data",
		children: [
			{ path: "data-point/:dataPointId", element: <DataPointDetailPage />, loader: requireFeatureLoader(AccessFeature.DATAPOINT_ACCESS_TAB) },
		],
	},
	{
		path: "robo",
		element: <RoboSidebar />,
		children: [
			{ index: true, element: <RoboListPage /> },
			{ path: "workflow/:workflowId", element: (<PinGate title="Enter access PIN"><WorkflowDetailPage /></PinGate>) },
		],
	},
	{ path: "settings", children: [{ path: "team", element: <TeamSettingPage /> }] },
	{ path: "*", element: <NotFoundPage /> },
];
const router = createBrowserRouter([
	...dualPathRoute("/login", <LoginPage />),
	{ path: "/invite/:token", lazy: () => import("./pages/auth/invite-redirect-page") },
	dashboardRoute("/"),
]);
`;

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: unknown[]) => ({ type: 'doc', version: 1, content });

function fakeJira(value: unknown, enabled = true) {
  const state = { value, writes: [] as Array<{ key: string; field: string; value: unknown }>, events: [] as string[] };
  const deps: QaGuideDeps = {
    settings: async () => ({ enabled, field: 'customfield_10340' }),
    read: async () => state.value,
    write: async (key, field, next) => { state.writes.push({ key, field, value: next }); state.value = next; },
    frontend: async () => ({ files: ['src/v2/pages/robo/datapoint-detail.tsx', 'src/v2/pages/robo/datapoint-detail.test.tsx', 'src/v2/modules/robo/table.tsx'], routeList: ROUTE_LIST }),
    menu: async () => 'Robo > Datapoint',
    event: async (_key, kind, detail) => { state.events.push(`${kind}: ${detail}`); },
  };
  return { state, deps };
}

test('routes come from the page and route files a pull request changes, tests left out', () => {
  assert.deepStrictEqual(routesFromFiles([
    'src/v2/pages/robo/datapoint-detail.tsx',
    'src/v2/pages/settings/index.tsx',
    'src/v2/pages/contacts/contact-list-page.tsx',
    'src/v2/pages/robo/datapoint-detail.test.tsx',
    'src/app/(dashboard)/inbox/page.tsx',
    'src/v2/modules/robo/table.tsx',
  ]), ['/robo/datapoint-detail', '/settings', '/contacts/contact-list']);
  assert.deepStrictEqual(routesFromFiles(['src/app/(dashboard)/inbox/page.tsx']), ['/inbox']);
  assert.deepStrictEqual(routesFromFiles(['README.md']), []);
});

test('the block has the markers, the route line and the menu line', () => {
  assert.deepStrictEqual(guideLines({ routes: ['/robo'], menu: 'Robo > Datapoint' }), [QA_GUIDE_START, 'URL/route: /robo', 'Jalur menu: Robo > Datapoint', QA_GUIDE_END]);
  assert.deepStrictEqual(guideLines({ routes: [], menu: null }), [QA_GUIDE_START, 'URL/route: -', 'Jalur menu: -', QA_GUIDE_END]);
});

test('the block replaces the marked part only; manual content around it stays', () => {
  const lines = guideLines({ routes: ['/new'], menu: 'New' });
  const before = doc(p('Manual note from the developer'), p(QA_GUIDE_START), p('URL/route: /old'), p('Jalur menu: Old'), p(QA_GUIDE_END), p('Another manual line'));
  const after = withGuide(before, lines) as any;
  assert.deepStrictEqual(after.content.map((block: any) => block.content[0].text), ['Manual note from the developer', ...lines, 'Another manual line']);
  assert.strictEqual(after.version, 1);
  const appended = withGuide(doc(p('Only manual')), lines) as any;
  assert.deepStrictEqual(appended.content.map((block: any) => block.content[0].text), ['Only manual', ...lines]);
  assert.deepStrictEqual(withGuide(null, lines), doc(...lines.map(p)));
  assert.strictEqual(withGuide('Manual\nQA guide (DOCK)\nURL/route: /old\n/QA guide\nTail', lines), ['Manual', ...lines, 'Tail'].join('\n'));
  const noEnd = withGuide(doc(p(QA_GUIDE_START), p('URL/route: /old'), p('Manual after a lost end marker')), lines) as any;
  assert.deepStrictEqual(noEnd.content.map((block: any) => block.content[0].text), [...lines, 'Manual after a lost end marker']);
});

test('writing twice writes once: the same block is not written again', async () => {
  const { state, deps } = fakeJira(doc(p('Manual')));
  const first = await writeQaGuide(deps, 'QRD-1534');
  assert.strictEqual(first.written, true);
  assert.deepStrictEqual(first.lines, [QA_GUIDE_START, 'URL/route: /data/data-point/:dataPointId', 'Jalur menu: Robo > Datapoint', QA_GUIDE_END]);
  assert.strictEqual(state.writes[0].field, 'customfield_10340');
  assert.deepStrictEqual(currentGuide(state.value), first.lines);
  const second = await writeQaGuide(deps, 'QRD-1534');
  assert.deepStrictEqual({ written: second.written, reason: second.reason }, { written: false, reason: 'unchanged' });
  assert.strictEqual(state.writes.length, 1);
  assert.deepStrictEqual(state.events, ['JIRA: QA guide written to customfield_10340']);
});

test('the move to UAT writes only with the switch on; the manual action writes either way', async () => {
  const off = fakeJira(null, false);
  assert.deepStrictEqual(await writeQaGuide(off.deps, 'QRD-1534'), { written: false, reason: 'off', lines: [] });
  assert.strictEqual(off.state.writes.length, 0);
  assert.strictEqual((await writeQaGuide(off.deps, 'QRD-1534', true)).written, true);
  assert.strictEqual(off.state.writes.length, 1);
});

test('the route list gives each route its full path and the page files its element loads', () => {
  const routes = parseRouteList(ROUTE_LIST);
  const byPath = new Map<string, string[]>();
  for (const route of routes) byPath.set(route.path, [...(byPath.get(route.path) ?? []), ...route.files]);
  assert.deepStrictEqual(byPath.get('/data/data-point/:dataPointId'), ['src/v2/pages/robo/datapoint-detail']);
  assert.deepStrictEqual(byPath.get('/robo'), ['src/v2/pages/robo/robo', 'src/v2/modules/robo/components/robo-sidebar'], 'an index route has its parent path; the layout is the parent route');
  assert.deepStrictEqual(byPath.get('/robo/workflow/:workflowId'), ['src/v2/modules/pin-gate', 'src/v2/pages/robo/workflow-detail'], 'a page wrapped in a gate');
  assert.deepStrictEqual(byPath.get('/settings/team'), ['src/v2/pages/setting/team-page']);
  assert.deepStrictEqual(byPath.get('/login'), ['src/v2/pages/auth/login-page']);
  assert.deepStrictEqual(byPath.get('/invite/:token'), ['src/v2/pages/auth/invite-redirect-page']);
  assert.ok(!routes.some((route) => route.path.includes('*') || route.path.includes('commented-out')));
});

test('a changed page maps to its real routes; a changed component maps through the page that imports it', () => {
  const routes = parseRouteList(ROUTE_LIST);
  assert.deepStrictEqual(routesForFiles(routes, ['src/v2/pages/robo/datapoint-detail.tsx', 'src/v2/pages/setting/team-page.tsx', 'src/v2/pages/robo/datapoint-detail.test.tsx']), ['/data/data-point/:dataPointId', '/settings/team']);
  assert.deepStrictEqual(routesForFiles(routes, ['src/v2/modules/robo/components/robo-sidebar.tsx']), ['/robo'], 'a layout component maps to the route that renders it');
  const imports = new Map([['src/v2/pages/robo/robo', importsOf('import { Table } from "@/modules/robo/components/robo-table";\nimport x from "../../lib/x";', 'src/v2/pages/robo/robo.tsx')]]);
  assert.deepStrictEqual(routesForFiles(routes, ['src/v2/modules/robo/components/robo-table.tsx'], imports), ['/robo']);
  assert.strictEqual(resolveImport('../../lib/x', 'src/v2/pages/robo/robo.tsx'), 'src/v2/lib/x');
  assert.strictEqual(resolveImport('react', 'src/v2/pages/robo/robo.tsx'), null);
});

test('the URL line uses the route list at the head, reads nearby pages for a component, and falls back to a marked estimate', async () => {
  const reads: string[] = [];
  const pages: Record<string, string> = { 'src/v2/pages/robo/robo.tsx': 'import { Table } from "@/modules/robo/components/robo-table";' };
  const readFile = async (path: string) => { reads.push(path); return pages[path] ?? null; };
  assert.deepStrictEqual(await guideRoutes({ files: ['src/v2/pages/robo/datapoint-detail.tsx'], routeList: ROUTE_LIST, readFile }), { routes: ['/data/data-point/:dataPointId'], estimated: false });
  assert.strictEqual(reads.length, 0, 'a changed page needs no other read');
  assert.deepStrictEqual(await guideRoutes({ files: ['src/v2/modules/robo/components/robo-table.tsx'], routeList: ROUTE_LIST, readFile }), { routes: ['/robo'], estimated: false });
  assert.ok(reads.includes('src/v2/pages/robo/robo.tsx'));
  assert.ok(!reads.some((path) => path.includes('setting')), 'only pages near the changed module are read');
  assert.deepStrictEqual(await guideRoutes({ files: ['src/v2/pages/robo/datapoint-detail.tsx'], routeList: null }), { routes: ['/robo/datapoint-detail'], estimated: true });
  assert.deepStrictEqual(guideLines({ routes: ['/robo/datapoint-detail'], menu: null, estimated: true })[1], 'URL/route: /robo/datapoint-detail (perkiraan)');
  assert.deepStrictEqual(await guideRoutes({ files: ['README.md'], routeList: null }), { routes: [], estimated: false });
});
