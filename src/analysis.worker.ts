import { analyse } from './signal';
import { separate } from './separation';
import { detectDrums } from './drums';
import type { AnalysisRequest, AnalysisResult } from './audio-analysis';
self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  try {
    self.postMessage({ progress: '드럼과 나머지 소리를 분리·분석 중…' });
    const stems = event.data.restSamples
      ? { drums: event.data.samples, rest: event.data.restSamples }
      : separate(event.data.samples);
    const signal = analyse(stems.drums, event.data.sampleRate, true);
    const otherSignal = analyse(stems.rest, event.data.sampleRate);
    const hits = detectDrums(signal);
    self.postMessage(
      {
        signal,
        otherSignal,
        hits,
        drums: stems.drums,
        rest: stems.rest,
        sampleRate: event.data.sampleRate,
      } satisfies AnalysisResult,
      {
        transfer: [
          signal.values.buffer,
          signal.spectrum!.values.buffer,
          otherSignal.values.buffer,
          stems.drums.buffer,
          stems.rest.buffer,
        ],
      },
    );
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '분석 실패' });
  }
};
