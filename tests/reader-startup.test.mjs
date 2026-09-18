import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installStartupDiagnostics, traceReaderStartup} from '../scripts/reader-startup.js';

function setup() {
    const events = {}, timers = [], nodes = {p: {}, small: {}};
    const window = {addEventListener: (name, handler) => {events[name] = handler;},
        setTimeout: handler => timers.push(handler)};
    const context = vm.createContext({window, navigator: {}, document: {
        getElementById: () => ({querySelector: selector => nodes[selector]}),
        addEventListener: (name, handler) => {events[name] = handler;}
    }});
    vm.runInContext(`(${installStartupDiagnostics.toString()})();`, context);
    return {context, window, events, timers, nodes};
}
test('a delayed HTML response does not start the reader timeout prematurely', () => {
    const h = setup();
    assert.equal(h.timers.length, 0);
    h.events.DOMContentLoaded();
    assert.equal(h.timers.length, 1);
    h.window.memoirStage('加载章节页面');
    h.timers[0]();
    assert.match(h.nodes.small.textContent, /加载章节页面/);
    assert.equal(h.window.memoirStartupFailed, undefined);
    h.window.memoirStage('计算翻页排版');
    assert.match(h.nodes.small.textContent, /计算翻页排版/);
});
test('real errors retain the failed stage; successful reading ignores later errors', () => {
    const h = setup();
    h.events.DOMContentLoaded();
    h.window.memoirStage('读取内置正文');
    h.events.error({message: 'example failure'});
    h.timers[0]();
    assert.match(h.nodes.small.textContent, /example failure.*读取内置正文/);
    const text = h.nodes.small.textContent;
    h.window.memoirOpened = true;
    h.events.error({message: 'media error'});
    assert.equal(h.nodes.small.textContent, text);
});
test('stage tracing preserves original return values, arguments and chapter progress', async () => {
    const h = setup(), events = {};
    const result = Promise.resolve('book');
    const Bibi = Object.fromEntries(['initialize','loadExtensions','ready','getBookData','loadBook','bindBook','openBook']
        .map(name => [name, function(argument) { assert.equal(this, Bibi); assert.equal(argument, 42); return result; }]));
    const L = Object.fromEntries(['initializeBook','createCover','loadNavigation','preprocessResources','loadSpread'].map(name => [name, () => result]));
    const optimize = L.createCover.optimizeString = text => text.trim();
    Object.assign(h.context, {Bibi, L, E: {bind: (name, callback) => {events[name] = callback;}}});
    vm.runInContext(`(${traceReaderStartup.toString()})();`, h.context);
    assert.equal(Bibi.initialize(42), result);
    assert.equal(L.createCover.optimizeString, optimize);
    events['bibi:loaded-item']();
    assert.equal(h.window.memoirStartupState.chapters, 1);
    assert.equal(Bibi.bindBook(42), result);
    assert.equal(h.window.memoirStartupState.phase, '计算翻页排版');
});
