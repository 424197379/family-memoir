// 内联到 HTML 最前面：不依赖额外请求，也不向外发送诊断信息。
export function installStartupDiagnostics() {
    var state = {version: 'startup-4', phase: '接收页面', chapters: 0, slow: false};
    window.memoirStartupState = state;
    function render() {
        var panel = document.getElementById('memoir-loading');
        if (!panel || window.memoirOpened) return;
        if (window.memoirStartupError) panel.querySelector('p').textContent = '暂时未能打开回忆录';
        else if (state.slow) panel.querySelector('p').textContent = '打开较慢，仍在尝试…';
        else panel.querySelector('p').textContent = state.phase;
        panel.querySelector('small').textContent = (window.memoirStartupError || '') +
            ' 步骤：' + state.phase + '；已准备 ' + state.chapters + ' 章；版本：' + state.version;
    }
    window.memoirStage = function(phase) { state.phase = phase; render(); };
    window.memoirFail = function(message) {
        if (window.memoirOpened) return;
        window.memoirStartupFailed = true;
        window.memoirStartupError = message;
        render();
    };
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', function(event) {
        if (event.data && event.data.type === 'MEMOIR_READER_PROBE' && event.ports[0])
            event.ports[0].postMessage({type: 'MEMOIR_READER_READY'});
    });
    document.addEventListener('DOMContentLoaded', function() {
        window.memoirStage('页面已接收，准备启动');
        // 收到整页后才计算启动时间；慢连接不会被误报为阅读器崩溃。
        // 超时仅提示，继续接收后续进度，允许慢设备恢复。
        window.setTimeout(function() { state.slow = true; render(); }, 30000);
    });
    window.addEventListener('error', function(event) { if (event.message) window.memoirFail(event.message); });
    window.addEventListener('unhandledrejection', function(event) { window.memoirFail(String(event.reason)); });
}

export function traceReaderStartup() {
    function trace(owner, name, phase) {
        var original = owner[name];
        owner[name] = function() { window.memoirStage(phase); return original.apply(this, arguments); };
        // Bibi 在函数对象上挂了 optimizeString 等辅助方法，包装时必须保留。
        Object.keys(original).forEach(function(key) { owner[name][key] = original[key]; });
    }
    [['initialize','初始化阅读器'],['loadExtensions','启动阅读组件'],['ready','等待阅读器就绪'],
     ['getBookData','读取书籍信息'],['loadBook','准备章节'],['bindBook','计算翻页排版'],['openBook','显示书页']]
        .forEach(function(step) { trace(Bibi, step[0], step[1]); });
    [['initializeBook','读取内置正文'],['createCover','准备封面'],['loadNavigation','准备目录'],
     ['preprocessResources','准备章节样式'],['loadSpread','加载章节页面'],
     ['postprocessItem','章节页面已载入'],['patchItemStyles','应用章节样式']]
        .forEach(function(step) { trace(L, step[0], step[1]); });
    var initialize = Bibi.initialize;
    Bibi.initialize = function() {
        var result = initialize.apply(this, arguments);
        E.bind('bibi:x_x', function(error) { window.memoirFail('阅读器启动失败：' + String(error)); });
        E.bind('bibi:loaded-item', function() { window.memoirStartupState.chapters++; });
        return result;
    };
}
