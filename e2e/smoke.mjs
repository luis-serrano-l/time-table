// End-to-end check against the production build, in the installed Chrome.
// Run: npm run build && npm run e2e      (screenshots: e2e/shots, if SHOTS=1)
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const PORT = 4179;
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS === '1';
if (SHOTS) mkdirSync('e2e/shots', { recursive: true });

const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((ok, fail) => {
  server.stdout.on('data', (d) => String(d).includes('localhost') && ok());
  server.on('exit', () => fail(new Error('preview server did not start')));
});

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.clock.install({ time: new Date(2026, 10, 18, 9, 2) });
  await page.goto(URL);
  const shot = async (name) => SHOTS && page.screenshot({ path: `e2e/shots/${name}.png` });
  const dock = page.locator('.dock');

  // Plan the day
  await page.getByRole('button', { name: 'Plan the day' }).click();
  for (const t of ['Write the report', 'Review pull requests', 'Reply to email']) {
    await page.getByLabel('New task for today').fill(t);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Lengthen Write the report' }).click();
  await page.getByRole('button', { name: 'Move Reply to email earlier' }).click();
  await shot('1-plan');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  assert.equal(await page.locator('.slot').count(), 3);
  assert.deepEqual(await page.locator('.slot-title').allTextContents(), [
    'Write the report',
    'Reply to email',
    'Review pull requests',
  ]);

  // One tap starts, another tap switches
  await page.locator('.slot', { hasText: 'Write the report' }).click();
  await page.clock.fastForward('32:00');
  await expect(dock, 'Write the report');
  await expect(dock, '32:00');
  await page.locator('.slot', { hasText: 'Reply to email' }).click();
  await page.clock.fastForward('10:00');

  // Interruption parks the task and gives it back
  await page.getByRole('button', { name: 'Interruption', exact: true }).click();
  await page.clock.fastForward('04:00');
  await expect(dock, 'Reply to email is waiting');
  await shot('2-interruption');
  await page.getByRole('button', { name: 'Back to work' }).click();
  await page.clock.fastForward('06:00');
  await expect(dock, 'Reply to email');

  // Something unplanned
  await page.getByRole('button', { name: 'Start something unplanned' }).click();
  await page.getByLabel('Name of the task to start now').fill('Call the bank');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.clock.fastForward('05:00');
  await expect(dock, 'Call the bank');
  await expect(page.locator('.tally'), 'Switches2');
  await expect(page.locator('.tally'), 'Deep stretches1');
  await expect(page.locator('.tally'), 'Logged53m');
  await shot('3-day');

  // The timer survives a reload
  await page.reload();
  await expect(dock, 'Call the bank');
  await expect(dock, '5:0');

  // Pause, export, erase, import
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(dock, 'Nothing running');
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export backup' }).click(),
  ]);
  const file = await download.path();
  const backup = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(backup.format, 'time-table-log');
  assert.ok(backup.events.length > 10);
  await shot('4-data');
  await page.getByRole('button', { name: 'Erase everything' }).click();
  await page.getByRole('button', { name: 'Erase everything' }).click();
  await expect(page.locator('.dialog'), 'Everything was erased');
  await page.locator('input[type=file]').setInputFiles(file);
  await expect(page.locator('.dialog'), `Imported ${backup.events.length} new entries`);
  await page.locator('input[type=file]').setInputFiles(file);
  await expect(page.locator('.dialog'), 'Nothing new in that backup');
  await page.getByRole('button', { name: 'Close' }).click();
  assert.equal(await page.locator('.slot').count(), 3);
  await expect(page.locator('.tally'), 'Logged53m');

  // Installable and offline: manifest served, service worker takes control
  const manifest = await (await page.request.get(URL + 'manifest.webmanifest')).json();
  assert.equal(manifest.display, 'standalone');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await ctx.setOffline(true);
  await page.reload();
  await expect(page.locator('.tally'), 'Logged53m');
  await ctx.setOffline(false);

  // A 5-minute task gets its own room on the timeline, and Finish ends it early
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.getByLabel('New task for today').fill('Stretch');
  await page.locator('.plan-add select').selectOption('5');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const boxes = await page.locator('.slot').evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect()).map((r) => ({ top: r.top, bottom: r.bottom })).sort((a, b) => a.top - b.top),
  );
  assert.equal(boxes.length, 4);
  for (let i = 1; i < boxes.length; i++) {
    assert.ok(boxes[i].top >= boxes[i - 1].bottom - 0.5, `slot ${i} overlaps the one before it`);
  }
  await page.locator('.slot', { hasText: 'Stretch' }).click();
  await page.clock.fastForward('02:00');
  await expect(dock, 'Stretch');
  await shot('5-short');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(dock, 'Nothing running');
  assert.equal(await page.locator('.slot.is-done', { hasText: 'Stretch' }).count(), 1);

  // Pin a task to a clock time
  const openPlan = () => page.getByRole('button', { name: 'Plan', exact: true }).click();
  const closePlan = () => page.getByRole('button', { name: 'Done', exact: true }).click();
  await openPlan();
  await page.getByRole('button', { name: 'Pin Review pull requests to a time' }).click();
  await page.getByLabel('Time for Review pull requests').fill('14:00');
  await shot('6-pinned');
  await closePlan();
  assert.match(
    await page.locator('.slot', { hasText: 'Review pull requests' }).getAttribute('aria-label'),
    /planned 14:00 for 30m/,
  );

  // Another day: plan it ahead, no timers there, and back
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.locator('h1'), 'Thursday');
  assert.equal(await page.locator('.tl-now').count(), 0);
  assert.equal(await page.locator('.slot').count(), 0);
  await openPlan();
  await page.getByLabel('New task for Thursday').fill('Prepare slides');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await closePlan();
  assert.equal(await page.locator('div.slot').count(), 1);
  await page.getByRole('button', { name: 'Back to today' }).click();
  await expect(page.locator('h1'), 'Wednesday');
  assert.equal(await page.locator('.slot').count(), 4);

  // Repeat a task every Wednesday: there next week, not the day before
  await openPlan();
  await page.getByRole('button', { name: 'Repeat Stretch' }).click();
  await shot('7-repeat');
  await page.getByRole('button', { name: 'Save repeat' }).click();
  await closePlan();
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.locator('h1'), 'Tuesday');
  assert.equal(await page.locator('.slot', { hasText: 'Stretch' }).count(), 0);
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.locator('h1'), 'Wednesday');
  assert.equal(await page.locator('.slot.is-pinned', { hasText: 'Stretch' }).count(), 1);
  await shot('8-next-week');
  await page.getByRole('button', { name: 'Back to today' }).click();

  // A project: only logged time uses up its hours; then finish it or add time
  await openPlan();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Thesis');
  await page.getByLabel('Total hours').fill('1');
  await page.getByRole('button', { name: 'Create project' }).click();
  const project = page.locator('.project-list li', { hasText: 'Thesis' });
  await expect(project, '0m of 1h');
  await page.getByRole('button', { name: 'Put Thesis on today' }).click();
  await closePlan();
  await page.locator('.slot', { hasText: 'Thesis' }).click();
  await page.clock.fastForward('01:01:00');
  await expect(dock, '1h 01m of 1h');
  // The clock jumped an hour with a timer running: the app asks, and never stops it itself
  await expect(page.locator('.notice-ask'), 'Still on Thesis?');
  await page.getByRole('button', { name: 'Still working' }).click();
  assert.equal(await page.locator('.notice-ask').count(), 0);
  await expect(dock, 'Thesis');
  await openPlan();
  await expect(project, '1h 01m of 1h');
  await expect(project, 'The hours are used up');
  await project.scrollIntoViewIfNeeded();
  await shot('9-project');
  await project.getByRole('button', { name: 'Add time' }).click();
  await project.getByLabel('Hours to add').fill('2');
  await project.getByRole('button', { name: 'Add hours' }).click();
  await expect(project, '1h 01m of 3h');
  await closePlan();

  // Forgotten for three hours: say when it really ended
  await page.clock.fastForward('03:00:00');
  await expect(page.locator('.notice-ask'), 'Still on Thesis?');
  if (SHOTS) await new Promise((r) => setTimeout(r, 500));
  await shot('10-forgotten');
  await page.getByLabel('It ended at').fill('11:30');
  await page.getByRole('button', { name: 'Set end' }).click();
  await expect(dock, 'Nothing running');
  assert.equal(await page.locator('.notice-ask').count(), 0);
  await openPlan();
  await expect(project, '1h 29m of 3h');

  // Delete, then take it back
  await page.getByRole('button', { name: 'Delete Call the bank' }).click();
  await expect(page.locator('.toast'), 'Deleted Call the bank');
  await shot('11-undo');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Delete Call the bank' }).count(), 1);
  assert.equal(await page.locator('.toast').count(), 0);
  await closePlan();

  // The next morning: yesterday's unfinished tasks are offered
  await page.clock.fastForward('19:00:00');
  await expect(page.locator('h1'), 'Thursday');
  assert.equal(await page.locator('.slot').count(), 1);
  await openPlan();
  await expect(page.locator('.carry'), 'From Wednesday: 3 unfinished');
  await shot('12-carry');
  await page.getByRole('button', { name: 'Add all' }).click();
  assert.equal(await page.locator('.carry').count(), 0);
  await closePlan();
  assert.equal(await page.locator('.slot').count(), 4);

  if (SHOTS) {
    await page.emulateMedia({ colorScheme: 'dark' });
    await shot('13-dark');
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.emulateMedia({ colorScheme: 'light' });
    await shot('14-desktop');
  }
  assert.deepEqual(errors, []);
  console.log('smoke test passed');
} finally {
  await browser.close();
  server.kill();
}

async function expect(locator, text) {
  const wanted = text.replace(/\s+/g, '');
  const deadline = Date.now() + 5000;
  let got = '';
  while (Date.now() < deadline) {
    got = ((await locator.first().textContent()) ?? '').replace(/\s+/g, '');
    if (got.includes(wanted)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`expected "${text}" in "${got}"`);
}
