import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyState } from '../components/EmptyState';
import { AllClearScene } from '../components/empty/scenes/AllClearScene';
import { BubblesScene } from '../components/empty/scenes/BubblesScene';
import { CalendarScene } from '../components/empty/scenes/CalendarScene';
import { ChartScene } from '../components/empty/scenes/ChartScene';
import { DeskScene } from '../components/empty/scenes/DeskScene';
import { FilmScene } from '../components/empty/scenes/FilmScene';
import { FloatingScene } from '../components/empty/scenes/FloatingScene';
import { KanbanScene } from '../components/empty/scenes/KanbanScene';
import { RackScene } from '../components/empty/scenes/RackScene';
import { RobotScene } from '../components/empty/scenes/RobotScene';
import { SearchScene } from '../components/empty/scenes/SearchScene';
import { SkeletonScene } from '../components/empty/scenes/SkeletonScene';
import { TerminalScene } from '../components/empty/scenes/TerminalScene';

test('an empty state is a status region whose animation is hidden from screen readers', () => {
  const html = renderToStaticMarkup(
    <EmptyState scene={<KanbanScene />} title="No tickets found" description="Try adjusting your search query." action={<button type="button">Refresh</button>} />,
  );
  assert.match(html, /^<div role="status"/);
  assert.match(html, /<div class="dock-empty-scene[^"]*" aria-hidden="true"><svg/);
  assert.match(html, /<h2[^>]*>No tickets found<\/h2>/);
  assert.match(html, />Try adjusting your search query\.</);
  assert.match(html, /<button type="button">Refresh<\/button>/);
});

test('a panel empty state uses a smaller scene and a plain title', () => {
  const html = renderToStaticMarkup(<EmptyState size="panel" scene={<FloatingScene />} title="No session open" />);
  assert.match(html, /h-\[88px\] w-\[160px\]/);
  assert.match(html, /<p[^>]*>No session open<\/p>/);
  assert.doesNotMatch(html, /<h2/);
});

test('every scene renders an svg', () => {
  const scenes = [AllClearScene, BubblesScene, CalendarScene, ChartScene, DeskScene, FilmScene, FloatingScene, KanbanScene, RackScene, RobotScene, SearchScene, SkeletonScene, TerminalScene];
  for (const Scene of scenes) assert.match(renderToStaticMarkup(<Scene />), /^<svg viewBox="0 0 220 120"/, Scene.name);
});

test('two scenes on one page get their own clip path', () => {
  const html = renderToStaticMarkup(<><TerminalScene /><TerminalScene /><FilmScene /></>);
  const ids = [...html.matchAll(/<clipPath id="([^"]+)"/g)].map((match) => match[1]);
  assert.strictEqual(ids.length, 3);
  assert.strictEqual(new Set(ids).size, 3);
});
