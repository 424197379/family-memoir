// Derive browser media from approved inputs; never encode a previous derivative.
import {readFile, writeFile, readdir, mkdir, rename, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
const exec = promisify(execFile);
export const sha = data => createHash('sha256').update(data).digest('hex');
const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const policy = JSON.parse(await readFile(path.join(here,'media-policy.json'),'utf8'));
const packages = JSON.parse(await readFile(path.join(here,'package.json'),'utf8')).devDependencies;
export async function probe(file) {
    const {stdout} = await exec(ffprobe.path, ['-v','error','-show_streams','-show_format','-of','json',file]);
    return JSON.parse(stdout);
}
export function isHDR(stream) { return ['arib-std-b67','smpte2084'].includes(stream.color_transfer); }
export function videoFilters(stream, settings=policy.video) {
    const filters = [];
    // FFmpeg autorotates before these filters. Account for the display matrix.
    const rotation = Math.abs(Number(stream.side_data_list?.find(s => s.rotation !== undefined)?.rotation || stream.tags?.rotate || 0));
    const portrait = (rotation % 180 !== 0) ? stream.width > stream.height : stream.height > stream.width;
    const w = portrait ? settings.shortEdge : settings.longEdge;
    const h = portrait ? settings.longEdge : settings.shortEdge;
    filters.push(`scale=w='min(${w},iw)':h='min(${h},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`);
    if (isHDR(stream)) {
        // Convert HLG/PQ to linear light, tone-map, then encode ordinary SDR.
        filters.push('zscale=t=linear:npl=100','format=gbrpf32le','zscale=p=bt709',`tonemap=tonemap=${settings.toneMap}:desat=2`,'zscale=t=bt709:m=bt709:r=limited');
    } else if ([stream.color_space,stream.color_transfer,stream.color_primaries].every(value=>value && value!=='unknown')) {
        filters.push('zscale=p=bt709:t=bt709:m=bt709:r=limited');
    }
    const [num,den] = (stream.avg_frame_rate || '0/1').split('/').map(Number);
    if (num/den > settings.maxFps) filters.push('fps='+settings.maxFps);
    filters.push('format=yuv420p','setsar=1');
    return filters.join(',');
}
async function encodeImage(data, settings) {
    const meta = await sharp(data).metadata();
    if ((meta.pages || 1) !== 1) throw Error('Animated image requires a separate publication decision');
    const edge = meta.width*meta.height >= settings.largeImagePixels ? settings.largeLongEdge : settings.longEdge;
    const pipeline = sharp(data).autoOrient().resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true}).toColourspace('srgb');
    const format = meta.hasAlpha ? 'png' : 'jpg';
    let output = format === 'png' ? await pipeline.png({compressionLevel:9}).toBuffer() : await pipeline.jpeg({quality:settings.quality,mozjpeg:true,chromaSubsampling:'4:4:4'}).toBuffer();
    // Already small compatible images should never get larger just to re-encode.
    // Preserve orientation/color conversion when either is actually needed.
    let finalFormat = format;
    if (output.length >= data.length && Math.max(meta.width,meta.height) <= edge && (!meta.orientation || meta.orientation===1) && meta.space==='srgb' && ['jpeg','png'].includes(meta.format)) {
        output = data;
        finalFormat = meta.format === 'jpeg' ? 'jpg' : 'png';
    }
    const result = await sharp(output).metadata();
    return {data:output,extension:finalFormat,width:result.width,height:result.height,transform:'resize-or-preserve'};
}
export async function prepareMedia({source=path.join(here,'docs/bibi-bookshelf/memoir/OEBPS/media'), cache=path.join(here,'web-media'), settings=policy, log=console.log}={}) {
    if (path.resolve(source)===path.resolve(cache)) throw Error('Derivative directory must differ from original directory');
    await mkdir(cache,{recursive:true});
    const manifestFile = path.join(cache,'manifest.json');
    let old = {items:[]};
    try { old = JSON.parse(await readFile(manifestFile,'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const recipe = sha(JSON.stringify({settings,implementation:sha(await readFile(fileURLToPath(import.meta.url))),tools:['sharp','ffmpeg-static','ffprobe-static'].map(name=>packages[name])}));
    const items = [];
    for (const name of (await readdir(source)).sort()) {
        const data = await readFile(path.join(source,name));
        const sourceSha256 = sha(data);
        const video = /\.(mov|mp4|m4v|webm)$/i.test(name);
        if (!video && !/\.(jpg|jpeg|png|webp|avif|tif|tiff)$/i.test(name)) throw Error('Unsupported media: '+name);
        let item = old.items.find(i => i.source===name && i.sourceSha256===sourceSha256 && i.recipe===recipe);
        if (item) {
            const cached = await readFile(path.join(cache,path.basename(item.file))).catch(error => {if (error.code==='ENOENT') return null; throw error;});
            if (!cached || sha(cached)!==item.sha256) item = null;
        }
        if (!item) {
            log('Optimizing '+name);
            let encoded;
            const input = path.join(source,name);
            if (video) {
                const original = await probe(input);
                const stream = original.streams.find(s => s.codec_type==='video');
                if (!stream) throw Error('No video stream: '+name);
                const temporary = path.join(cache,`.encoding-${process.pid}.mp4`);
                try {
                    await exec(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-y','-i',input,'-map','0:v:0','-map','0:a:0?','-vf',videoFilters(stream,settings.video),'-c:v','libx264','-crf',String(settings.video.crf),'-preset',settings.video.preset,'-pix_fmt','yuv420p','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-c:a','aac','-b:a',settings.video.audioKbps+'k','-map_metadata','-1','-map_chapters','-1','-movflags','+faststart',temporary],{timeout:900000,maxBuffer:4*1024*1024});
                    let remuxed = false;
                    const [fpsN,fpsD] = (stream.avg_frame_rate || '0/1').split('/').map(Number);
                    // Keep an already efficient, compatible source if lossy re-encoding grows it.
                    if ((await readFile(temporary)).length>data.length && stream.codec_name==='h264' && stream.pix_fmt==='yuv420p' && !isHDR(stream) && Math.max(stream.width,stream.height)<=settings.video.longEdge && Math.min(stream.width,stream.height)<=settings.video.shortEdge && fpsN/fpsD<=settings.video.maxFps && original.streams.filter(s=>s.codec_type==='audio').every(s=>s.codec_name==='aac')) {
                        await exec(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-y','-i',input,'-map','0:v:0','-map','0:a:0?','-c','copy','-map_metadata','-1','-map_chapters','-1','-movflags','+faststart',temporary],{timeout:60000});
                        remuxed = true;
                    }
                    const result = await probe(temporary);
                    const v = result.streams.find(s=>s.codec_type==='video');
                    const bytes = await readFile(temporary);
                    if (bytes.length>settings.video.maxBytes) throw Error('Compressed video exceeds 50 MiB: '+name);
                    if (v.codec_name!=='h264' || v.pix_fmt!=='yuv420p' || Math.abs(Number(original.format.duration)-Number(result.format.duration))>0.25) throw Error('Video validation failed: '+name);
                    if (original.streams.some(s=>s.codec_type==='audio') && !result.streams.some(s=>s.codec_name==='aac')) throw Error('Audio lost: '+name);
                    encoded = {data:bytes,extension:'mp4',width:v.width,height:v.height,duration:Number(result.format.duration),transform:remuxed?'H264-remux':isHDR(stream)?'HDR-to-SDR-H264':'H264'};
                } finally { await rm(temporary,{force:true}); }
            } else encoded = await encodeImage(data,settings.image);
            const digest = sha(encoded.data);
            const file = path.parse(name).name+'.'+digest.slice(0,16)+'.'+encoded.extension;
            const temporary = path.join(cache,file+'.'+process.pid+'.tmp');
            await writeFile(temporary,encoded.data);
            await rename(temporary,path.join(cache,file));
            item = {source:name,sourceSha256,sourceBytes:data.length,recipe,file,sha256:digest,bytes:encoded.data.length,type:video?'video/mp4':encoded.extension==='png'?'image/png':'image/jpeg',width:encoded.width,height:encoded.height,transform:encoded.transform,...(encoded.duration?{duration:encoded.duration}:{})};
        }
        items.push(item);
        log(`${name}: ${(item.sourceBytes/1048576).toFixed(2)} -> ${(item.bytes/1048576).toFixed(2)} MiB`);
    }
    const result = {version:1,items};
    const temporary = manifestFile+'.'+process.pid+'.tmp';
    await writeFile(temporary,JSON.stringify(result,null,2)+'\n');
    await rename(temporary,manifestFile);
    return result;
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
    const result = await prepareMedia();
    console.log(JSON.stringify({files:result.items.length,before:result.items.reduce((n,i)=>n+i.sourceBytes,0),after:result.items.reduce((n,i)=>n+i.bytes,0)},null,2));
}
