import { identifyAudio, testSound } from './audio-file';
import { at, type Signal } from './signal';
import { MotionRenderer, frameTime, type PreloadedTiles } from './motion';
import { beatPulse, type Tempo } from './tempo';
import { recentHits, type DrumHit } from './drums';
import { wav } from './separation';
import { DrumPanel } from './drum-panel';
import type { PerimeterSource } from './reactive-ink';
import { muxMp4, type EncodedSample } from './mp4';

const canvas = document.querySelector<HTMLCanvasElement>('#visualizer')!;
const toggle = document.querySelector<HTMLButtonElement>('#toggle')!;
const reset = document.querySelector<HTMLButtonElement>('#reset')!;
const scrubber = document.querySelector<HTMLInputElement>('#scrubber')!;
const readout = document.querySelector<HTMLElement>('#time-readout')!;
const audio = document.querySelector<HTMLAudioElement>('#audio')!;
const sourceLabel = document.querySelector<HTMLElement>('#source-label')!;
const meter = document.querySelector<HTMLElement>('#meter')!;
const status = document.querySelector<HTMLElement>('#load-status')!;
let loadVersion = 0;
let ready = false;
let loadFailed = false;
let selectedName = '';
let loadTimeout: ReturnType<typeof setTimeout> | undefined;

let audioContext: AudioContext | undefined;
let objectUrl: string | undefined;
let currentDuration = 0;
let playing = false;
let mediaReady = false;
let signal: Signal | undefined;
let otherSignal: Signal | undefined;
let hits: DrumHit[] = [];
let tileMode: 'live' | 'preload' = 'live';
let preloadedTiles: PreloadedTiles | undefined;
let tilesWorker: Worker | undefined;
let tilesTimer: ReturnType<typeof setTimeout> | undefined;
let tilesVersion = 0;
let resumeAfterTiles = false;
let stemUrls: {mix:string;drums:string;other:string}|undefined;
let auxiliaryUrls:string[]=[];
let exporting=false;
let drumFile:File|undefined,otherFile:File|undefined;
const monitor=document.querySelector<HTMLSelectElement>('#monitor')!;
const applyStems=document.querySelector<HTMLButtonElement>('#apply-stems')!;
const exportButton=document.querySelector<HTMLButtonElement>('#export-video')!;
let worker: Worker | undefined;
let lastRendered = -1;
const renderer = new MotionRenderer(canvas);
const sensitivity = document.querySelector<HTMLInputElement>('#sensitivity')!;
const caption = document.querySelector<HTMLInputElement>('#caption')!;
const fps = document.querySelector<HTMLSelectElement>('#fps')!;
const perimeterSource = document.querySelector<HTMLSelectElement>('#perimeter-source')!;
const impact = document.querySelector<HTMLInputElement>('#impact')!;
const tileFade = document.querySelector<HTMLInputElement>('#tile-fade')!;
const bpm = document.querySelector<HTMLInputElement>('#bpm')!;
const tempoScale = document.querySelector<HTMLSelectElement>('#tempo-scale')!;
const beatOffset = document.querySelector<HTMLInputElement>('#beat-offset')!;
const tempoReadout = document.querySelector<HTMLElement>('#tempo-readout')!;
const tempoDetail = document.querySelector<HTMLElement>('#tempo-detail')!;
const beatLight = document.querySelector<HTMLElement>('#beat-light')!;
const drumPanel=new DrumPanel(audio,next=>{hits=next;if(tileMode==='preload')rebuildTiles();else syncFromAudio();});

function rebuildTiles() {
  if (tileMode !== 'preload' || !signal || loadFailed) return;
  clearTimeout(tilesTimer); tilesWorker?.terminate(); tilesWorker=undefined;
  const generation=++tilesVersion, version=loadVersion;
  preloadedTiles=undefined;
  resumeAfterTiles ||= playing;
  audio.pause(); playing=false; ready=false; updatePlayControl();
  toggle.disabled=reset.disabled=scrubber.disabled=monitor.disabled=true;
  status.textContent=`${selectedName} · 곡 전체 타일 사전 생성 준비 중…`;
  document.querySelector('#tile-mode-readout')!.textContent='사전 생성 · 준비 중…';
  tilesTimer=setTimeout(()=>{
    const compiler=new Worker(new URL('./tiles.worker.ts',import.meta.url),{type:'module'});
    tilesWorker=compiler;
    compiler.onmessage=(event:MessageEvent<{progress?:number;track?:PreloadedTiles;error?:string}>)=>{
      if(version!==loadVersion||generation!==tilesVersion||loadFailed)return;
      if(event.data.progress!==undefined){status.textContent=`${selectedName} · 곡 전체 타일 사전 생성 ${event.data.progress}%`;return;}
      compiler.terminate();tilesWorker=undefined;
      if(!event.data.track){fail(event.data.error??'타일 사전 생성에 실패했습니다. 다시 불러오세요.');return;}
      preloadedTiles=event.data.track;
      document.querySelector('#tile-mode-readout')!.textContent=`사전 생성 · ${preloadedTiles.tileCount.toLocaleString()}개 타일 · ${preloadedTiles.duration.toFixed(1)}초 준비 완료`;
      enableWhenReady();
    };
    compiler.onerror=()=>{if(version===loadVersion&&generation===tilesVersion)fail('타일 사전 생성에 실패했습니다. 다시 불러오세요.');};
    compiler.postMessage({signal,gain:Number(sensitivity.value),options:{fps:Number(fps.value),impact:Number(impact.value),tileFade:Number(tileFade.value),tempo:effectiveTempo(),hits,otherSignal}});
  },150);
}

