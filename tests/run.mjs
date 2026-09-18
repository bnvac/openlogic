/* OpenLogic test suite.
 *
 * Drives the real page in a real browser -- there is no unit-test layer
 * because there is no build step to hang one off. See tests/README.md.
 *
 *   python3 -m http.server 8777 &
 *   node tests/run.mjs
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';

const BASE = process.env.OPENLOGIC_URL || 'http://localhost:8777/index.html';
const FILE_URL = 'file://' + path.resolve(process.cwd(), 'index.html');
const EXECUTABLE = process.env.CHROME_PATH || undefined;

const results = [];
const errors = [];
const check = (name, pass, detail = '') =>
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  \u2014 ' + detail : ''}`);

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

// Helper: canvas-relative screen point for a node pin
async function pinPoint(nodeId, kind, idx) {
  return page.evaluate(([nodeId, kind, idx]) => {
    const app = OL.app, C = OL.Components;
    const n = app.circuit.node(nodeId);
    const p = C.portsOf(n)[kind][idx];
    const w = C.toWorld(n, p.x, p.y);
    const s = app.renderer.toScreen(w.x, w.y);
    const r = app.canvas.getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y };
  }, [nodeId, kind, idx]);
}
async function worldPoint(wx, wy) {
  return page.evaluate(([wx, wy]) => {
    const s = OL.app.renderer.toScreen(wx, wy);
    const r = OL.app.canvas.getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y };
  }, [wx, wy]);
}

// ---- 1. click a toggle switch through the real UI -------------------------
const t0 = await page.evaluate(() => OL.app.circuit.nodes.find(n => n.type === 'toggle').id);
const box = await page.evaluate((id) => {
  const n = OL.app.circuit.node(id);
  const b = OL.Components.worldBounds(n);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}, t0);
let pt = await worldPoint(box.x, box.y);
await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(150);
check('click toggles a switch',
  await page.evaluate((id) => OL.app.circuit.node(id).state.on === true, t0));

// ---- 2. place a component from the palette -------------------------------
const before = await page.evaluate(() => OL.app.circuit.nodes.length);
await page.click('.part[data-type="nand"]');
pt = await worldPoint(560, 380);
await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(120);
const placed = await page.evaluate(() => {
  const n = OL.app.circuit.nodes[OL.app.circuit.nodes.length - 1];
  return { count: OL.app.circuit.nodes.length, type: n.type, id: n.id, x: n.x, y: n.y };
});
check('palette click-then-place adds a component',
  placed.count === before + 1 && placed.type === 'nand', JSON.stringify(placed));
check('placed component snaps to the grid', placed.x % 10 === 0 && placed.y % 10 === 0);

// ---- 3. drag a wire between two pins --------------------------------------
const wiresBefore = await page.evaluate(() => OL.app.circuit.wires.length);
const from = await pinPoint(t0, 'outputs', 0);
const to = await pinPoint(placed.id, 'inputs', 0);
await page.mouse.move(from.x, from.y);
await page.mouse.down();
await page.mouse.move((from.x + to.x) / 2, from.y - 40, { steps: 8 });
await page.mouse.move(to.x, to.y, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(150);
check('dragging pin-to-pin creates a wire',
  await page.evaluate((n) => OL.app.circuit.wires.length === n + 1, wiresBefore));
check('an output may fan out to several inputs',
  await page.evaluate((id) => OL.app.circuit.wires.filter(w => w.from.node === id).length >= 3, t0));

// ---- 4. undo / redo -------------------------------------------------------
await page.keyboard.press('Control+z');
await page.waitForTimeout(120);
check('undo removes the wire',
  await page.evaluate((n) => OL.app.circuit.wires.length === n, wiresBefore));
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(120);
check('redo restores the wire',
  await page.evaluate((n) => OL.app.circuit.wires.length === n + 1, wiresBefore));

// ---- 5. save/load roundtrip ----------------------------------------------
const roundtrip = await page.evaluate(() => {
  const json = OL.app.circuit.toJSON();
  const back = OL.Circuit.fromJSON(JSON.parse(JSON.stringify(json)));
  return {
    same: JSON.stringify(back.toJSON()) === JSON.stringify(json),
    nodes: back.nodes.length,
    switchKept: back.nodes.filter(n => n.type === 'toggle').some(n => n.state.on === true)
  };
});
check('serialize -> parse -> serialize is stable', roundtrip.same, JSON.stringify(roundtrip));
check('switch positions survive a save/load', roundtrip.switchKept);

// ---- 6. rotation ----------------------------------------------------------
const rotOK = await page.evaluate((id) => {
  const app = OL.app, C = OL.Components;
  const n = app.circuit.node(id);
  const before = C.worldPort(n, 'outputs', 0);
  n.rot = 90;
  const after = C.worldPort(n, 'outputs', 0);
  n.rot = 0;
  return Math.abs(before.x - after.x) > 1 || Math.abs(before.y - after.y) > 1;
}, placed.id);
check('rotation moves pins in world space', rotOK);

// ---- 7. flip-flop divides the clock by two -------------------------------
const ffDiv = await page.evaluate(() => {
  const c = new OL.Circuit();
  const clk = c.addNode('clock', 0, 0);
  clk.props.frequency = 10;
  const t = c.addNode('tff', 100, 0);
  const one = c.addNode('high', 0, 100);
  c.addWire(one.id, 0, t.id, 0);   // T = 1
  c.addWire(clk.id, 0, t.id, 1);
  const sim = new OL.Simulator(c);
  sim.reset();
  const seen = [];
  // 20 clock half-periods = 10 rising edges = Q should toggle 10 times
  for (let i = 0; i < 20; i++) { sim.advance(0.051); sim.settle(); seen.push(t.out[0]); }
  // Divide-by-2 means every sampled value repeats exactly twice: 11001100...
  const str = seen.join('');
  const squareWave = /^(1100)+$|^(0011)+$/.test(str);
  return { squareWave, seen: str };
});
check('T flip-flop divides the clock by 2', ffDiv.squareWave,
  `Q over 20 clock half-periods: ${ffDiv.seen}`);

// ---- 8. tri-state: Z, driven, and bus conflict ----------------------------
const tri = await page.evaluate(() => {
  const S = OL.Signal;
  const c = new OL.Circuit();
  const a = c.addNode('toggle', 0, 0), ea = c.addNode('toggle', 0, 40);
  const b = c.addNode('toggle', 0, 80), eb = c.addNode('toggle', 0, 120);
  const ta = c.addNode('tristate', 100, 0), tb = c.addNode('tristate', 100, 80);
  const bulb = c.addNode('bulb', 200, 40);
  c.addWire(a.id, 0, ta.id, 0); c.addWire(ea.id, 0, ta.id, 1);
  c.addWire(b.id, 0, tb.id, 0); c.addWire(eb.id, 0, tb.id, 1);
  c.addWire(ta.id, 0, bulb.id, 0); c.addWire(tb.id, 0, bulb.id, 0);
  const sim = new OL.Simulator(c);
  const run = () => { sim.reset(); sim.settle(); return bulb.in[0]; };
  const out = {};
  out.bothOff = run();                                   // nobody driving -> Z
  ea.state.on = true; a.state.on = true;  out.aDrivesHigh = run();
  ea.state.on = false; out.aDisabled = run();            // back to Z
  ea.state.on = true; eb.state.on = true; b.state.on = false;
  out.conflict = run();                                  // 1 vs 0 -> ERR
  return { out, S: { LOW: S.LOW, HIGH: S.HIGH, Z: S.Z, ERR: S.ERR } };
});
check('undriven net reads as Z', tri.out.bothOff === tri.S.Z);
check('enabled tri-state drives the net', tri.out.aDrivesHigh === tri.S.HIGH);
check('disabled tri-state releases the net', tri.out.aDisabled === tri.S.Z);
check('two drivers disagreeing is flagged as a conflict', tri.out.conflict === tri.S.ERR);

// ---- 9. oscillation is detected, not hung --------------------------------
const osc = await page.evaluate(() => {
  const c = new OL.Circuit();
  const n = c.addNode('not', 0, 0);
  c.addWire(n.id, 0, n.id, 0);          // self-loop is rejected...
  const m = c.addNode('not', 100, 0);
  c.addWire(n.id, 0, m.id, 0);
  c.addWire(m.id, 0, n.id, 0);          // ...so use a two-inverter ring
  const sim = new OL.Simulator(c);
  const t0 = performance.now();
  sim.reset();
  sim.settle();
  return { oscillating: sim.oscillating, ms: performance.now() - t0 };
});
check('unsettleable feedback is reported, not hung',
  osc.oscillating === true && osc.ms < 200, `${osc.ms.toFixed(1)}ms`);

// ---- 10. shrinking a gate drops orphaned wires ---------------------------
const prune = await page.evaluate(() => {
  const c = new OL.Circuit();
  const g = c.addNode('and', 100, 0);
  g.props.inputs = 4;
  c.touch();
  const srcs = [0, 1, 2, 3].map(i => c.addNode('high', 0, i * 30));
  srcs.forEach((s, i) => c.addWire(s.id, 0, g.id, i));
  const before = c.wires.length;
  g.props.inputs = 2;
  c.touch();
  c.prune();
  return { before, after: c.wires.length };
});
check('shrinking a gate prunes wires to removed pins',
  prune.before === 4 && prune.after === 2, JSON.stringify(prune));

// ---- 11. delete + select-all ---------------------------------------------
await page.keyboard.press('Control+a');
await page.waitForTimeout(80);
const selCount = await page.evaluate(() => OL.app.selection.size);
await page.keyboard.press('Delete');
await page.waitForTimeout(120);
const emptied = await page.evaluate(() => ({
  nodes: OL.app.circuit.nodes.length, wires: OL.app.circuit.wires.length
}));
check('select-all then delete clears the canvas',
  selCount > 0 && emptied.nodes === 0 && emptied.wires === 0, JSON.stringify(emptied));
await page.keyboard.press('Control+z');
await page.waitForTimeout(120);
check('undo brings the whole circuit back',
  await page.evaluate((n) => OL.app.circuit.nodes.length === n, placed.count));

// --- inspector on a selected gate ----------------------------------------
const gid = await page.evaluate(() => {
  const n = OL.app.circuit.nodes.find(x => x.type === 'and');
  OL.app.selection.clear(); OL.app.selection.add(n);
  OL.app.refreshInspector(); OL.app.requestRender();
  return n.id;
});
await page.waitForTimeout(250);
check('inspector opens for a selection', await page.isVisible('#inspector'));
await page.screenshot({ path: 'shot-04-inspector.png' });

// change the AND gate to 3 inputs via the inspector
await page.fill('#inspector-body input[type=number]', '3');
await page.press('#inspector-body input[type=number]', 'Enter');
await page.waitForTimeout(250);
const pins = await page.evaluate((id) =>
  OL.Components.portsOf(OL.app.circuit.node(id)).inputs.length, gid);
check('inspector edits gate input count', pins === 3, `${pins} inputs`);
await page.screenshot({ path: 'shot-05-3input.png' });

// --- real download --------------------------------------------------------
page.on('dialog', async d => { await d.accept('my-circuit.json'); });
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.click('#btn-save')
]);
const downloaded = await download.path();
const saved = JSON.parse(fs.readFileSync(downloaded, 'utf8'));
check('Save downloads a real .json file',
  download.suggestedFilename() === 'my-circuit.json' &&
  saved.format === 'openlogic-circuit' && saved.nodes.length > 0,
  `${download.suggestedFilename()}, ${saved.nodes.length} nodes`);

// --- upload it back into a cleared canvas ---------------------------------
fs.writeFileSync(path.join(os.tmpdir(), 'openlogic-roundtrip.json'), JSON.stringify(saved));
await page.evaluate(() => OL.app.load(new OL.Circuit(), { quiet: true }));
await page.waitForTimeout(150);
await page.setInputFiles('#file-input', path.join(os.tmpdir(), 'openlogic-roundtrip.json'));
await page.waitForTimeout(400);
const loaded = await page.evaluate(() => ({
  nodes: OL.app.circuit.nodes.length, wires: OL.app.circuit.wires.length
}));
check('uploading the file restores the circuit',
  loaded.nodes === saved.nodes.length && loaded.wires === saved.wires.length,
  JSON.stringify(loaded));

// --- corrupt file is rejected gracefully ----------------------------------
fs.writeFileSync(path.join(os.tmpdir(), 'openlogic-bad.json'), '{ this is not json');
await page.setInputFiles('#file-input', path.join(os.tmpdir(), 'openlogic-bad.json'));
await page.waitForTimeout(400);
const toastText = await page.textContent('#toast');
check('a corrupt file shows an error instead of breaking',
  /json/i.test(toastText) && await page.evaluate(() => OL.app.circuit.nodes.length > 0),
  toastText);

// --- oscillation banner ---------------------------------------------------
await page.evaluate(() => {
  const c = new OL.Circuit();
  const a = c.addNode('not', 120, 120), b = c.addNode('not', 280, 120);
  c.addWire(a.id, 0, b.id, 0); c.addWire(b.id, 0, a.id, 0);
  OL.app.load(c, { quiet: true });
});
await page.waitForTimeout(600);
check('oscillation warning appears', await page.isVisible('#osc-warning'));
await page.screenshot({ path: 'shot-06-oscillating.png' });

// --- narrow viewport ------------------------------------------------------
await page.evaluate(() => OL.app.loadSample());
await page.setViewportSize({ width: 560, height: 760 });
await page.waitForTimeout(500);
await page.screenshot({ path: 'shot-07-narrow.png' });
check('narrow layout has no horizontal page scroll',
  await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

// --- boots from file:// with no server -----------------------------------
{
  const p2 = await ctx.newPage();
  const fileErrors = [];
  p2.on('pageerror', e => fileErrors.push(e.message));
  await p2.goto(FILE_URL, { waitUntil: 'load' });
  await p2.waitForTimeout(800);
  const booted = await p2.evaluate(() => typeof OL !== 'undefined' && !!OL.app && OL.app.circuit.nodes.length > 0);
  check('boots from a file:// URL with no server', booted && fileErrors.length === 0,
    fileErrors.join('; '));
  await p2.close();
}

console.log(results.join('\n'));
console.log('\n' + (errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors.'));
const failed = results.filter(r => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
