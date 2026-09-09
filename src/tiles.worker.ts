import { preloadTiles, type MotionOptions } from './motion';
import type { Signal } from './signal';

self.onmessage = (event: MessageEvent<{signal: Signal; gain: number; options: MotionOptions}>) => {
  try {
    const {signal, gain, options} = event.data;
    const track = preloadTiles(signal, gain, options, progress => self.postMessage({progress}));
    self.postMessage({track});
  } catch (error) {
    self.postMessage({error: error instanceof Error ? error.message : '타일 사전 생성 실패'});
  }
};