function updatePlayControl() {
  const label = playing ? '일시정지' : '재생';
  document.querySelector('#toggle-label')!.textContent = label;
  toggle.setAttribute('aria-label', label);
  toggle.dataset.playing = String(playing);
}

function effectiveTempo(): Tempo | null {
  const manual = Number(bpm.value);
  const detected = signal?.tempo;
  if (!(manual >= 40 && manual <= 240) && !detected) return null;
  return { bpm: (manual >= 40 && manual <= 240 ? manual : detected!.bpm) * Number(tempoScale.value), offset: (detected?.offset ?? 0) + clamp(Number(beatOffset.value) || 0, -500, 500) / 1000, confidence: manual >= 40 && manual <= 240 ? 1 : detected!.confidence };
}
function updateTempoUI() {
  const tempo = effectiveTempo();
  tempoReadout.textContent = tempo ? `${Number(tempo.bpm.toFixed(2))} BPM` : 'BPM —';
  tempoDetail.textContent = tempo ? (bpm.value ? '직접 보정' : `자동 추정 · 신뢰도 ${Math.round(tempo.confidence * 100)}%`) : signal ? '일정한 박자를 찾지 못해 소리의 어택에 반응합니다' : '오디오를 넣으면 박자를 자동으로 찾습니다';
  document.querySelector('#fps-readout')!.textContent = `${fps.value} FPS`;
}

function clamp(value: number, min = 0, max = 1) { return Math.max(min, Math.min(max, value)); }
function draw(time: number, _delta = 0) {
  const tempo = effectiveTempo();
  renderer.render(signal, time, Number(sensitivity.value), caption.value, { fps: Number(fps.value), impact: Number(impact.value), tileFade: Number(tileFade.value), tempo, hits, otherSignal, preloadedTiles, perimeterSource: perimeterSource.value as PerimeterSource });
  document.querySelector('#drum-readout')!.textContent=recentHits(hits,frameTime(time,Number(fps.value))).map(h=>h.kind.toUpperCase()).filter((v,i,a)=>a.indexOf(v)===i).join(' · ')||'—';
  const feature = at(signal, time);
  readout.textContent = `${String(Math.floor(time / 60)).padStart(2, '0')}:${(time % 60).toFixed(3).padStart(6, '0')}`;
  meter.textContent = `LOW ${Math.round(feature.bands[0] * 100)} · MID ${Math.round(feature.bands[2] * 100)} · HIGH ${Math.round(feature.bands[3] * 100)}`;
  beatLight.dataset.active = String(feature.level > 0.045 && beatPulse(tempo, frameTime(time, Number(fps.value)), Math.max(1 / Number(fps.value), 0.09)).pulse > 0);
  lastRendered = frameTime(time, Number(fps.value));
}
function syncFromAudio(_delta = 0) {
  const time = audio.src ? audio.currentTime : 0;
  scrubber.value = String(time); draw(time);drumPanel.draw(time);
}
function animationFrame() {
  if (playing) {
    drumPanel.draw(audio.currentTime);
    scrubber.value = String(audio.currentTime);
    if (frameTime(audio.currentTime, Number(fps.value)) !== lastRendered) draw(audio.currentTime);
  }
  requestAnimationFrame(animationFrame);
}
let audioSource: MediaElementAudioSourceNode | undefined;
let recordDestination: MediaStreamAudioDestinationNode | undefined;
async function ensureAudioGraph() {
  audioContext ??= new AudioContext();
  if (!audioSource) {
    audioSource = audioContext.createMediaElementSource(audio);
    recordDestination = audioContext.createMediaStreamDestination();
    audioSource.connect(audioContext.destination);
    audioSource.connect(recordDestination);
  }
}

function enableWhenReady() {
  if (!mediaReady || !signal || loadFailed) return;
  if (tileMode==='preload'&&!preloadedTiles) return;
  ready = true; toggle.disabled = reset.disabled = scrubber.disabled = false;
  exportButton.disabled = false;
  monitor.disabled=false;
  scrubber.max = String(currentDuration);
  document.querySelector('#duration-readout')!.textContent = `${String(Math.floor(currentDuration / 60)).padStart(2, '0')}:${String(Math.floor(currentDuration % 60)).padStart(2, '0')}`;
  status.textContent = `${selectedName} · ${currentDuration.toFixed(1)}초 · 준비됨. 재생을 눌러주세요.`;
  syncFromAudio();
  if(resumeAfterTiles){resumeAfterTiles=false;void setPlaying(true).catch(()=>fail('재생을 다시 시작하지 못했습니다.'));}
}

