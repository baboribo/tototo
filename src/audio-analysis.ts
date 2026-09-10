import { wav } from './separation';
import type { Signal } from './signal';
import type { DrumHit } from './drums';

export type AnalysisResult = {
  signal: Signal;
  otherSignal: Signal;
  hits: DrumHit[];
  drums: Float32Array;
  rest: Float32Array;
  sampleRate: number;
};
export type AnalysisRequest = {
  samples: Float32Array;
  restSamples?: Float32Array;
  sampleRate: number;
};
export type AnalysisMessage = { progress: string } | { error: string } | AnalysisResult;

// Pick the stronger channel rather than summing anti-phase stereo into silence.
function strongestChannel(buffer: AudioBuffer) {
  let best = 0,
    maximum = -1;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    let power = 0;
    for (let index = 0; index < data.length; index += 32) power += data[index] * data[index];
    if (power > maximum) {
      maximum = power;
      best = channel;
    }
  }
  return buffer.getChannelData(best).slice();
}
export async function analyseAudio(
  file: File,
  restFile: File | undefined,
  context: AudioContext,
  abort: AbortSignal,
  onMix: (mix: Blob) => void,
  onProgress: (message: string) => void,
): Promise<AnalysisResult> {
  abort.throwIfAborted();
  const decoded = await context.decodeAudioData(await file.arrayBuffer());
  abort.throwIfAborted();
  const samples = strongestChannel(decoded);
  let restSamples: Float32Array<ArrayBuffer> | undefined;
  if (restFile) {
    const rest = await context.decodeAudioData(await restFile.arrayBuffer());
    abort.throwIfAborted();
    restSamples = strongestChannel(rest);
    const length = Math.max(decoded.length, rest.length),
      channels: Float32Array[] = [];
    for (
      let channel = 0;
      channel < Math.max(decoded.numberOfChannels, rest.numberOfChannels);
      channel++
    ) {
      const a = decoded.getChannelData(Math.min(channel, decoded.numberOfChannels - 1));
      const b = rest.getChannelData(Math.min(channel, rest.numberOfChannels - 1));
      channels.push(
        Float32Array.from({ length }, (_, index) => ((a[index] ?? 0) + (b[index] ?? 0)) * 0.5),
      );
    }
    onMix(wav(channels, decoded.sampleRate));
  }
  abort.throwIfAborted();
  const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
  let cancel = () => {};
  try {
    return await new Promise<AnalysisResult>((resolve, reject) => {
      cancel = () => reject(abort.reason);
      abort.addEventListener('abort', cancel, { once: true });
      worker.onmessage = ({ data }: MessageEvent<AnalysisMessage>) => {
        if ('progress' in data) onProgress(data.progress);
        else if ('error' in data) reject(new Error(data.error));
        else resolve(data);
      };
      worker.onerror = () => reject(new Error('오디오 분석을 완료하지 못했습니다.'));
      const request: AnalysisRequest = { samples, restSamples, sampleRate: decoded.sampleRate };
      worker.postMessage(
        request,
        restSamples ? [samples.buffer, restSamples.buffer] : [samples.buffer],
      );
    });
  } finally {
    abort.removeEventListener('abort', cancel);
    worker.terminate();
  }
}
