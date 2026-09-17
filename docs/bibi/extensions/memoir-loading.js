/* Memoir reader: keep original media, load visible photos after the book opens. */
Bibi.x({id: 'MemoirLoading', description: 'Visible photo loading and truthful progress', version: '1.0.0'})(function () {
    'use strict';
    const photos = [];
    let opened = false, active = 0, chapters = 0;
    const notice = document.getElementById('memoir-loading');
    const heading = notice.querySelector('p');
    const progress = notice.querySelector('progress');
    const size = bytes => (bytes / 1048576).toFixed(1) + ' MB';
    const styles = new Map();
    async function boundedFetch(url, timeout) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(url, {signal: controller.signal});
            if (!response.ok) throw new Error('RESOURCE_UNAVAILABLE');
            return await response.blob();
        } finally { clearTimeout(timer); }
    }
    function localStyle(url) {
        if (!styles.has(url)) styles.set(url, (async () => {
            let css;
            try { css = await (await boundedFetch(url, 4000)).text(); }
            catch (_) { return 'body{font-family:serif;line-height:1.8} img,video{max-width:100%;max-height:44vh} .memoir-media{height:44vh;position:relative} .memoir-media-status[hidden]{display:none}'; }
            const fontURL = new URL('fonts/memoir-serif.woff2', url);
            try {
                const blob = URL.createObjectURL(await boundedFetch(fontURL, 1500));
                css = css.replace('fonts/memoir-serif.woff2', blob);
            } catch (_) { css = css.replace(/@font-face\s*\{[^}]+\}/, ''); }
            css = css.replace('font-display: block', 'font-display: swap');
            return css;
        })());
        return styles.get(url);
    }
    // Revalidate the small book documents after this loader update; media URLs stay stable.
    const download = O.download;
    O.download = function (source) {
        if (B.ExtractionPolicy || source.URI || !/\.(xhtml|opf|xml)$/.test(source.Path)) return download(source);
        const path = (/^([a-z]+:\/\/|\/)/.test(source.Path) ? '' : B.Path + '/') + source.Path;
        const url = new URL(path, location.href); url.searchParams.set('reader', 'wechat2');
        source.URI = url.href;
        return download(source).then(async result => {
            // Blob chapter frames may not be controlled by the worker. Fetch their
            // stylesheet/font from the parent and give all frames the same local URLs.
            if (/\.xhtml$/.test(source.Path)) {
                const match = result.Content.match(/<link\s+rel="stylesheet"\s+href="(book\.css[^\"]*)"\s*\/>/);
                if (match) result.Content = result.Content.replace(match[0], '<style>' + await localStyle(new URL(match[1], url).href) + '</style>');
            }
            return result;
        }).catch(error => {
            heading.textContent = '正文连接失败，请点“重新打开”重试。';
            throw error;
        }).finally(() => { delete source.URI; });
    };

    function visible(photo) {
        const frame = photo.item.getBoundingClientRect();
        const rect = photo.box.getBoundingClientRect();
        const left = frame.left + rect.left, top = frame.top + rect.top;
        return rect.width > 0 && rect.height > 0 && left < innerWidth && left + rect.width > 0 && top < innerHeight && top + rect.height > 0;
    }

    function pump() {
        if (!opened) return;
        photos.forEach(photo => {
            if (active < 2 && photo.state === 'idle' && visible(photo)) load(photo);
        });
    }

    function protect(button) {
        ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend'].forEach(name => button.addEventListener(name, event => event.stopPropagation()));
    }
    function explain(state) {
        if (state.source === 'local') return '正在读取本机已保存的文件…';
        const prefix = state.source === 'resume' ? '继续下载（已保存 ' + size(state.saved) + '）：' : '正在下载：';
        return prefix + Math.floor(state.loaded / state.total * 100) + '%（' + size(state.loaded) + ' / ' + size(state.total) + '）';
    }
    async function load(photo) {
        if (photo.state === 'loading' || photo.state === 'done') return;
        photo.state = 'loading'; active++;
        photo.button.hidden = true; photo.bar.hidden = false; photo.bar.removeAttribute('value');
        photo.label.textContent = '正在检查本机缓存…';
        try {
            let result;
            if (window.MemoirCache?.supported) {
                result = await MemoirCache.download(photo.url, state => {
                    photo.label.textContent = explain(state); photo.bar.max = state.total; photo.bar.value = state.loaded;
                });
            } else {
                photo.label.textContent = '此浏览器暂不支持保存，正在在线加载…';
                const response = await fetch(photo.url);
                if (!response.ok) throw new Error('HTTP_' + response.status);
                result = {blob: await response.blob(), saved: false};
            }
            const blobURL = URL.createObjectURL(result.blob);
            await new Promise((resolve, reject) => {
                photo.img.onload = resolve; photo.img.onerror = () => reject(new Error('DECODE_FAILED'));
                photo.img.src = blobURL;
            }).finally(() => URL.revokeObjectURL(blobURL));
            photo.state = 'done'; photo.status.hidden = true; photo.img.dataset.ready = 'yes';
            photo.note.textContent = result.saved ? '已保存在本机' : '本次未能保存，下次可能需要重新加载';
        } catch (error) {
            photo.state = 'failed'; photo.bar.hidden = true;
            photo.label.textContent = error.message === 'CONTENT_CHANGED' ? '文件已更新，请重新打开回忆录。' : '下载中断，已保存的部分会保留。';
            photo.button.textContent = '继续加载照片'; photo.button.hidden = false;
        } finally { active--; pump(); }
    }
    function prepareVideo(item, video) {
        const doc = item.contentDocument;
        const url = new URL(video.dataset.memoirSrc, doc.baseURI).href;
        const panel = doc.createElement('div'); panel.className = 'memoir-video-cache';
        const label = doc.createElement('span'); label.textContent = '首次可在线播放，也可先保存到本机。';
        const button = doc.createElement('button'); button.textContent = '保存视频到本机'; button.type = 'button';
        const bar = doc.createElement('progress'); bar.hidden = true;
        panel.append(label, bar, button); video.parentNode.insertBefore(panel, video.nextSibling);
        protect(button);
        let controller, blobURL, saving = false;
        const online = window.MemoirCache ? MemoirCache.versioned(url) : url;
        video.src = online;
        video.addEventListener('error', () => {
            label.textContent = '此浏览器未能播放。可保存后重试，或点“打开原视频”。';
        });
        const original = doc.createElement('a'); original.href = online; original.target = '_blank'; original.rel = 'noopener'; original.textContent = '打开原视频';
        panel.append(original); protect(original);
        function useBlob(blob) {
            if (blobURL) URL.revokeObjectURL(blobURL);
            blobURL = URL.createObjectURL(blob); video.src = blobURL; video.load();
            window.addEventListener('pagehide', () => URL.revokeObjectURL(blobURL), {once: true});
        }
        async function save(manual) {
            if (saving || !window.MemoirCache?.supported) return;
            saving = true; controller = new AbortController(); button.textContent = '暂停保存'; bar.hidden = false;
            try {
                const result = await MemoirCache.download(url, state => {
                    label.textContent = explain(state); bar.max = state.total; bar.value = state.loaded;
                }, controller.signal);
                label.textContent = result.saved ? '已保存在本机，下次打开可直接播放' : '本机未能保存；本次仍可播放';
                button.hidden = true;
                // Do not interrupt a native video that is already playing.
                if (manual && video.paused) useBlob(result.blob);
            } catch (error) {
                label.textContent = error.name === 'AbortError' ? '已暂停，稍后可继续保存' : '下载中断，点击继续保存';
                button.textContent = '继续保存视频';
            } finally { saving = false; bar.hidden = true; }
        }
        button.onclick = event => { event.stopPropagation(); if (saving) { controller.abort(); return; } save(true); };
        // If SW controls the page, playback and the background save share verified chunks.
        // Without SW, WeChat uses explicit save to avoid downloading twice while streaming.
        video.addEventListener('play', () => { if (navigator.serviceWorker?.controller && !button.hidden) save(false); });
        if (window.MemoirCache?.supported) {
            MemoirCache.status(url).then(async state => {
                if (state.complete) {
                    const result = await MemoirCache.download(url, () => {});
                    if (video.paused) useBlob(result.blob);
                    label.textContent = '已保存在本机，可直接播放'; button.hidden = true;
                } else if (state.saved) {
                    label.textContent = '已保存 ' + size(state.saved) + '，可接着下载'; button.textContent = '继续保存视频';
                }
            }).catch(() => { label.textContent = '本机暂不能保存，可在线播放'; });
        } else { button.hidden = true; label.textContent = '此浏览器暂不能保存，可在线播放'; }
    }

    E.bind('bibi:postprocessed-item', item => {
        item.Body.querySelectorAll('img[data-memoir-src]').forEach(img => {
            const doc = item.contentDocument;
            const box = doc.createElement('div'); box.className = 'memoir-media';
            img.parentNode.insertBefore(box, img); box.appendChild(img);
            const status = doc.createElement('div'); status.className = 'memoir-media-status';
            const label = doc.createElement('span'); label.textContent = '翻到这里时加载原图';
            const bar = doc.createElement('progress'); bar.hidden = true; bar.setAttribute('aria-label', '照片下载进度');
            const button = doc.createElement('button'); button.type = 'button'; button.textContent = '加载照片';
            status.append(label, bar, button); box.appendChild(status);
            const note = doc.createElement('div'); note.className = 'memoir-cache-note'; box.parentNode.insertBefore(note, box.nextSibling);
            const photo = {item, img, box, status, label, bar, button, note, bytes: Number(img.dataset.memoirBytes), url: new URL(img.dataset.memoirSrc, doc.baseURI).href, state: 'idle'};
            // Bibi turns pages on pointer-up, before a normal button click arrives.
            ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend'].forEach(name => {
                button.addEventListener(name, event => event.stopPropagation());
            });
            button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); load(photo); });
            photos.push(photo);
        });
        item.Body.querySelectorAll('video[data-memoir-src]').forEach(video => prepareVideo(item, video));
    });
    E.bind('bibi:loaded-item', () => {
        chapters++;
        progress.max = R.Items.length; progress.value = chapters;
        heading.textContent = '正在准备正文：' + chapters + ' / ' + R.Items.length + ' 章';
    });
    E.bind('bibi:opened', () => {
        opened = true; window.memoirOpened = true; notice.remove();
        pump();
    });
    E.bind('bibi:scrolled', pump);
    E.bind('bibi:laid-out', pump);
    window.addEventListener('resize', pump);
    // Pagination transitions can finish after the scroll event; only visible images start.
    setInterval(pump, 700);
});
