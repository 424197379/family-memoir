/* Memoir reader: keep original media, load visible photos after the book opens. */
Bibi.x({id: 'MemoirLoading', description: 'Visible photo loading and truthful progress', version: '1.0.0'})(function () {
    'use strict';
    const photos = [];
    let opened = false, active = 0, chapters = 0;
    const notice = document.getElementById('memoir-loading');
    const heading = notice.querySelector('p');
    const progress = notice.querySelector('progress');
    const size = bytes => (bytes / 1048576).toFixed(1) + ' MB';
    // Revalidate the small book documents after this loader update; media URLs stay stable.
    const download = O.download;
    O.download = function (source) {
        if (B.ExtractionPolicy || source.URI || !/\.(xhtml|opf|xml)$/.test(source.Path)) return download(source);
        const path = (/^([a-z]+:\/\/|\/)/.test(source.Path) ? '' : B.Path + '/') + source.Path;
        const url = new URL(path, location.href); url.searchParams.set('reader', 'loading2');
        source.URI = url.href;
        return download(source).catch(error => {
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

    function load(photo) {
        if (photo.state === 'loading' || photo.state === 'done') return;
        photo.state = 'loading'; active++;
        photo.button.hidden = true;
        photo.bar.hidden = false; photo.bar.removeAttribute('value');
        photo.label.textContent = '正在连接，加载原图…';
        const xhr = new XMLHttpRequest();
        let timer, finished = false;
        function idleTimer() {
            clearTimeout(timer);
            timer = setTimeout(() => { xhr.abort(); finish('30秒没有收到图片数据，请重试。'); }, 30000);
        }
        function finish(error) {
            if (finished) return;
            finished = true; clearTimeout(timer); active--;
            if (error) {
                photo.state = 'failed'; photo.bar.hidden = true;
                photo.label.textContent = error; photo.button.textContent = '重新加载照片'; photo.button.hidden = false;
            } else {
                photo.state = 'done'; photo.status.hidden = true; photo.img.dataset.ready = 'yes';
            }
            pump();
        }
        xhr.open('GET', photo.url, true); xhr.responseType = 'blob';
        xhr.onprogress = event => {
            idleTimer();
            const total = event.lengthComputable ? event.total : photo.bytes;
            photo.bar.max = total || 1; photo.bar.value = event.loaded;
            photo.label.textContent = total ? '正在加载原图：' + Math.min(100, Math.floor(event.loaded / total * 100)) + '%（' + size(event.loaded) + ' / ' + size(total) + '）' : '已收到 ' + size(event.loaded);
        };
        xhr.onerror = () => finish('图片连接失败，可以重试；文字仍可阅读。');
        xhr.onload = () => {
            if (xhr.status !== 200) return finish('图片加载失败（' + xhr.status + '），请重试。');
            const blobURL = URL.createObjectURL(xhr.response);
            photo.img.onload = () => { URL.revokeObjectURL(blobURL); finish(); };
            photo.img.onerror = () => { URL.revokeObjectURL(blobURL); finish('图片未能显示，请重试。'); };
            photo.label.textContent = '图片已下载，正在显示…';
            photo.img.src = blobURL;
        };
        xhr.send(); idleTimer();
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
            const photo = {item, img, box, status, label, bar, button, bytes: Number(img.dataset.memoirBytes), url: new URL(img.dataset.memoirSrc, doc.baseURI).href, state: 'idle'};
            // Bibi turns pages on pointer-up, before a normal button click arrives.
            ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend'].forEach(name => {
                button.addEventListener(name, event => event.stopPropagation());
            });
            button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); load(photo); });
            photos.push(photo);
        });
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