async function analyseFile(file: File, version: number, restFile?:File) {
  await ensureAudioGraph();
  const decoded = await audioContext!.decodeAudioData(await file.arrayBuffer());
  if (version !== loadVersion || loadFailed) return;
  // Select the more energetic channel instead of cancelling anti-phase stereo.
  let channel = 0, maximum = -1;
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const data = decoded.getChannelData(c); let power = 0;
    for (let i = 0; i < data.length; i += 32) power += data[i] * data[i];
    if (power > maximum) { maximum = power; channel = c; }
  }
  const samples = decoded.getChannelData(channel).slice();
  let restSamples:Float32Array|undefined;
  if(restFile) {
    const restDecoded=await audioContext!.decodeAudioData(await restFile.arrayBuffer());
    if(version!==loadVersion||loadFailed)return;
    let best=0,power=-1;
    for(let c=0;c<restDecoded.numberOfChannels;c++){const data=restDecoded.getChannelData(c);let e=0;for(let i=0;i<data.length;i+=32)e+=data[i]*data[i];if(e>power){power=e;best=c;}}
    restSamples=restDecoded.getChannelData(best).slice();
    const length=Math.max(decoded.length,restDecoded.length),channels:Float32Array[]=[];
    for(let c=0;c<Math.max(decoded.numberOfChannels,restDecoded.numberOfChannels);c++) {
      const a=decoded.getChannelData(Math.min(c,decoded.numberOfChannels-1)),b=restDecoded.getChannelData(Math.min(c,restDecoded.numberOfChannels-1));
      channels.push(Float32Array.from({length},(_,i)=>((a[i]??0)+(b[i]??0))*0.5));
    }
    if(objectUrl)URL.revokeObjectURL(objectUrl);
    objectUrl=URL.createObjectURL(wav(channels,decoded.sampleRate));mediaReady=false;audio.src=objectUrl;audio.load();
  }
  worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<{ signal?: Signal; otherSignal?:Signal; hits?:DrumHit[]; drums?:Float32Array; rest?:Float32Array; sampleRate:number; progress?:string; error?: string }>) => {
    if (version !== loadVersion) return;
    if(event.data.progress){status.textContent=`${selectedName} · ${event.data.progress}`;return;}
    worker?.terminate(); worker = undefined;
    if (!event.data.signal) { fail(event.data.error ?? '오디오 분석에 실패했습니다.'); return; }
    signal = event.data.signal;otherSignal=event.data.otherSignal;hits=event.data.hits??[];
    if(event.data.drums&&event.data.rest) {
      drumPanel.load(signal,event.data.drums,event.data.sampleRate,audioContext!);
      const length=Math.max(event.data.drums.length,event.data.rest.length);
      const pad=(data:Float32Array)=>{if(data.length===length)return data;const out=new Float32Array(length);out.set(data);return out;};
      const drums=URL.createObjectURL(wav([pad(event.data.drums)],event.data.sampleRate)),other=URL.createObjectURL(wav([pad(event.data.rest)],event.data.sampleRate));
      auxiliaryUrls.push(drums,other);stemUrls={mix:objectUrl!,drums,other};
      const originalDrums=restFile?URL.createObjectURL(file):drums,originalOther=restFile?URL.createObjectURL(restFile):other;
      if(restFile)auxiliaryUrls.push(originalDrums,originalOther);
      for(const [id,url,name] of [['#download-drums',originalDrums,restFile?file.name:'percussion-approx-mono.wav'],['#download-other',originalOther,restFile?restFile.name:'rest-approx-mono.wav']]) {
        const link=document.querySelector<HTMLAnchorElement>(id)!;link.href=url;link.download=name;link.hidden=false;
      }
    }
    updateTempoUI(); enableWhenReady();
  };
  worker.onerror = () => { if (version === loadVersion) fail('오디오 분석을 완료하지 못했습니다. 파일을 다시 선택하세요.'); };
  worker.postMessage({ samples, restSamples, sampleRate: decoded.sampleRate }, restSamples?[samples.buffer,restSamples.buffer]:[samples.buffer]);
}
sensitivity.addEventListener('input', () => {if(tileMode==='preload')rebuildTiles();else syncFromAudio();});
caption.addEventListener('input', () => syncFromAudio());
for (const control of [fps, impact, tileFade, bpm, tempoScale, beatOffset]) control.addEventListener('input', () => { updateTempoUI(); if(tileMode==='preload')rebuildTiles();else syncFromAudio(); });
perimeterSource.addEventListener('input',()=>syncFromAudio());

