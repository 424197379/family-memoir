// Keep Bibi's paged reader, but deliver its critical startup in one response.
import {readFile, writeFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {transform} from 'esbuild';
import {installStartupDiagnostics, traceReaderStartup} from './reader-startup.js';

const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const script = code => code.replace(/<\/script/gi, '<\\/script');
export async function packReader(output, cacheScript = 'memoir-cache.js') {
    const read = relative => readFile(path.join(output, relative), 'utf8');
    const book = 'bibi-bookshelf/memoir/';
    const documents = {};
    async function collect(dir) {
        for (const entry of await readdir(path.join(output, book, dir), {withFileTypes:true})) {
            const relative = path.posix.join(dir,entry.name);
            if (entry.isDirectory() && entry.name !== 'media' && entry.name !== 'fonts') await collect(relative);
            else if (/\.(xml|opf|xhtml|ncx)$/.test(relative)) documents[relative] = await read(book+relative);
        }
    }
    await collect('');
    let css = await read(book+'OEBPS/book.css');
    const font = await readFile(path.join(output,book,'OEBPS/fonts/memoir-serif.woff2'));
    css = css.replace('fonts/memoir-serif.woff2', 'data:font/woff2;base64,'+font.toString('base64')).replace('font-display: block','font-display: swap');
    const extensions = {};
    for (const name of ['sanitizer.js','memoir-loading.js']) {
        let code = await read('bibi/extensions/'+name);
        if (name === 'memoir-loading.js') code = code.replace('function localStyle(url) {', 'function localStyle(url) { if (window.MemoirBookCSS) return Promise.resolve(window.MemoirBookCSS);');
        extensions[name] = (await transform(code, {target:['es2017'],minify:true})).code;
    }
    let core = await read('bibi/resources/scripts/bibi.js');
    let references = 0;
    core = core.replace(/\b(\w+\.Script)\.src/g, (_,element) => {
        references++;
        return `(new URL(${element}.getAttribute("data-memoir-src") || ${element}.src,location.href).href)`;
    });
    assert.equal(references,7,'Upstream Bibi changed: review its script base URLs');
    const preset = await read('bibi/presets/default.js');
    const adapter = `
    window.MemoirBookCSS = ${json(css)};
    (function () {
      var documents = ${json(documents)}, extensions = ${json(extensions)};
      var download = O.download;
      O.download = function(source) {
        if (!B.ExtractionPolicy && Object.prototype.hasOwnProperty.call(documents,source.Path)) {
          source = O.src(source); source.Content = documents[source.Path]; source.DataType = 'Text'; source.Retlieved = true;
        }
        return download(source);
      };
      var load = X.load;
      X.load = function(extension) {
        var url = new URL(extension.src), name = url.pathname.split('/').pop();
        if (url.origin !== location.origin || !extensions[name]) return load(extension);
        window.memoirStage('正在启动翻页阅读器…');
        return new Promise(function(resolve,reject) {
          var element = document.createElement('script'), registered = false;
          element.className = 'bibi-extension-script'; element.Extension = extension;
          element.resolve = function(value) { registered = true; resolve(value); };
          element.reject = reject; element.textContent = extensions[name]; extension.Script = element;
          document.head.appendChild(element);
          if (!registered) { window.memoirFail('阅读器组件未能启动：'+name); reject(new Error('Extension did not register: '+name)); }
        });
      };
    }()); (${traceReaderStartup.toString()})();`;
    const diagnostics = `(${installStartupDiagnostics.toString()})();`;
    let html = await read('bibi/index.html');
    html = html.replace(/<script>\s*window\.setTimeout[\s\S]*?<\/script>/,'');
    for (const [id,relative] of [['bibi-style','resources/styles/bibi.css'],['bibi-dress','wardrobe/everyday/bibi.dress.css']]) {
        const style = (await read('bibi/'+relative)).replaceAll('url(./fonts/','url(resources/styles/fonts/');
        html = html.replace(new RegExp('<link id="'+id+'"[^>]+>'),()=>'<style id="'+id+'">'+style+'</style>');
    }
    // Polyfills are also local to the response; missing browser features must not
    // trigger another remote request before Bibi can render a single page.
    const polyfills = (await Promise.all(['bundle.js','encoding.js','intersection-observer.js'].map(name=>read('bibi/resources/scripts/polyfills/'+name)))).join('\n');
    html = html.replace(/<script src="memoir-cache[^>]*><\/script>/,'');
    // Core contains HTML/script snippets for chapter frames. Insert its text via
    // the DOM, so HTML's script double-escape rules cannot truncate the document.
    const insertCore = `var core=document.createElement('script');core.id='bibi-script';core.setAttribute('data-memoir-src','resources/scripts/bibi.js');core.textContent=${json(core)};document.head.appendChild(core);`;
    html = html.replace(/<script id="bibi-script"[^>]*><\/script>/,()=>'<script>'+script(diagnostics+polyfills)+'</script><script>'+insertCore+'</script><script>'+script(adapter)+'</script>');
    html = html.replace(/<script id="bibi-preset"[^>]*><\/script>/,()=>'<script id="bibi-preset" data-memoir-src="presets/default.js" data-bibi-bookshelf="">'+script(preset)+'</script>');
    // Optional cache code cannot block layout or first-page rendering.
    html = html.replace('</body>', '<script src="'+cacheScript+'" async></script></body>');
    html = html.replace('正在连接，准备正文…','正在打开翻页回忆录…').replace('inset:0;', 'top:0;right:0;bottom:0;left:0;');
    assert(!/<script[^>]+\ssrc="(?:resources|presets)/.test(html));
    await writeFile(path.join(output,'bibi/index.html'),html);
    return {htmlBytes:Buffer.byteLength(html),embeddedDocuments:Object.keys(documents).length};
}
