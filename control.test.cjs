const { test } = require('node:test');
const assert = require('node:assert/strict');
const control = require('./control.js');
const ready = { armed: true, command: 'forward', timestamp: 1000, now: 1100, hidden: false, cameraReady: true };
test('movement requires start, a fresh frame and a visible camera', () => {
  assert.equal(control.current(ready), 'forward');
  for (const override of [{armed:false}, {hidden:true}, {cameraReady:false}, {timestamp:0}, {now:1801}, {command:'unknown'}]) {
    assert.equal(control.current({...ready, ...override}), 'stop');
  }
});
test('uncertain and unmapped predictions stop', () => {
  assert.equal(control.choose('left', .9, .8), 'left');
  assert.equal(control.choose('left', .79, .8), 'stop');
  assert.equal(control.choose('Class 1', 1, .8), 'stop');
  assert.equal(control.choose('right', NaN, .8), 'stop');
});
test('model links accept shared model URLs and reject unrelated resources', () => {
  assert.equal(control.modelBase(' https://teachablemachine.withgoogle.com/models/abc_12-/ '), 'https://teachablemachine.withgoogle.com/models/abc_12-/');
  for (const value of ['https://example.com/models/a/', 'javascript:alert(1)', 'https://teachablemachine.withgoogle.com/train/image', 'http://teachablemachine.withgoogle.com/models/a/']) assert.throws(() => control.modelBase(value));
});