let exportCancel = false;
function setExportProgress(message: string, value: number, format?: string) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  window.dispatchEvent(new CustomEvent('tototo:export-progress', { detail: { message, value: percent, format } }));
}
function openExportSheet(mime: string) {
  exportCancel = false;
  window.dispatchEvent(new CustomEvent('tototo:export-open', { detail: { format: mime.startsWith('video/mp4') ? 'MP4' : 'WebM' } }));
  setExportProgress('빠른 렌더링을 준비하고 있습니다…', 0);
}
function downloadExport(blob: Blob, mime: string) {
  const isMp4 = mime.startsWith('video/mp4');
  const base = (selectedName.split(' + ')[0] || 'tototo').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9가-힣_-]+/g, '-');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${base || 'tototo'}-motion.${isMp4 ? 'mp4' : 'webm'}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
async function hasSeekableMp4(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = new TextDecoder('latin1').decode(bytes);
  const moov = text.indexOf('moov');
  const mvhd = text.indexOf('mvhd', Math.max(0, moov));
  if (moov < 4 || mvhd < 0 || mvhd + 24 > bytes.length) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[mvhd + 4];
  if (version === 1 && mvhd + 40 <= bytes.length) return view.getUint32(mvhd + 28) > 0 && view.getBigUint64(mvhd + 32) > 0n;
  return view.getUint32(mvhd + 16) > 0 && view.getUint32(mvhd + 20) > 0;
}

