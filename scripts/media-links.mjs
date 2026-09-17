// Change resource attributes only. Captions, prose and surrounding markup stay intact.
export function rewriteMediaLinks(markup, media, reverse=false) {
    return markup.replace(/<[^>]+>/g, tag => {
        for (const item of media) {
            const from = reverse ? item.url : item.originalUrl;
            const to = reverse ? item.originalUrl : item.url;
            if (!tag.includes('"'+from+'"')) continue;
            tag = tag.replaceAll('"'+from+'"','"'+to+'"');
            tag = tag.replace(/data-memoir-bytes="\d+"/, 'data-memoir-bytes="'+(reverse?item.sourceBytes:item.bytes)+'"');
            if (/^<item\s/.test(tag)) tag = tag.replace(/media-type="[^"]+"/,'media-type="'+(reverse?item.sourceType:item.type)+'"');
        }
        return tag;
    });
}
