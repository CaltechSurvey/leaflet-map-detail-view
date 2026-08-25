'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/* The plugin only touches Leaflet at load time, so a tiny stub is enough
   to evaluate the module and reach the exported geometry helpers. */
function loadPlugin() {
	const src = fs.readFileSync(
		path.join(__dirname, '..', 'src', 'leaflet-detail-view.js'),
		'utf8'
	);

	const extend = (proto) => {
		const Klass = function () {};
		Klass.prototype = proto;
		return Klass;
	};

	const L = { Evented: { extend }, Control: { extend }, control: {} };
	vm.runInNewContext(src, { window: { L }, document: {} });

	return L;
}

const Util = loadPlugin().DetailView.Util;

/* Values come from a vm realm, so compare structural copies. */
const plain = (value) => JSON.parse(JSON.stringify(value));

test('clipToRect returns the border point towards the target', () => {
	const rect = { x: 0, y: 0, width: 100, height: 100 };

	assert.deepStrictEqual(plain(Util.clipToRect(rect, { x: 200, y: 50 })), { x: 100, y: 50 });
	assert.deepStrictEqual(plain(Util.clipToRect(rect, { x: 50, y: -50 })), { x: 50, y: 0 });
});

test('clipToRect returns null when the target is inside', () => {
	const rect = { x: 0, y: 0, width: 100, height: 100 };

	assert.strictEqual(Util.clipToRect(rect, { x: 60, y: 60 }), null);
});

test('frustumPairs joins the facing corners', () => {
	const box = { x: 0, y: 0, width: 100, height: 100 };
	const right = { x: 300, y: 0, width: 100, height: 100 };
	const above = { x: 0, y: -300, width: 100, height: 100 };

	assert.deepStrictEqual(plain(Util.frustumPairs(box, right)), [
		[{ x: 100, y: 0 }, { x: 300, y: 0 }],
		[{ x: 100, y: 100 }, { x: 300, y: 100 }]
	]);

	assert.deepStrictEqual(plain(Util.frustumPairs(box, above)), [
		[{ x: 0, y: 0 }, { x: 0, y: -200 }],
		[{ x: 100, y: 0 }, { x: 100, y: -200 }]
	]);
});

test('resizeRect grows east/south without moving the origin', () => {
	const start = { width: 200, height: 100, left: 10, top: 20 };

	assert.deepStrictEqual(plain(Util.resizeRect('se', start, 50, 30, 100, 50)), {
		width: 250, height: 130, left: 10, top: 20
	});
});

test('resizeRect shifts the origin when dragging west/north', () => {
	const start = { width: 200, height: 100, left: 100, top: 100 };

	assert.deepStrictEqual(plain(Util.resizeRect('nw', start, -40, -20, 100, 50)), {
		width: 240, height: 120, left: 60, top: 80
	});
});

test('resizeRect clamps to the minimum size', () => {
	const start = { width: 200, height: 100, left: 100, top: 100 };
	const result = Util.resizeRect('nw', start, 500, 500, 120, 60);

	assert.strictEqual(result.width, 120);
	assert.strictEqual(result.height, 60);
	assert.strictEqual(result.left, 180);
	assert.strictEqual(result.top, 140);
});