type ExportGlobals = { MediaStreamTrackGenerator?: new (options: { kind: 'audio' | 'video' }) => any; VideoFrame?: new (source: CanvasImageSource, options: { timestamp: number; duration?: number }) => any; AudioData?: new (options: Record<string, unknown>) => any };
async function fastMp4Export(): Promise<Blob | undefined> {
  const globals = window as unknown as ExportGlobals & { VideoEncoder?: any; AudioEncoder?: any };
  if (!globals.VideoEncoder || !globals.AudioEncoder || !globals.VideoFrame || !globals.AudioData || !objectUrl) return undefined;
  const decoded = await audioContext!.decodeAudioData(await (await fetch(objectUrl)).arrayBuffer());
  const rate = Math.max(10, Number(fps.value));
  const frameDuration = 1 / rate;
  const videoSamples: (EncodedSample & { timestamp: number })[] = [];
  const audioSamples: (EncodedSample & { timestamp: number })[] = [];
  let avcDescription = new Uint8Array();
  let aacDescription = new Uint8Array();
  let videoError: Error | undefined;
  let audioError: Error | undefined;
  const videoEncoder = new globals.VideoEncoder({
    output: (chunk: any, metadata: any) => {
      const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
      const description = metadata?.decoderConfig?.description;
      if (description) avcDescription = new Uint8Array(description.slice ? description.slice(0) : description);
      videoSamples.push({ data, duration: Math.round(frameDuration * 90000), timestamp: chunk.timestamp ?? 0, key: chunk.type === 'key' });
    },
    error: (error: Error) => { videoError = error; },
  });
  const audioEncoder = new globals.AudioEncoder({
    output: (chunk: any, metadata: any) => {
      const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
      const description = metadata?.decoderConfig?.description;
      if (description) aacDescription = new Uint8Array(description.slice ? description.slice(0) : description);
      // EncodedAudioChunk.duration is expressed in microseconds; the MP4
      // audio track uses sample-rate ticks instead.
      audioSamples.push({ data, duration: chunk.duration ? Math.max(1, Math.round(chunk.duration * decoded.sampleRate / 1e6)) : 1024, timestamp: chunk.timestamp ?? 0 });
    },
    error: (error: Error) => { audioError = error; },
  });
  try {
    const videoConfig = { codec: 'avc1.42001f', width: canvas.width, height: canvas.height, bitrate: 8_000_000, framerate: rate, avc: { format: 'avc' } };
    const audioConfig = { codec: 'mp4a.40.2', sampleRate: decoded.sampleRate, numberOfChannels: decoded.numberOfChannels, bitrate: 192_000 };
    if (!(await globals.VideoEncoder.isConfigSupported(videoConfig)).supported || !(await globals.AudioEncoder.isConfigSupported(audioConfig)).supported) return undefined;
    videoEncoder.configure(videoConfig); audioEncoder.configure(audioConfig);
    const frameCount = Math.ceil(currentDuration * rate);
    for (let index = 0; index < frameCount; index++) {
      if (exportCancel) throw new Error('내보내기가 취소되었습니다.');
      const time = Math.min(index / rate, Math.max(0, currentDuration - frameDuration));
      draw(time);
      const frame = new globals.VideoFrame(canvas, { timestamp: Math.round(time * 1e6), duration: Math.round(frameDuration * 1e6) });
      videoEncoder.encode(frame, { keyFrame: index === 0 || index % Math.max(1, Math.round(rate * 2)) === 0 }); frame.close();
      if (videoEncoder.encodeQueueSize > 12) await videoEncoder.flush();
      if (index % Math.max(1, Math.floor(rate / 4)) === 0) setExportProgress('화면을 빠르게 프레임 단위로 렌더링하고 있습니다…', index / frameCount * 72);
    }
    await videoEncoder.flush();
    const chunkSize = 2048;
    const channels = decoded.numberOfChannels;
    for (let offset = 0; offset < decoded.length; offset += chunkSize) {
      if (exportCancel) throw new Error('내보내기가 취소되었습니다.');
      const count = Math.min(chunkSize, decoded.length - offset);
      const interleaved = new Float32Array(count * channels);
      for (let frame = 0; frame < count; frame++) for (let channel = 0; channel < channels; channel++) interleaved[frame * channels + channel] = decoded.getChannelData(channel)[offset + frame];
      const audioData = new globals.AudioData({ format: 'f32', sampleRate: decoded.sampleRate, numberOfFrames: count, numberOfChannels: channels, timestamp: Math.round(offset / decoded.sampleRate * 1e6), data: interleaved });
      audioEncoder.encode(audioData); audioData.close();
      if (audioEncoder.encodeQueueSize > 12) await audioEncoder.flush();
      if (offset % (chunkSize * 16) === 0) setExportProgress('오디오를 빠르게 인코딩하고 있습니다…', 72 + offset / decoded.length * 20);
    }
    await audioEncoder.flush();
    if (videoError || audioError || !videoSamples.length || !audioSamples.length || !avcDescription.length) return undefined;
    videoSamples.sort((a, b) => a.timestamp - b.timestamp); audioSamples.sort((a, b) => a.timestamp - b.timestamp);
    setExportProgress('MP4 인덱스와 오디오 트랙을 묶고 있습니다…', 96);
    return muxMp4(
      { kind: 'video', samples: videoSamples, timescale: 90000, description: avcDescription, width: canvas.width, height: canvas.height },
      { kind: 'audio', samples: audioSamples, timescale: decoded.sampleRate, description: aacDescription, channels: decoded.numberOfChannels, sampleRate: decoded.sampleRate },
    );
  } finally {
    videoEncoder.close(); audioEncoder.close();
  }
}
async function fastExport(mime: string): Promise<Blob | undefined> {
  const globals = window as unknown as ExportGlobals;
  if (!globals.MediaStreamTrackGenerator || !globals.VideoFrame || !globals.AudioData || !objectUrl) return undefined;
  const videoTrack = new globals.MediaStreamTrackGenerator({ kind: 'video' });
  const audioTrack = new globals.MediaStreamTrackGenerator({ kind: 'audio' });
  const videoWriter = videoTrack.writable.getWriter();
  const audioWriter = audioTrack.writable.getWriter();
  const stream = new MediaStream([videoTrack, audioTrack]);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error('빠른 인코딩 중 오류가 발생했습니다.'));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
  });
  // Keep one final container chunk so its duration and seek index are closed.
  recorder.start();
  try {
    const decoded = await audioContext!.decodeAudioData(await (await fetch(objectUrl)).arrayBuffer());
    const rate = Math.max(10, Number(fps.value));
    const frameCount = Math.ceil(currentDuration * rate);
    const renderVideo = async () => {
      for (let index = 0; index < frameCount; index++) {
        if (exportCancel) throw new Error('내보내기가 취소되었습니다.');
        const time = Math.min(index / rate, Math.max(0, currentDuration - 1 / rate));
        draw(time);
        const frame = new globals.VideoFrame!(canvas, { timestamp: Math.round(time * 1e6), duration: Math.round(1e6 / rate) });
        await videoWriter.write(frame);
        frame.close();
        if (index % Math.max(1, Math.floor(rate / 4)) === 0) setExportProgress('화면 프레임을 빠르게 렌더링하고 있습니다…', index / frameCount * 78);
      }
      await videoWriter.close();
    };
    const renderAudio = async () => {
      const chunkSize = 2048;
      const channels = decoded.numberOfChannels;
      for (let offset = 0; offset < decoded.length; offset += chunkSize) {
        if (exportCancel) throw new Error('내보내기가 취소되었습니다.');
        const count = Math.min(chunkSize, decoded.length - offset);
        const interleaved = new Float32Array(count * channels);
        for (let frame = 0; frame < count; frame++) for (let channel = 0; channel < channels; channel++) interleaved[frame * channels + channel] = decoded.getChannelData(channel)[offset + frame];
        const data = new globals.AudioData!({ format: 'f32', sampleRate: decoded.sampleRate, numberOfFrames: count, numberOfChannels: channels, timestamp: Math.round(offset / decoded.sampleRate * 1e6), data: interleaved });
        await audioWriter.write(data);
        data.close();
      }
      await audioWriter.close();
    };
    await Promise.all([renderVideo(), renderAudio()]);
    setExportProgress('오디오와 화면을 하나의 파일로 묶고 있습니다…', 94);
    recorder.stop();
    return await stopped;
  } catch (error) {
    if (recorder.state !== 'inactive') recorder.stop();
    try { await stopped; } catch { /* the original error is more useful */ }
    throw error;
  }
}

