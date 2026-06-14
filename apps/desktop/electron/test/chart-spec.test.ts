// F056 — chart artifact spec validation (pure, renderer util tested from the
// electron node:test suite, mirroring composeMessages.test.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseChartSpec,
  seriesColor,
  CHART_PALETTE,
} from '../../renderer/src/features/artifact/chartSpec.js';

const VALID = {
  type: 'line',
  xKey: 'name',
  data: [
    { name: 'Mon', v: 12 },
    { name: 'Tue', v: 19 },
  ],
  series: [{ key: 'v', label: 'Visits' }],
  title: 'Weekly',
};

test('parseChartSpec: accepts a valid line spec', () => {
  const r = parseChartSpec(VALID);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.spec.type, 'line');
    assert.equal(r.spec.series[0]?.key, 'v');
  }
});

test('parseChartSpec: accepts bar and area types', () => {
  assert.equal(parseChartSpec({ ...VALID, type: 'bar' }).ok, true);
  assert.equal(parseChartSpec({ ...VALID, type: 'area' }).ok, true);
});

test('parseChartSpec: rejects unknown chart type', () => {
  const r = parseChartSpec({ ...VALID, type: 'pie' });
  assert.equal(r.ok, false);
});

test('parseChartSpec: rejects empty data / empty series', () => {
  assert.equal(parseChartSpec({ ...VALID, data: [] }).ok, false);
  assert.equal(parseChartSpec({ ...VALID, series: [] }).ok, false);
});

test('parseChartSpec: rejects missing xKey', () => {
  const { xKey, ...noX } = VALID;
  void xKey;
  assert.equal(parseChartSpec(noX).ok, false);
});

test('parseChartSpec: rejects a junk color (injection guard on the SVG attr)', () => {
  const r = parseChartSpec({
    ...VALID,
    series: [{ key: 'v', color: 'url(#x);background:red' }],
  });
  assert.equal(r.ok, false);
});

test('parseChartSpec: accepts hex / named / rgb / hsl colors', () => {
  for (const color of [
    '#f59e0b',
    '#fff',
    'red',
    'rgb(1,2,3)',
    'rgba(1,2,3,0.5)',
    'hsl(0,100%,50%)',
    'hsla(0,100%,50%,0.5)',
  ]) {
    assert.equal(parseChartSpec({ ...VALID, series: [{ key: 'v', color }] }).ok, true, color);
  }
});

test('parseChartSpec: rejects Bidi-override / control chars in display strings', () => {
  const rlo = String.fromCharCode(0x202e); // RIGHT-TO-LEFT OVERRIDE
  const nul = String.fromCharCode(0x00);
  assert.equal(parseChartSpec({ ...VALID, title: `Revenue ${rlo}evil` }).ok, false);
  assert.equal(parseChartSpec({ ...VALID, xKey: `name${rlo}` }).ok, false);
  assert.equal(parseChartSpec({ ...VALID, series: [{ key: `v${nul}` }] }).ok, false);
});

test('parseChartSpec: never throws on non-object input', () => {
  for (const bad of [null, undefined, 42, 'x', []]) {
    const r = parseChartSpec(bad);
    assert.equal(r.ok, false);
  }
});

test('seriesColor: explicit color wins, else palette by index', () => {
  const spec = parseChartSpec({
    ...VALID,
    series: [{ key: 'a', color: '#123456' }, { key: 'b' }],
  });
  assert.ok(spec.ok);
  if (spec.ok) {
    assert.equal(seriesColor(spec.spec, 0), '#123456');
    assert.equal(seriesColor(spec.spec, 1), CHART_PALETTE[1]);
  }
});

test('seriesColor: palette wraps past its length', () => {
  const spec = parseChartSpec({
    ...VALID,
    series: Array.from({ length: 9 }, (_, i) => ({ key: `k${i}` })),
  });
  assert.ok(spec.ok);
  if (spec.ok) {
    assert.equal(seriesColor(spec.spec, 7), CHART_PALETTE[7]);
    assert.equal(seriesColor(spec.spec, 8), CHART_PALETTE[0]); // 8 % 8 === 0
  }
});
