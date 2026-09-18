import assert from 'node:assert/strict';

// 只改构建产物中的章节装载，不修改第三方原件；升级 Bibi 时必须重新核对命中点。
export function patchBibiChapters(core) {
    function replaceOnce(before, after) {
        assert.equal(core.split(before).length - 1, 1, 'Bibi chapter patch changed: ' + before);
        core = core.replace(before, () => after);
    }
    // 微信使用 Bibi 为嵌入式浏览器保留的同源空白页写入路径，避免 blob 页面导航。
    replaceOnce('U.Local||sML.UA.LINE||sML.UA.Trident||sML.UA.EdgeHTML',
        'U.Local||/MicroMessenger/i.test(navigator.userAgent)||sML.UA.LINE||sML.UA.Trident||sML.UA.EdgeHTML');
    replaceOnce('Bibi.BookStyleURL=O.createBlobURL("Text",e,"text/css")',
        'Bibi.BookStyleText=e,Bibi.BookStyleURL=O.createBlobURL("Text",e,"text/css")');
    // 内置样式直接写入章节，避免再经 blob 样式 URL 以及无限 CSS 加载等待。
    replaceOnce(`'$1\\n<link rel="stylesheet" id="'.concat("bibi-default-style",'" href="').concat(x.BookStyleURL,'" />')`,
        `'$1\\n<style id="bibi-default-style">'.concat(x.BookStyleText,'</style>')`);
    // 如果 WebView 连内联样式都未登记，停止轮询并显示确切原因，不带缺失样式继续排版。
    replaceOnce('n()||(e.CSSLoadingTimerID=setInterval(n,33))',
        'n()||(e.CSSLoadingTimerID=setInterval(n,33),setTimeout(function(){if(e.CSSLoadingTimerID){clearInterval(e.CSSLoadingTimerID);delete e.CSSLoadingTimerID;window.memoirFail("第"+(e.Index+1)+"章的内联样式未就绪");}},10000))');
    return core;
}