async function realtimeExport(mime: string): Promise<Blob> {
  if (!recordDestination) throw new Error('이 브라우저에서는 동영상 오디오 녹음을 사용할 수 없습니다.');
  const canvasStream = canvas.captureStream(30);
  const stream = new MediaStream([...canvasStream.getVideoTracks(), ...recordDestination.stream.getAudioTracks()]);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000 });
  const chunks: Blob[] = [];
  const progressTimer = setInterval(() => {
    if (exportCancel && recorder.state !== 'inactive') { audio.pause(); recorder.stop(); }
    setExportProgress('호환 모드로 화면과 소리를 녹화하고 있습니다…', audio.currentTime / currentDuration * 100);
  }, 200);
  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error('녹화 중 오류가 발생했습니다.'));
      recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
      audio.currentTime = 0; audio.playbackRate = 1; clearAnalysis(); syncFromAudio();
      // Timesliced MP4 can remain a live-style fragmented file. Finalize it
      // only at stop so desktop players see a stable duration.
      recorder.start();
      void audioContext!.resume().then(() => audio.play()).catch(reject);
      audio.addEventListener('ended', () => { if (recorder.state !== 'inactive') recorder.stop(); }, { once: true });
    });
    return blob;
  } finally {
    clearInterval(progressTimer);
    if (recorder.state !== 'inactive') recorder.stop();
    canvasStream.getTracks().forEach(track => track.stop());
  }
}

