import { useSyncExternalStore } from 'react';
import type { PerimeterSource } from './reactive-ink';
import { defaults, type Channel } from './drum-eq';

export type TileMode = 'live' | 'preload';
export type Monitor = 'mix' | 'drums' | 'other';
export type Settings = {
  sensitivity: number;
  impact: number;
  tileFade: number;
  fps: number;
  bpm: string;
  tempoScale: number;
  beatOffset: number;
  caption: string;
  perimeterSource: PerimeterSource;
};
export type DrumState = {
  channels: Channel[];
  selected: number;
  solo: boolean;
  loaded: boolean;
  message: string;
};
export type AppState = {
  settings: Settings;
  ready: boolean;
  playing: boolean;
  exporting: boolean;
  switchingMonitor: boolean;
  source: string;
  status: string;
  error: boolean;
  time: number;
  duration: number;
  meter: string;
  drumReadout: string;
  beatActive: boolean;
  tempoReadout: string;
  tempoDetail: string;
  monitor: Monitor;
  downloads: { drums: { url: string; name: string }; other: { url: string; name: string } } | null;
  stemMode: string;
  tileModeReadout: string;
  drum: DrumState;
  export: { open: boolean; message: string; value: number; format: string };
};
export function createAppStore() {
  let state: AppState = {
    settings: {
      sensitivity: 1,
      impact: 1.1,
      tileFade: 0.3,
      fps: 10,
      bpm: '',
      tempoScale: 1,
      beatOffset: 0,
      caption: '',
      perimeterSource: 'both',
    },
    ready: false,
    playing: false,
    exporting: false,
    switchingMonitor: false,
    source: '파일 없음',
    status: '드럼과 나머지 스템을 선택하세요.',
    error: false,
    time: 0,
    duration: 0,
    meter: 'LOW 00 · MID 00 · HIGH 00',
    drumReadout: '—',
    beatActive: false,
    tempoReadout: 'BPM —',
    tempoDetail: '파일을 불러오면 자동으로 분석합니다.',
    monitor: 'mix',
    downloads: null,
    stemMode: '드럼과 나머지 파일은 같은 곡에서 같은 시작 시점으로 분리한 스템이어야 합니다.',
    tileModeReadout: '타일 생성 방식은 불러올 때 선택합니다.',
    drum: {
      channels: defaults(),
      selected: 0,
      solo: false,
      loaded: false,
      message: '오디오를 먼저 불러오세요.',
    },
    export: { open: false, message: '렌더링을 준비하고 있습니다…', value: 0, format: 'MP4 / WebM' },
  };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update(patch: Partial<AppState>) {
      state = { ...state, ...patch };
      listeners.forEach((listener) => listener());
    },
  };
}
export type AppStore = ReturnType<typeof createAppStore>;
export function useAppState(store: AppStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
