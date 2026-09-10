import { analyseAudio } from './audio-analysis';
import { identifyAudio, testSound } from './audio-file';
import { at, type Signal } from './signal';
import { MotionRenderer, frameTime, type PreloadedTiles } from './motion';
import { beatPulse, type Tempo } from './tempo';
import { recentHits, type DrumHit } from './drums';
import { wav } from './separation';
import { DrumController } from './drum-controller';
import { renderVideo } from './video-export';
import type { AppStore, Settings, TileMode, Monitor } from './app-state';

export type EngineElements = {
  canvas: HTMLCanvasElement;
  audio: HTMLAudioElement;
  spectrum: HTMLCanvasElement;
  levels: HTMLCanvasElement;
};
export type Engine = ReturnType<typeof createEngine>;
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

// Each mounted workspace owns one engine. Importing this module has no side effects.
export function createEngine({ canvas, audio, spectrum, levels }: EngineElements, store: AppStore) {
  const events = new AbortController();
  const renderer = new MotionRenderer(canvas);
  const settings = () => store.getSnapshot().settings;
  let disposed = false,
    animation = 0;
  let loadVersion = 0,
    tilesVersion = 0;
  let ready = false,
    playing = false,
    mediaReady = false,
    loadFailed = false;
  let selectedName = '',
    currentDuration = 0,
    lastRendered = -1;
  let audioContext: AudioContext | undefined;
  let audioSource: MediaElementAudioSourceNode | undefined;
  let recordDestination: MediaStreamAudioDestinationNode | undefined;
  let objectUrl: string | undefined;
  let auxiliaryUrls: string[] = [];
  let stemUrls: Record<Monitor, string> | undefined;
  let signal: Signal | undefined, otherSignal: Signal | undefined;
  let hits: DrumHit[] = [];
  let analysisAbort: AbortController | undefined;
  let tilesWorker: Worker | undefined;
  let loadTimeout: ReturnType<typeof setTimeout> | undefined,
    tilesTimer: ReturnType<typeof setTimeout> | undefined;
  let tileMode: TileMode = 'live',
    preloadedTiles: PreloadedTiles | undefined,
    resumeAfterTiles = false;
  let exporting = false,
    exportAbort: AbortController | undefined;
  let monitorEvents: AbortController | undefined;
  const drumController = new DrumController(
    audio,
    [spectrum, levels],
    (drum) => store.update({ drum }),
    (next) => {
      hits = next;
      if (tileMode === 'preload') rebuildTiles();
      else syncFromAudio();
    },
  );
  const setStatus = (status: string, error = false) => {
    if (!disposed) store.update({ status, error });
  };
  const updatePlayControl = () => store.update({ playing });
  const clearAnalysis = () => {
    lastRendered = -1;
  };

  function effectiveTempo(): Tempo | null {
    const { bpm, tempoScale, beatOffset } = settings();
    const manual = Number(bpm),
      detected = signal?.tempo;
    const valid = manual >= 40 && manual <= 240;
    if (!valid && !detected) return null;
    return {
      bpm: (valid ? manual : detected!.bpm) * tempoScale,
      offset: (detected?.offset ?? 0) + clamp(beatOffset, -500, 500) / 1000,
      confidence: valid ? 1 : detected!.confidence,
    };
  }
  function updateTempoUI() {
    const tempo = effectiveTempo();
    store.update({
      tempoReadout: tempo ? `${Number(tempo.bpm.toFixed(2))} BPM` : 'BPM —',
      tempoDetail: tempo
        ? settings().bpm
          ? '직접 보정'
          : `자동 추정 · 신뢰도 ${Math.round(tempo.confidence * 100)}%`
        : signal
          ? '일정한 박자를 찾지 못해 소리의 어택에 반응합니다'
          : '오디오를 넣으면 박자를 자동으로 찾습니다',
    });
  }
  function draw(time: number) {
    if (disposed) return;
    const config = settings(),
      tempo = effectiveTempo(),
      feature = at(signal, time);
    renderer.render(signal, time, config.sensitivity, config.caption, {
      ...config,
      tempo,
      hits,
      otherSignal,
      preloadedTiles,
    });
    lastRendered = frameTime(time, config.fps);
    store.update({
      time,
      meter: `LOW ${Math.round(feature.bands[0] * 100)} · MID ${Math.round(feature.bands[2] * 100)} · HIGH ${Math.round(feature.bands[3] * 100)}`,
      drumReadout:
        recentHits(hits, lastRendered)
          .map((hit) => hit.kind.toUpperCase())
          .filter((value, index, all) => all.indexOf(value) === index)
          .join(' · ') || '—',
      beatActive:
        feature.level > 0.045 &&
        beatPulse(tempo, lastRendered, Math.max(1 / config.fps, 0.09)).pulse > 0,
    });
  }
  function syncFromAudio() {
    const time = audio.src ? audio.currentTime : 0;
    draw(time);
    drumController.draw(time);
  }
  function animationFrame() {
    if (disposed) return;
    if (playing && frameTime(audio.currentTime, settings().fps) !== lastRendered) syncFromAudio();
    animation = requestAnimationFrame(animationFrame);
  }
  async function ensureAudioGraph() {
    if (disposed) throw new Error('작업 공간이 닫혔습니다.');
    audioContext ??= new AudioContext();
    if (!audioSource) {
      audioSource = audioContext.createMediaElementSource(audio);
      recordDestination = audioContext.createMediaStreamDestination();
      audioSource.connect(audioContext.destination);
      audioSource.connect(recordDestination);
    }
  }
  function enableWhenReady() {
    if (
      disposed ||
      !mediaReady ||
      !signal ||
      loadFailed ||
      (tileMode === 'preload' && !preloadedTiles)
    )
      return;
    ready = true;
    store.update({ ready, duration: currentDuration });
    setStatus(`${selectedName} · ${currentDuration.toFixed(1)}초 · 준비됨. 재생을 눌러주세요.`);
    syncFromAudio();
    if (resumeAfterTiles) {
      resumeAfterTiles = false;
      void setPlaying(true).catch(() => fail('재생을 다시 시작하지 못했습니다.'));
    }
  }
  function rebuildTiles() {
    if (disposed || tileMode !== 'preload' || !signal || loadFailed) return;
    clearTimeout(tilesTimer);
    tilesWorker?.terminate();
    tilesWorker = undefined;
    const generation = ++tilesVersion,
      version = loadVersion;
    preloadedTiles = undefined;
    resumeAfterTiles ||= playing;
    audio.pause();
    playing = ready = false;
    store.update({ ready, playing, tileModeReadout: '사전 생성 · 준비 중…' });
    setStatus(`${selectedName} · 곡 전체 타일 사전 생성 준비 중…`);
    tilesTimer = setTimeout(() => {
      const compiler = new Worker(new URL('./tiles.worker.ts', import.meta.url), {
        type: 'module',
      });
      tilesWorker = compiler;
      compiler.onmessage = (
        event: MessageEvent<{ progress?: number; track?: PreloadedTiles; error?: string }>,
      ) => {
        if (disposed || version !== loadVersion || generation !== tilesVersion || loadFailed)
          return;
        if (event.data.progress !== undefined) {
          setStatus(`${selectedName} · 곡 전체 타일 사전 생성 ${event.data.progress}%`);
          return;
        }
        compiler.terminate();
        tilesWorker = undefined;
        if (!event.data.track) {
          fail(event.data.error ?? '타일 사전 생성에 실패했습니다. 다시 불러오세요.');
          return;
        }
        preloadedTiles = event.data.track;
        store.update({
          tileModeReadout: `사전 생성 · ${preloadedTiles.tileCount.toLocaleString()}개 타일 · ${preloadedTiles.duration.toFixed(1)}초 준비 완료`,
        });
        enableWhenReady();
      };
      compiler.onerror = () => {
        if (version === loadVersion && generation === tilesVersion)
          fail('타일 사전 생성에 실패했습니다. 다시 불러오세요.');
      };
      compiler.postMessage({
        signal,
        gain: settings().sensitivity,
        options: { ...settings(), tempo: effectiveTempo(), hits, otherSignal },
      });
    }, 150);
  }
  function setSettings(patch: Partial<Settings>) {
    if (disposed || exporting) return;
    store.update({ settings: { ...settings(), ...patch } });
    updateTempoUI();
    if (
      tileMode === 'preload' &&
      Object.keys(patch).some((key) => key !== 'caption' && key !== 'perimeterSource')
    )
      rebuildTiles();
    else syncFromAudio();
  }
  async function setPlaying(next: boolean) {
    if (disposed || !ready) return;
    const version = loadVersion;
    await ensureAudioGraph();
    if (next) {
      await audioContext!.resume();
      if (version !== loadVersion || disposed) return;
      await audio.play();
    } else audio.pause();
    if (version !== loadVersion || disposed) return;
    playing = next;
    updatePlayControl();
    setStatus(`${selectedName} · ${playing ? '재생 중' : '일시정지'}`);
  }
  async function togglePlaying() {
    if (exporting || store.getSnapshot().switchingMonitor) return;
    const version = loadVersion;
    try {
      await setPlaying(!playing);
    } catch (error) {
      if (version === loadVersion && !disposed) {
        playing = false;
        updatePlayControl();
        setStatus(error instanceof Error ? error.message : '재생에 실패했습니다.', true);
      }
    }
  }
  function seek(time: number) {
    if (!ready || exporting || store.getSnapshot().switchingMonitor) return;
    audio.currentTime = clamp(time, 0, currentDuration);
    clearAnalysis();
    syncFromAudio();
  }
  function fail(message: string) {
    if (disposed) return;
    clearTimeout(tilesTimer);
    tilesWorker?.terminate();
    tilesWorker = undefined;
    tilesVersion++;
    resumeAfterTiles = false;
    loadFailed = true;
    clearTimeout(loadTimeout);
    analysisAbort?.abort();
    analysisAbort = undefined;
    monitorEvents?.abort();
    playing = ready = false;
    audio.pause();
    store.update({ playing, ready, switchingMonitor: false });
    setStatus(message, true);
  }

  async function analyseFile(file: File, version: number, restFile?: File) {
    const controller = new AbortController();
    analysisAbort = controller;
    await ensureAudioGraph();
    const data = await analyseAudio(
      file,
      restFile,
      audioContext!,
      controller.signal,
      (mix) => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(mix);
        mediaReady = false;
        audio.src = objectUrl;
        audio.load();
      },
      (message) => setStatus(selectedName + ' · ' + message),
    );
    if (disposed || version !== loadVersion || loadFailed) return;
    signal = data.signal;
    otherSignal = data.otherSignal;
    hits = data.hits;
    drumController.load(signal, data.drums, data.sampleRate, audioContext!);
    const length = Math.max(data.drums.length, data.rest.length);
    const pad = (samples: Float32Array) => {
      if (samples.length === length) return samples;
      const padded = new Float32Array(length);
      padded.set(samples);
      return padded;
    };
    const drums = URL.createObjectURL(wav([pad(data.drums)], data.sampleRate)),
      other = URL.createObjectURL(wav([pad(data.rest)], data.sampleRate));
    auxiliaryUrls.push(drums, other);
    stemUrls = { mix: objectUrl!, drums, other };
    const originalDrums = restFile ? URL.createObjectURL(file) : drums,
      originalOther = restFile ? URL.createObjectURL(restFile) : other;
    if (restFile) auxiliaryUrls.push(originalDrums, originalOther);
    store.update({
      downloads: {
        drums: { url: originalDrums, name: restFile ? file.name : 'percussion-approx-mono.wav' },
        other: { url: originalOther, name: restFile ? restFile.name : 'rest-approx-mono.wav' },
      },
    });
    updateTempoUI();
    enableWhenReady();
  }
  async function loadFile(file: File, restFile?: File, mode: 'live' | 'preload' = 'live') {
    if (disposed || exporting) return;
    clearTimeout(tilesTimer);
    tilesWorker?.terminate();
    tilesWorker = undefined;
    tilesVersion++;
    preloadedTiles = undefined;
    tileMode = mode;
    resumeAfterTiles = false;
    store.update({
      tileModeReadout:
        mode === 'preload' ? '사전 생성 · 오디오 분석 대기' : '즉흥 생성 · 현재 방식',
    });
    drumController.clear();
    const version = ++loadVersion;
    loadFailed = false;
    clearTimeout(loadTimeout);
    analysisAbort?.abort();
    analysisAbort = undefined;
    signal = undefined;
    mediaReady = false;
    otherSignal = undefined;
    hits = [];
    stemUrls = undefined;
    store.update({ monitor: 'mix', switchingMonitor: false, downloads: null });
    auxiliaryUrls.forEach((url) => URL.revokeObjectURL(url));
    auxiliaryUrls = [];
    store.update({
      stemMode: restFile
        ? '직접 입력한 드럼 / 나머지 스템 · 전체 재생은 6dB 여유를 두고 합칩니다. 스템 단독 듣기는 분석용 모노이며 저장은 입력 원본입니다.'
        : '자동 근사 분리 (HPSS) · 타악 성분을 추출한 모노 스템입니다. 보컬·피아노 어택이 섞이거나 일부 드럼이 남을 수 있습니다.',
    });
    store.update({ settings: { ...settings(), bpm: '', tempoScale: 1, beatOffset: 0 } });
    updateTempoUI();
    playing = ready = false;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = undefined;
    }
    updatePlayControl();
    store.update({ ready: false });
    currentDuration = 0;
    store.update({ duration: 0, time: 0 });
    selectedName = restFile ? `${file.name} + ${restFile.name}` : file.name;
    store.update({ source: selectedName });
    setStatus(`${file.name} · 파일 확인 중…`);
    clearAnalysis();
    draw(0);
    try {
      if (!file.size) throw new Error('빈 파일입니다. 오디오 데이터가 있는 파일을 선택하세요.');
      const detected = await identifyAudio(file);
      if (version !== loadVersion) return;
      if (!detected && !file.type.startsWith('audio/'))
        throw new Error(
          '오디오 형식을 확인할 수 없습니다. MP3, WAV, FLAC, OGG 또는 M4A 파일을 선택하세요.',
        );
      const blob = detected && detected !== file.type ? new Blob([file], { type: detected }) : file;
      objectUrl = URL.createObjectURL(blob);
      audio.src = objectUrl;
      setStatus(`${file.name} · 오디오 로딩 중…`);
      audio.load();
      void analyseFile(
        blob instanceof File ? blob : new File([blob], file.name, { type: blob.type }),
        version,
        restFile,
      ).catch((error) => {
        if (version === loadVersion)
          fail(
            `오디오 분석에 실패했습니다. 브라우저가 디코딩할 수 있는 MP3 또는 PCM WAV로 시도하세요. (${error instanceof Error ? error.name : '오류'})`,
          );
      });
      loadTimeout = setTimeout(() => {
        if (version === loadVersion && !mediaReady)
          fail(
            '오디오 로딩 시간이 초과되었습니다. 파일을 다시 선택하거나 다른 형식으로 시도하세요.',
          );
      }, 20000);
    } catch (error) {
      if (version === loadVersion)
        fail(error instanceof Error ? error.message : '파일을 읽지 못했습니다. 다시 선택하세요.');
    }
  }

  function switchMonitor(monitor: Monitor) {
    if (!ready || !stemUrls || exporting || disposed) return;
    monitorEvents?.abort();
    monitorEvents = new AbortController();
    const url = stemUrls[monitor],
      time = audio.currentTime,
      resume = playing,
      version = loadVersion;
    audio.pause();
    playing = false;
    store.update({ monitor, playing, switchingMonitor: true });
    audio.addEventListener(
      'loadedmetadata',
      () => {
        if (version !== loadVersion || disposed || audio.src !== url) return;
        audio.currentTime = Math.min(time, audio.duration);
        store.update({ switchingMonitor: false });
        syncFromAudio();
        void setPlaying(resume).catch(() =>
          fail('스템 재생에 실패했습니다. 파일을 다시 선택하세요.'),
        );
      },
      { once: true, signal: monitorEvents.signal },
    );
    audio.src = url;
    audio.load();
  }
  function progress(message: string, value: number, format?: string) {
    if (disposed) return;
    store.update({
      export: {
        ...store.getSnapshot().export,
        message,
        value: clamp(Math.round(value), 0, 100),
        ...(format ? { format } : {}),
      },
    });
  }
  function cancelExport() {
    exportAbort?.abort(new Error('내보내기가 취소되었습니다.'));
  }
  function closeExport() {
    if (exporting) cancelExport();
    else store.update({ export: { ...store.getSnapshot().export, open: false } });
  }
  async function exportVideo() {
    if (disposed || !ready || exporting || !signal || store.getSnapshot().switchingMonitor) return;
    // Acquire the lock before any await; settings and source remain fixed for this export.
    exporting = true;
    exportAbort = new AbortController();
    const abort = exportAbort.signal,
      originalTime = audio.currentTime,
      originalPlaybackRate = audio.playbackRate,
      originalPlaying = playing;
    const originalSolo = store.getSnapshot().drum.solo;
    store.update({
      exporting,
      export: {
        open: true,
        message: '렌더링을 준비하고 있습니다…',
        value: 0,
        format: 'MP4 / WebM',
      },
    });
    audio.pause();
    playing = false;
    updatePlayControl();
    if (originalSolo) drumController.toggleSolo();
    try {
      await ensureAudioGraph();
      abort.throwIfAborted();
      if (!('MediaRecorder' in window))
        throw new Error('이 브라우저에서는 동영상 내보내기를 지원하지 않습니다.');
      const result = await renderVideo({
        canvas,
        audio,
        audioContext: audioContext!,
        recordDestination: recordDestination!,
        objectUrl: objectUrl!,
        currentDuration,
        fps: settings().fps,
        draw,
        abort,
        setExportProgress: progress,
      });
      abort.throwIfAborted();
      const name = (selectedName.split(' + ')[0] || 'tototo')
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9가-힣_-]+/g, '-');
      const format = result.mime.startsWith('video/mp4') ? 'MP4' : 'WebM';
      const url = URL.createObjectURL(result.blob),
        link = document.createElement('a');
      link.href = url;
      link.download = `${name || 'tototo'}-motion.${format.toLowerCase()}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      progress(`${format} 내보내기가 완료되었습니다.`, 100);
      setStatus(`${selectedName} · ${format} 내보내기 완료`);
    } catch (error) {
      if (!disposed) {
        setStatus(
          error instanceof Error ? error.message : '동영상 내보내기에 실패했습니다.',
          !abort.aborted,
        );
        store.update({ export: { ...store.getSnapshot().export, open: false } });
      }
    } finally {
      exporting = false;
      exportAbort = undefined;
      if (!disposed) {
        audio.pause();
        audio.currentTime = Math.min(originalTime, currentDuration);
        audio.playbackRate = originalPlaybackRate;
        playing = false;
        store.update({ exporting, playing });
        clearAnalysis();
        syncFromAudio();
        if (originalSolo) drumController.toggleSolo();
        if (originalPlaying) {
          try {
            await setPlaying(true);
          } catch {
            setStatus('내보내기 후 재생을 다시 시작하지 못했습니다.', true);
          }
        }
      }
    }
  }
  audio.addEventListener(
    'play',
    () => {
      playing = true;
      updatePlayControl();
    },
    { signal: events.signal },
  );
  for (const event of ['pause', 'ended'])
    audio.addEventListener(
      event,
      () => {
        playing = false;
        updatePlayControl();
      },
      { signal: events.signal },
    );
  audio.addEventListener(
    'seeked',
    () => {
      if (!exporting) syncFromAudio();
    },
    { signal: events.signal },
  );
  audio.addEventListener(
    'canplay',
    () => {
      if (ready || loadFailed || !objectUrl || audio.src !== objectUrl) return;
      currentDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
      if (!currentDuration) {
        fail('오디오 길이를 읽을 수 없습니다. 다른 파일을 선택하세요.');
        return;
      }
      mediaReady = true;
      clearTimeout(loadTimeout);
      setStatus(`${selectedName} · 소리의 움직임을 분석 중…`);
      enableWhenReady();
    },
    { signal: events.signal },
  );
  audio.addEventListener(
    'error',
    () => {
      if (objectUrl && audio.error)
        fail(
          `${selectedName} · 오디오 데이터를 읽거나 디코딩하지 못했습니다. MP3 또는 PCM WAV로 변환한 파일을 시도하세요.`,
        );
    },
    { signal: events.signal },
  );
  draw(0);
  drumController.draw(0);
  animation = requestAnimationFrame(animationFrame);
  return {
    setSettings,
    loadFile,
    togglePlaying,
    seek,
    switchMonitor,
    exportVideo,
    cancelExport,
    closeExport,
    drums: drumController,
    loadDemo: (rhythm = false) => loadFile(testSound(rhythm)),
    dispose() {
      if (disposed) return;
      disposed = true;
      loadVersion++;
      tilesVersion++;
      events.abort();
      monitorEvents?.abort();
      cancelExport();
      cancelAnimationFrame(animation);
      clearTimeout(loadTimeout);
      clearTimeout(tilesTimer);
      analysisAbort?.abort();
      tilesWorker?.terminate();
      drumController.dispose();
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audioSource?.disconnect();
      recordDestination?.disconnect();
      recordDestination?.stream.getTracks().forEach((track) => track.stop());
      if (audioContext && audioContext.state !== 'closed') void audioContext.close();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      auxiliaryUrls.forEach((url) => URL.revokeObjectURL(url));
    },
  };
}