async function exportVideo() {
  if (!ready || exporting || !signal) return;
  try { await ensureAudioGraph(); } catch { status.textContent = '이 브라우저에서는 동영상 오디오 녹음을 사용할 수 없습니다.'; status.dataset.error = 'true'; return; }
  if (!('MediaRecorder' in window)) { status.textContent = '이 브라우저에서는 동영상 내보내기를 지원하지 않습니다.'; status.dataset.error = 'true'; return; }
  const mime = ['video/mp4', 'video/mp4;codecs=h264,aac', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
  if (!mime) { status.textContent = '이 브라우저에서는 동영상 내보내기를 지원하지 않습니다.'; return; }
  const originalTime = audio.currentTime;
  const originalPlaybackRate = audio.playbackRate;
  const originalPlaying = playing;
  exporting = true; exportButton.disabled = true; toggle.disabled = reset.disabled = scrubber.disabled = true;
  openExportSheet(mime);
  audio.pause(); playing = false; updatePlayControl();
  try {
    let blob: Blob | undefined;
    // MP4 uses WebCodecs plus our own seekable ISO-BMFF muxer, so rendering
    // is detached from playback speed instead of relying on live MediaRecorder.
    try { blob = mime.startsWith('video/mp4') ? await fastMp4Export() : await fastExport(mime); } catch (error) {
      if (exportCancel) throw error;
      setExportProgress('빠른 렌더링을 지원하지 않아 호환 모드로 전환합니다…', 0);
      blob = await realtimeExport(mime);
    }
    if (exportCancel) throw new Error('내보내기가 취소되었습니다.');
    if (!blob) { setExportProgress(mime.startsWith('video/mp4') ? 'MP4 컨테이너의 재생 정보를 마무리하고 있습니다…' : '호환 모드로 내보내고 있습니다…', 0); blob = await realtimeExport(mime); }
    let outputMime = mime;
    if (mime.startsWith('video/mp4') && !(await hasSeekableMp4(blob))) {
      const webm = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
      if (!webm) throw new Error('브라우저가 재생 가능한 MP4 컨테이너를 만들지 못했습니다.');
      setExportProgress('브라우저의 MP4 인덱스가 불완전해 호환 포맷으로 다시 내보내고 있습니다…', 0);
      audio.pause(); audio.currentTime = 0; blob = await realtimeExport(webm); outputMime = webm;
      setExportProgress('호환 WebM으로 전환했습니다.', 0, 'WebM · 호환 대체');
    }
    downloadExport(blob, outputMime);
    const outputName = outputMime.startsWith('video/mp4') ? 'MP4' : 'WebM';
    setExportProgress(`${outputName} 내보내기가 완료되었습니다.`, 100);
    status.dataset.error = 'false'; status.textContent = `${selectedName} · ${outputName} 내보내기 완료`;
    setTimeout(() => window.dispatchEvent(new CustomEvent('tototo:export-close')), 800);
  } catch (error) {
    const message = error instanceof Error ? error.message : '동영상 내보내기에 실패했습니다.';
    setExportProgress(message, 0); status.textContent = message; status.dataset.error = exportCancel ? 'false' : 'true';
    window.dispatchEvent(new CustomEvent('tototo:export-close'));
  } finally {
    audio.pause(); audio.currentTime = Math.min(originalTime, currentDuration); audio.playbackRate = originalPlaybackRate; playing = false; clearAnalysis(); syncFromAudio();
    if (originalPlaying) { try { await setPlaying(true); } catch { status.textContent = '내보내기는 완료했지만 재생을 다시 시작하지 못했습니다.'; } }
    exporting = false; exportButton.disabled = !ready; toggle.disabled = reset.disabled = scrubber.disabled = !ready; if (!originalPlaying) updatePlayControl();
  }
}
window.addEventListener('tototo:export-cancel', () => { if (!exporting) return; exportCancel = true; setExportProgress('내보내기를 취소하고 있습니다…', 0); });
exportButton.addEventListener('click', () => { void exportVideo(); });

async function setPlaying(next: boolean) {
  if (!ready) return;
  const version = loadVersion;
  await ensureAudioGraph();
  if (next) {
    await audioContext!.resume();
    if (version !== loadVersion) return;
    await audio.play();
  } else audio.pause();
  if (version !== loadVersion) return;
  playing = next; updatePlayControl();
  status.dataset.error = 'false';
  status.textContent = `${selectedName} · ${playing ? '재생 중' : '일시정지'}`;
}

function clearAnalysis() {
  lastRendered = -1;
}
function fail(message: string) {
  clearTimeout(tilesTimer);tilesWorker?.terminate();tilesWorker=undefined;tilesVersion++;resumeAfterTiles=false;
  loadFailed = true;
  clearTimeout(loadTimeout);
  worker?.terminate(); worker = undefined;
  playing = false; ready = false; audio.pause();
  monitor.disabled=true;
  updatePlayControl(); toggle.disabled = reset.disabled = scrubber.disabled = true; exportButton.disabled = true;
  status.textContent = message; status.dataset.error = 'true';
}
async function loadFile(file: File, restFile?:File, mode: 'live'|'preload' = 'live') {
  clearTimeout(tilesTimer);tilesWorker?.terminate();tilesWorker=undefined;tilesVersion++;
  preloadedTiles=undefined;tileMode=mode;resumeAfterTiles=false;
  document.querySelector('#tile-mode-readout')!.textContent=mode==='preload'?'사전 생성 · 오디오 분석 대기':'즉흥 생성 · 현재 방식';
  drumPanel.clear();
  const version = ++loadVersion;
  loadFailed = false;
  clearTimeout(loadTimeout);
  worker?.terminate(); worker = undefined; signal = undefined; mediaReady = false;
  otherSignal=undefined;hits=[];stemUrls=undefined;monitor.disabled=true;monitor.value='mix';
  auxiliaryUrls.forEach(url=>URL.revokeObjectURL(url));auxiliaryUrls=[];
  document.querySelectorAll<HTMLAnchorElement>('.stem-downloads a').forEach(a=>{a.hidden=true;a.removeAttribute('href');});
  document.querySelector('#stem-mode')!.textContent=restFile?'직접 입력한 드럼 / 나머지 스템 · 전체 재생은 6dB 여유를 두고 합칩니다. 스템 단독 듣기는 분석용 모노이며 저장은 입력 원본입니다.':'자동 근사 분리 (HPSS) · 타악 성분을 추출한 모노 스템입니다. 보컬·피아노 어택이 섞이거나 일부 드럼이 남을 수 있습니다.';
  bpm.value = ''; tempoScale.value = '1'; beatOffset.value = '0'; updateTempoUI();
  playing = ready = false; audio.pause(); audio.removeAttribute('src'); audio.load();
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = undefined; }
  updatePlayControl(); toggle.disabled = reset.disabled = scrubber.disabled = true; exportButton.disabled = true;
  document.querySelector('#duration-readout')!.textContent = '00:00';
  currentDuration = 0; scrubber.value = '0';
  selectedName = restFile?`${file.name} + ${restFile.name}`:file.name; sourceLabel.textContent = selectedName;
  status.dataset.error = 'false'; status.textContent = `${file.name} · 파일 확인 중…`;
  clearAnalysis(); draw(0, 0);
  try {
    if (!file.size) throw new Error('빈 파일입니다. 오디오 데이터가 있는 파일을 선택하세요.');
    const detected = await identifyAudio(file);
    if (version !== loadVersion) return;
    if (!detected && !file.type.startsWith('audio/')) throw new Error('오디오 형식을 확인할 수 없습니다. MP3, WAV, FLAC, OGG 또는 M4A 파일을 선택하세요.');
    const blob = detected && detected !== file.type ? new Blob([file], { type: detected }) : file;
    objectUrl = URL.createObjectURL(blob); audio.src = objectUrl;
    status.textContent = `${file.name} · 오디오 로딩 중…`;
    audio.load();
    void analyseFile(blob instanceof File ? blob : new File([blob], file.name, { type: blob.type }), version,restFile).catch(error => {
      if (version === loadVersion) fail(`오디오 분석에 실패했습니다. 브라우저가 디코딩할 수 있는 MP3 또는 PCM WAV로 시도하세요. (${error instanceof Error ? error.name : '오류'})`);
    });
    loadTimeout = setTimeout(() => { if (version === loadVersion && !mediaReady) fail('오디오 로딩 시간이 초과되었습니다. 파일을 다시 선택하거나 다른 형식으로 시도하세요.'); }, 20000);
  } catch (error) {
    if (version === loadVersion) fail(error instanceof Error ? error.message : '파일을 읽지 못했습니다. 다시 선택하세요.');
  }
}
toggle.addEventListener('click', async () => {
  const version = loadVersion;
  try { await setPlaying(!playing); } catch (error) {
    if (version !== loadVersion) return;
    playing = false; updatePlayControl();
    status.dataset.error = 'true';
    status.textContent = error instanceof DOMException && error.name === 'NotAllowedError'
      ? '브라우저가 재생을 보류했습니다. 재생 버튼을 다시 눌러주세요.'
      : `재생에 실패했습니다. 파일의 코덱을 브라우저가 지원하는지 확인하세요. (${error instanceof Error ? error.name : '오디오 오류'})`;
  }
});
reset.addEventListener('click', () => { if (ready) { audio.currentTime = 0; clearAnalysis(); syncFromAudio(0); } });
scrubber.disabled = true;
scrubber.addEventListener('input', () => { if (ready) { audio.currentTime = Number(scrubber.value); clearAnalysis(); syncFromAudio(0); status.textContent = `${selectedName} · ${playing ? '재생 중' : '일시정지 · 위치 이동'}`; } });
audio.addEventListener('ended', () => { playing = false; updatePlayControl(); status.textContent = `${selectedName} · 재생 완료`; clearAnalysis(); syncFromAudio(0); });
audio.addEventListener('canplay', () => {
  if (ready || !objectUrl || audio.src !== objectUrl) return;
  currentDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
  if (!currentDuration) { fail('오디오 길이를 읽을 수 없습니다. 다른 파일을 선택하세요.'); return; }
  mediaReady = true; clearTimeout(loadTimeout);
  status.textContent = `${selectedName} · 소리의 움직임을 분석 중…`;
  enableWhenReady();
});
audio.addEventListener('error', () => {
  if (!objectUrl || !audio.error) return;
  fail(`${selectedName} · ${audio.error.code === 4 ? '이 브라우저가 파일 형식 또는 코덱을 지원하지 않습니다.' : '오디오 데이터를 읽거나 디코딩하지 못했습니다.'} MP3 또는 PCM WAV로 변환한 파일을 시도하세요.`);
});
document.querySelector<HTMLInputElement>('#drum-file')!.addEventListener('change', event => {
  drumFile=(event.target as HTMLInputElement).files?.[0];applyStems.disabled=!(drumFile&&otherFile);
});
document.querySelector<HTMLInputElement>('#other-file')!.addEventListener('change', event => {
  otherFile=(event.target as HTMLInputElement).files?.[0];applyStems.disabled=!(drumFile&&otherFile);
});
let modeDialogOpen = false;
window.addEventListener('tototo:tile-mode-open', () => { modeDialogOpen = true; });
window.addEventListener('tototo:tile-mode-close', () => { modeDialogOpen = false; });
applyStems.addEventListener('click',()=>{if(drumFile&&otherFile)window.dispatchEvent(new CustomEvent('tototo:tile-mode-open'));});
document.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('#choose-live, #choose-preload, #cancel-tile-mode');
  if (!target) return;
  if (target.id === 'cancel-tile-mode') { window.dispatchEvent(new CustomEvent('tototo:tile-mode-close')); return; }
  window.dispatchEvent(new CustomEvent('tototo:tile-mode-close'));
  if (drumFile && otherFile) void loadFile(drumFile, otherFile, target.id === 'choose-preload' ? 'preload' : 'live');
});
monitor.addEventListener('change',()=>{
  if(!ready||!stemUrls)return;
  const url=stemUrls[monitor.value as keyof typeof stemUrls],time=audio.currentTime,resume=playing,version=loadVersion;
  audio.pause();playing=false;monitor.disabled=true;toggle.disabled=true;
  audio.addEventListener('loadedmetadata',()=>{
    if(version!==loadVersion||audio.src!==url)return;
    audio.currentTime=Math.min(time,audio.duration);monitor.disabled=false;toggle.disabled=false;
    syncFromAudio();void setPlaying(resume).catch(()=>fail('스템 재생에 실패했습니다. 파일을 다시 선택하세요.'));
  },{once:true});
  audio.src=url;audio.load();
});
document.querySelector('#demo')!.addEventListener('click', () => { status.textContent = '진단 사운드를 생성하고 있습니다…'; void loadFile(testSound()); });
document.querySelector('#rhythm')!.addEventListener('click', () => { status.textContent = '리듬 진단 사운드를 생성하고 있습니다…'; void loadFile(testSound(true)); });
document.addEventListener('keydown', event => {
  if(modeDialogOpen)return;
  if (event.target instanceof Element && event.target.closest('[role="slider"], [role="tab"], summary, a, [contenteditable="true"]')) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement || event.target instanceof HTMLSelectElement) return;
  if (event.key === ' ') { event.preventDefault(); toggle.click(); }
  if (ready && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    event.preventDefault(); audio.currentTime = clamp(audio.currentTime + (event.key === 'ArrowLeft' ? -2.5 : 2.5), 0, currentDuration);
    clearAnalysis(); syncFromAudio(0);
  }
});

draw(0, 1 / 60);
requestAnimationFrame(animationFrame);
