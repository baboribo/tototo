import { muxMp4, type EncodedSample } from './mp4';
import {
  copyDescription,
  type EncodedChunk,
  type ChunkMetadata,
  type ExportGlobals,
} from './webcodecs';
export type ExportContext = {
  canvas: HTMLCanvasElement;
  audio: HTMLAudioElement;
  audioContext: AudioContext;
  recordDestination: MediaStreamAudioDestinationNode;
  objectUrl: string;
  currentDuration: number;
  fps: number;
  draw: (time: number) => void;
  abort: AbortSignal;
  setExportProgress: (message: string, value: number, format?: string) => void;
};
export async function renderVideo(context: ExportContext): Promise<{ blob: Blob; mime: string }> {
  const {
    canvas,
    audio,
    audioContext,
    recordDestination,
    objectUrl,
    currentDuration,
    fps,
    draw,
    abort,
    setExportProgress,
  } = context;
  async function hasSeekableMp4(blob: Blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder('latin1').decode(bytes);
    const moov = text.indexOf('moov');
    const mvhd = text.indexOf('mvhd', Math.max(0, moov));
    if (moov < 4 || mvhd < 0 || mvhd + 24 > bytes.length) return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = bytes[mvhd + 4];
    if (version === 1 && mvhd + 40 <= bytes.length)
      return view.getUint32(mvhd + 28) > 0 && view.getBigUint64(mvhd + 32) > 0n;
    return view.getUint32(mvhd + 16) > 0 && view.getUint32(mvhd + 20) > 0;
  }

  async function fastMp4Export(): Promise<Blob | undefined> {
    const globals = window as unknown as ExportGlobals;
    if (
      !globals.VideoEncoder ||
      !globals.AudioEncoder ||
      !globals.VideoFrame ||
      !globals.AudioData ||
      !objectUrl
    )
      return undefined;
    const decoded = await audioContext!.decodeAudioData(
      await (await fetch(objectUrl)).arrayBuffer(),
    );
    const rate = Math.max(10, fps);
    const frameDuration = 1 / rate;
    const videoSamples: (EncodedSample & { timestamp: number })[] = [];
    const audioSamples: (EncodedSample & { timestamp: number })[] = [];
    let avcDescription = new Uint8Array();
    let aacDescription = new Uint8Array();
    let videoError: Error | undefined;
    let audioError: Error | undefined;
    const videoEncoder = new globals.VideoEncoder({
      output: (chunk: EncodedChunk, metadata?: ChunkMetadata) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        const description = metadata?.decoderConfig?.description;
        if (description) avcDescription = copyDescription(description);
        videoSamples.push({
          data,
          duration: Math.round(frameDuration * 90000),
          timestamp: chunk.timestamp ?? 0,
          key: chunk.type === 'key',
        });
      },
      error: (error: Error) => {
        videoError = error;
      },
    });
    let audioEncoder: InstanceType<NonNullable<ExportGlobals['AudioEncoder']>> | undefined;
    const closeEncoders = () => {
      try {
        videoEncoder.close();
      } catch {
        /* Already closed by the codec after an error. */
      }
      try {
        audioEncoder?.close();
      } catch {
        /* Already closed by the codec after an error. */
      }
    };
    abort.addEventListener('abort', closeEncoders, { once: true });
    try {
      audioEncoder = new globals.AudioEncoder({
        output: (chunk: EncodedChunk, metadata?: ChunkMetadata) => {
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          const description = metadata?.decoderConfig?.description;
          if (description) aacDescription = copyDescription(description);
          // EncodedAudioChunk.duration is expressed in microseconds; the MP4
          // audio track uses sample-rate ticks instead.
          audioSamples.push({
            data,
            duration: chunk.duration
              ? Math.max(1, Math.round((chunk.duration * decoded.sampleRate) / 1e6))
              : 1024,
            timestamp: chunk.timestamp ?? 0,
          });
        },
        error: (error: Error) => {
          audioError = error;
        },
      });
      const videoConfig = {
        codec: 'avc1.42001f',
        width: canvas.width,
        height: canvas.height,
        bitrate: 8_000_000,
        framerate: rate,
        avc: { format: 'avc' },
      };
      const audioConfig = {
        codec: 'mp4a.40.2',
        sampleRate: decoded.sampleRate,
        numberOfChannels: decoded.numberOfChannels,
        bitrate: 192_000,
      };
      if (
        !(await globals.VideoEncoder.isConfigSupported(videoConfig)).supported ||
        !(await globals.AudioEncoder.isConfigSupported(audioConfig)).supported
      )
        return undefined;
      videoEncoder.configure(videoConfig);
      audioEncoder.configure(audioConfig);
      const frameCount = Math.ceil(currentDuration * rate);
      for (let index = 0; index < frameCount; index++) {
        if (abort.aborted) throw new Error('내보내기가 취소되었습니다.');
        const time = Math.min(index / rate, Math.max(0, currentDuration - frameDuration));
        draw(time);
        const frame = new globals.VideoFrame(canvas, {
          timestamp: Math.round(time * 1e6),
          duration: Math.round(frameDuration * 1e6),
        });
        try {
          videoEncoder.encode(frame, {
            keyFrame: index === 0 || index % Math.max(1, Math.round(rate * 2)) === 0,
          });
        } finally {
          frame.close();
        }
        if (videoEncoder.encodeQueueSize > 12) await videoEncoder.flush();
        if (index % Math.max(1, Math.floor(rate / 4)) === 0) {
          setExportProgress(
            '화면을 빠르게 프레임 단위로 렌더링하고 있습니다…',
            (index / frameCount) * 72,
          );
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      await videoEncoder.flush();
      const chunkSize = 2048;
      const channels = decoded.numberOfChannels;
      for (let offset = 0; offset < decoded.length; offset += chunkSize) {
        if (abort.aborted) throw new Error('내보내기가 취소되었습니다.');
        const count = Math.min(chunkSize, decoded.length - offset);
        const interleaved = new Float32Array(count * channels);
        for (let frame = 0; frame < count; frame++)
          for (let channel = 0; channel < channels; channel++)
            interleaved[frame * channels + channel] =
              decoded.getChannelData(channel)[offset + frame];
        const audioData = new globals.AudioData({
          format: 'f32',
          sampleRate: decoded.sampleRate,
          numberOfFrames: count,
          numberOfChannels: channels,
          timestamp: Math.round((offset / decoded.sampleRate) * 1e6),
          data: interleaved,
        });
        try {
          audioEncoder.encode(audioData);
        } finally {
          audioData.close();
        }
        if (audioEncoder.encodeQueueSize > 12) await audioEncoder.flush();
        if (offset % (chunkSize * 16) === 0)
          setExportProgress(
            '오디오를 빠르게 인코딩하고 있습니다…',
            72 + (offset / decoded.length) * 20,
          );
      }
      await audioEncoder.flush();
      if (
        videoError ||
        audioError ||
        !videoSamples.length ||
        !audioSamples.length ||
        !avcDescription.length
      )
        return undefined;
      videoSamples.sort((a, b) => a.timestamp - b.timestamp);
      audioSamples.sort((a, b) => a.timestamp - b.timestamp);
      setExportProgress('MP4 인덱스와 오디오 트랙을 묶고 있습니다…', 96);
      return muxMp4(
        {
          kind: 'video',
          samples: videoSamples,
          timescale: 90000,
          description: avcDescription,
          width: canvas.width,
          height: canvas.height,
        },
        {
          kind: 'audio',
          samples: audioSamples,
          timescale: decoded.sampleRate,
          description: aacDescription,
          channels: decoded.numberOfChannels,
          sampleRate: decoded.sampleRate,
        },
      );
    } finally {
      abort.removeEventListener('abort', closeEncoders);
      closeEncoders();
    }
  }
  async function fastExport(mime: string): Promise<Blob | undefined> {
    const globals = window as unknown as ExportGlobals;
    if (
      !globals.MediaStreamTrackGenerator ||
      !globals.VideoFrame ||
      !globals.AudioData ||
      !objectUrl
    )
      return undefined;
    const videoTrack = new globals.MediaStreamTrackGenerator({ kind: 'video' });
    try {
      const audioTrack = new globals.MediaStreamTrackGenerator({ kind: 'audio' });
      try {
        const videoWriter = videoTrack.writable.getWriter();
        const audioWriter = audioTrack.writable.getWriter();
        const failed = new AbortController();
        const taskSignal = AbortSignal.any([abort, failed.signal]);
        const stopWriters = () => {
          videoTrack.stop();
          audioTrack.stop();
          void videoWriter.abort(taskSignal.reason).catch(() => {});
          void audioWriter.abort(taskSignal.reason).catch(() => {});
        };
        taskSignal.addEventListener('abort', stopWriters, { once: true });
        try {
          const stream = new MediaStream([videoTrack, audioTrack]);
          const recorder = new MediaRecorder(stream, {
            mimeType: mime,
            videoBitsPerSecond: 8_000_000,
            audioBitsPerSecond: 192_000,
          });
          const chunks: Blob[] = [];
          recorder.ondataavailable = (event) => {
            if (event.data.size) chunks.push(event.data);
          };
          const stopped = new Promise<Blob>((resolve, reject) => {
            recorder.onerror = () => reject(new Error('빠른 인코딩 중 오류가 발생했습니다.'));
            recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
          });
          // Keep one final container chunk so its duration and seek index are closed.
          void stopped.catch(() => {});
          let started = false;
          try {
            recorder.start();
            started = true;
            const decoded = await audioContext!.decodeAudioData(
              await (await fetch(objectUrl)).arrayBuffer(),
            );
            const rate = Math.max(10, fps);
            const frameCount = Math.ceil(currentDuration * rate);
            const renderVideo = async () => {
              for (let index = 0; index < frameCount; index++) {
                taskSignal.throwIfAborted();
                const time = Math.min(index / rate, Math.max(0, currentDuration - 1 / rate));
                draw(time);
                const frame = new globals.VideoFrame!(canvas, {
                  timestamp: Math.round(time * 1e6),
                  duration: Math.round(1e6 / rate),
                });
                try {
                  await videoWriter.write(frame);
                } finally {
                  frame.close();
                }
                if (index % Math.max(1, Math.floor(rate / 4)) === 0)
                  setExportProgress(
                    '화면 프레임을 빠르게 렌더링하고 있습니다…',
                    (index / frameCount) * 78,
                  );
              }
              await videoWriter.close();
            };
            const renderAudio = async () => {
              const chunkSize = 2048;
              const channels = decoded.numberOfChannels;
              for (let offset = 0; offset < decoded.length; offset += chunkSize) {
                taskSignal.throwIfAborted();
                const count = Math.min(chunkSize, decoded.length - offset);
                const interleaved = new Float32Array(count * channels);
                for (let frame = 0; frame < count; frame++)
                  for (let channel = 0; channel < channels; channel++)
                    interleaved[frame * channels + channel] =
                      decoded.getChannelData(channel)[offset + frame];
                const data = new globals.AudioData!({
                  format: 'f32',
                  sampleRate: decoded.sampleRate,
                  numberOfFrames: count,
                  numberOfChannels: channels,
                  timestamp: Math.round((offset / decoded.sampleRate) * 1e6),
                  data: interleaved,
                });
                try {
                  await audioWriter.write(data);
                } finally {
                  data.close();
                }
              }
              await audioWriter.close();
            };
            const tasks = [renderVideo(), renderAudio()].map((task) =>
              task.catch((error) => {
                failed.abort(error);
                throw error;
              }),
            );
            const results = await Promise.allSettled(tasks);
            const failure = results.find((result) => result.status === 'rejected');
            if (failure?.status === 'rejected') throw failure.reason;
            setExportProgress('오디오와 화면을 하나의 파일로 묶고 있습니다…', 94);
            recorder.stop();
            return await stopped;
          } catch (error) {
            if (recorder.state !== 'inactive') recorder.stop();
            try {
              if (started) await stopped;
            } catch {
              /* the original error is more useful */
            }
            throw error;
          }
        } finally {
          taskSignal.removeEventListener('abort', stopWriters);
          videoWriter.releaseLock();
          audioWriter.releaseLock();
        }
      } finally {
        audioTrack.stop();
      }
    } finally {
      videoTrack.stop();
    }
  }

  async function realtimeExport(mime: string): Promise<Blob> {
    abort.throwIfAborted();
    const canvasStream = canvas.captureStream(Math.max(30, fps));
    let recorder: MediaRecorder | undefined;
    let progressTimer: ReturnType<typeof setInterval> | undefined;
    const listeners = new AbortController();
    try {
      const stream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...recordDestination.stream.getAudioTracks(),
      ]);
      const active = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 8_000_000,
        audioBitsPerSecond: 192_000,
      });
      recorder = active;
      const chunks: Blob[] = [];
      const blob = await new Promise<Blob>((resolve, reject) => {
        active.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data);
        };
        active.onerror = () => reject(new Error('녹화 중 오류가 발생했습니다.'));
        active.onstop = () => resolve(new Blob(chunks, { type: mime }));
        const stop = () => {
          if (active.state !== 'inactive') active.stop();
        };
        abort.addEventListener(
          'abort',
          () => {
            audio.pause();
            stop();
            reject(abort.reason);
          },
          { once: true, signal: listeners.signal },
        );
        audio.addEventListener('ended', stop, { once: true, signal: listeners.signal });
        audio.addEventListener(
          'error',
          () => reject(new Error('내보내기 중 오디오를 재생하지 못했습니다.')),
          { once: true, signal: listeners.signal },
        );
        audio.currentTime = 0;
        audio.playbackRate = 1;
        draw(0);
        active.start();
        progressTimer = setInterval(
          () =>
            setExportProgress(
              '호환 모드로 화면과 소리를 녹화하고 있습니다…',
              Math.min(99, (audio.currentTime / currentDuration) * 100),
            ),
          200,
        );
        void audioContext
          .resume()
          .then(() => {
            abort.throwIfAborted();
            return audio.play();
          })
          .catch(reject);
      });
      abort.throwIfAborted();
      return blob;
    } finally {
      listeners.abort();
      clearInterval(progressTimer);
      audio.pause();
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      canvasStream.getTracks().forEach((track) => track.stop());
    }
  }

  const mime = [
    'video/mp4',
    'video/mp4;codecs=h264,aac',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mime) throw new Error('이 브라우저에서는 동영상 내보내기를 지원하지 않습니다.');
  setExportProgress(
    '빠른 렌더링을 준비하고 있습니다…',
    0,
    mime.startsWith('video/mp4') ? 'MP4' : 'WebM',
  );
  let blob: Blob | undefined;
  try {
    blob = mime.startsWith('video/mp4') ? await fastMp4Export() : await fastExport(mime);
  } catch (error) {
    if (abort.aborted) throw error;
    setExportProgress('빠른 렌더링을 지원하지 않아 호환 모드로 전환합니다…', 0);
  }
  abort.throwIfAborted();
  if (!blob) blob = await realtimeExport(mime);
  let outputMime = mime;
  abort.throwIfAborted();
  if (mime.startsWith('video/mp4') && !(await hasSeekableMp4(blob))) {
    const webm = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(
      (type) => MediaRecorder.isTypeSupported(type),
    );
    if (!webm) throw new Error('브라우저가 재생 가능한 MP4 컨테이너를 만들지 못했습니다.');
    setExportProgress('호환 포맷으로 다시 내보내고 있습니다…', 0, 'WebM · 호환 대체');
    audio.pause();
    audio.currentTime = 0;
    blob = await realtimeExport(webm);
    outputMime = webm;
  }
  abort.throwIfAborted();
  return { blob, mime: outputMime };
}
