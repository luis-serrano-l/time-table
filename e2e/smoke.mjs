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

  const card = (t) => page.locator('.card', { hasText: t });
  const titles = () => page.locator('.cards .card-text strong').allTextContents();
  const addTask = async (t) => {
    await page.getByLabel(/^Name of a task for/).fill(t);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  };

  // A task needs only a name, and goes on the day
  await expect(page.locator('.tasks'), 'Nothing on today yet');
  for (const t of ['Write the report', 'Review pull requests', 'Reply to email']) await addTask(t);
  assert.deepEqual(await titles(), ['Write the report', 'Review pull requests', 'Reply to email']);
  await shot('1-tasks');

  // Drag the third card to the top; the arrow keys do the same
  const grip = page.getByRole('button', { name: /^Move Reply to email/ });
  const box = await grip.boundingBox();
  const first = await card('Write the report').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, first.y + 10, { steps: 8 });
  await shot('2-drag');
  await page.mouse.up();
  assert.deepEqual(await titles(), ['Reply to email', 'Write the report', 'Review pull requests']);
  await page.getByRole('button', { name: /^Move Reply to email/ }).press('ArrowDown');
  assert.deepEqual(await titles(), ['Write the report', 'Reply to email', 'Review pull requests']);

  // One tap on a card starts it, a tap on another switches
  await page.getByRole('button', { name: /^Write the report.*Start$/ }).click();
  await page.clock.fastForward('32:00');
  await expect(dock, 'Write the report');
  await expect(dock, '32:00');
  assert.deepEqual((await titles())[0], 'Write the report');
  await expect(page.locator('.log'), '09:02to nowWrite the report');
  await page.getByRole('button', { name: /^Reply to email.*Start$/ }).click();
  await page.clock.fastForward('10:00');
  assert.deepEqual((await titles())[0], 'Reply to email');

  // Interruption parks the task and gives it back
  await page.getByRole('button', { name: 'Interruption', exact: true }).click();
  await page.clock.fastForward('04:00');
  await expect(dock, 'Reply to email is waiting');
  await page.getByRole('button', { name: 'Back to work' }).click();
  await page.clock.fastForward('06:00');
  await expect(dock, 'Reply to email');

  // Something new, started at once
  await page.getByRole('button', { name: 'Start something new right now' }).click();
  await page.getByLabel('Name of the task to start now').fill('Call the bank');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.clock.fastForward('05:00');
  await expect(dock, 'Call the bank');
  await expect(page.locator('.tally'), 'Switches2');
  await expect(page.locator('.tally'), 'Deep stretches1');
  await expect(page.locator('.tally'), 'Logged53m');
  await shot('3-day');

  // The timer survives a reload, and so does the order
  await page.reload();
  await expect(dock, 'Call the bank');
  assert.deepEqual(await titles(), ['Call the bank', 'Write the report', 'Reply to email', 'Review pull requests']);

  // Pause from the card, finish from the dock
  await page.getByRole('button', { name: /^Call the bank.*Pause$/ }).click();
  await expect(dock, 'Nothing running');
  await page.getByRole('button', { name: /^Call the bank.*Start$/ }).click();
  await page.clock.fastForward('01:00');
  await dock.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(dock, 'Nothing running');
  await expect(page.locator('.toast'), 'Finished Call the bank');
  await page.clock.fastForward('00:09');
  await page.locator('.fold', { hasText: 'Done' }).click();
  await expect(page.locator('.card.is-done'), 'Call the bank');

  // An estimate is optional
  await page.getByRole('button', { name: 'Change Review pull requests' }).click();
  await page.getByLabel('Estimate', { exact: true }).selectOption('30');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(card('Review pull requests'), '0m of 30m');

  // Backup round trip
  await page.getByRole('button', { name: 'Data' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export backup' }).click(),
  ]);
  const file = await download.path();
  const backup = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(backup.format, 'time-table-log');
  assert.equal(backup.version, 3);
  await shot('4-data');
  await page.getByRole('button', { name: 'Erase everything' }).click();
  await page.getByRole('button', { name: 'Erase everything' }).click();
  await expect(page.locator('.dialog'), 'Everything was erased');
  await page.locator('input[type=file]').setInputFiles(file);
  await expect(page.locator('.dialog'), `Imported ${backup.events.length} new entries`);
  await page.locator('input[type=file]').setInputFiles(file);
  await expect(page.locator('.dialog'), 'Nothing new in that backup');
  await page.getByRole('button', { name: 'Close' }).click();

  // The log can be corrected: an end moved, an overlap refused, an entry written in, one deleted
  await page.getByRole('button', { name: /^Write the report, 09:02 to 09:34/ }).click();
  await page.locator('.dialog input[type=time]').last().fill('09:50');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.dialog'), 'That overlaps Reply to email, 09:34 to 09:44');
  await shot('5-overlap');
  await page.locator('.dialog input[type=time]').last().fill('09:20');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.log'), '09:02to09:20Write the report18m');
  await page.getByRole('button', { name: 'Add entry' }).click();
  await page.locator('.dialog select').selectOption({ label: 'Review pull requests' });
  await page.locator('.dialog input[type=time]').first().fill('09:20');
  await page.locator('.dialog input[type=time]').last().fill('09:34');
  await page.locator('.dialog').getByRole('button', { name: 'Add entry' }).click();
  await expect(page.locator('.log'), '09:20to09:34Review pull requests14m');
  await expect(card('Review pull requests'), '14m of 30m');
  await page.getByRole('button', { name: /^Interruption, 09:44/ }).click();
  await page.getByRole('button', { name: 'Delete entry' }).click();
  assert.equal(await page.locator('.log-row.is-int').count(), 0);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  assert.equal(await page.locator('.log-row.is-int').count(), 1);
  await shot('6-log');

  // A repeating task: Wednesdays, ended for today from the dock
  await page.getByRole('button', { name: /^More options for the new task/ }).click();
  await page.locator('.dialog input').first().fill('Stretch');
  await page.getByRole('button', { name: 'Wed', exact: true }).click();
  await shot('7-repeat');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(card('Stretch'), 'Wed');
  await page.getByRole('button', { name: /^Stretch.*Start$/ }).click();
  await page.clock.fastForward('05:00');
  await dock.getByRole('button', { name: 'Done for today' }).click();
  await expect(page.locator('.card.is-done', { hasText: 'Stretch' }), 'Stretch');

  // It is back in a week, not done, and not there the day before
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Next day' }).click();
  assert.equal(await card('Stretch').count(), 0);
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.locator('.cards').first(), 'Stretch');
  assert.equal(await page.locator('.card.is-done').count(), 0);
  // A day to come can be planned but nothing on it can be started
  await addTask('Book the flights');
  assert.equal(await page.getByRole('button', { name: /^Book the flights.*Start$/ }).count(), 0);
  await shot('8-next-week');
  await page.getByRole('button', { name: 'Back to today' }).click();

  // A project: a total of hours, no time of day
  await page.getByRole('button', { name: /^More options for the new task/ }).click();
  await page.locator('.dialog input').first().fill('Thesis');
  await page.getByLabel('It is a project with a total of hours').check();
  await page.getByLabel('Total hours').fill('1');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(card('Thesis'), '0m of 1h');
  await page.getByRole('button', { name: /^Thesis.*Start$/ }).click();
  await page.clock.fastForward('25:00');
  if (SHOTS) {
    await page.locator('.fold', { hasText: 'Done' }).click();
    await page.screenshot({ path: 'docs/day-phone.png' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: 'docs/day-desktop.png' });
    await page.setViewportSize({ width: 390, height: 800 });
    await page.locator('.fold', { hasText: 'Done' }).click();
  }
  await page.clock.fastForward('36:00');
  await expect(card('Thesis'), 'The hours are used up.');
  await expect(dock, '1h 01m of 1h');
  await shot('9-project');
  await page.getByRole('button', { name: 'Add time' }).click();
  await page.getByLabel('Hours to add').fill('2');
  await page.getByRole('button', { name: 'Add hours' }).click();
  await expect(card('Thesis'), '1h 01m of 3h');
  await expect(dock.getByRole('button', { name: 'Done for today' }), 'Done for today');

  // Three hours later the timer is still running. The app asks, and never stops it by itself
  await page.clock.fastForward('03:00:00');
  await expect(page.locator('.notices'), 'Still on Thesis?');
  await shot('10-forgotten');
  await page.getByLabel('It ended at').fill('11:30');
  await page.getByRole('button', { name: 'Set end' }).click();
  await expect(dock, 'Nothing running');
  await expect(card('Thesis'), 'of 3h');

  // Delete, then undo
  await page.getByRole('button', { name: 'Change Reply to email' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  assert.equal(await card('Reply to email').count(), 0);
  await shot('11-undo');
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  assert.equal(await card('Reply to email').count(), 1);

  // Take a task off today: it waits under "Not on today"
  await page.getByRole('button', { name: 'Change Write the report' }).click();
  await page.getByRole('button', { name: 'Take off today' }).click();
  assert.equal(await card('Write the report').count(), 0);
  await page.clock.fastForward('00:09');
  await page.getByRole('button', { name: /^Not on today/ }).click();
  await page.getByRole('button', { name: 'Put Write the report on today' }).click();
  assert.equal(await card('Write the report').count(), 1);

  // A focus task takes the screen, and time away from the app goes in the log
  const visible = (v) =>
    page.evaluate((v) => {
      Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, v);
  await page.getByRole('button', { name: 'Change Review pull requests' }).click();
  await page.getByLabel(/^Focus/).check();
  await shot('16-focus-option');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: /^Review pull requests.*Start$/ }).click();
  const focus = page.locator('.focus');
  await expect(focus, 'Review pull requests');
  assert.equal(await dock.count(), 0);
  await page.clock.fastForward('05:00');
  await expect(focus, '5:00');
  await shot('17-focus');
  await visible('hidden');
  await page.clock.fastForward('04:00');
  await visible('visible');
  await expect(focus, 'You left for 4m');
  await expect(focus, '0:0');
  await focus.getByRole('button', { name: 'Pause' }).click();
  await expect(dock, 'Nothing running');
  await expect(page.locator('.log'), 'Left the app');

  // Next morning: what was left unfinished is already on today, and says where from
  await page.clock.fastForward('19:00:00');
  await expect(page.locator('h1'), 'Thursday');
  await expect(card('Reply to email'), 'from Wednesday');
  assert.deepEqual(await titles(), ['Reply to email', 'Review pull requests', 'Write the report']);
  assert.equal(await card('Stretch').count(), 0);
  await shot('12-carried');
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.locator('.log'), 'Thesis');
  assert.equal(await page.getByRole('button', { name: /Start$/ }).count(), 0);
  await shot('13-yesterday');
  await page.getByRole('button', { name: 'Back to today' }).click();

  if (SHOTS) {
    await page.emulateMedia({ colorScheme: 'dark' });
    await shot('14-dark');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: 'light' });
    await shot('15-desktop');
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
