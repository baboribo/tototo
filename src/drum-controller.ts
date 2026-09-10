import { defaults, detectChannels, type Channel } from './drum-eq';
import type { Signal } from './signal';
import type { DrumHit } from './drums';
import type { DrumState } from './app-state';
import { drawDrumGraphs } from './drum-graphs';

export type DrumField = Exclude<keyof Channel, 'kind' | 'enabled'>;
export const drumFields: [DrumField, string, number, number, number][] = [
  ['low', '하한 Hz', 20, 19990, 1],
  ['high', '상한 Hz', 30, 20000, 1],
  ['gain', '분석 게인 dB', -18, 18, 0.5],
  ['threshold', '감지 임계값', 0.02, 1.5, 0.01],
  ['attack', '어택 임계값', 0.005, 0.5, 0.005],
  ['gap', '재타격 간격 ms', 40, 600, 10],
];

export class DrumController {
  private state: DrumState = {
    channels: defaults(),
    selected: 0,
    solo: false,
    loaded: false,
    message: '오디오를 먼저 불러오세요.',
  };
  private signal?: Signal;
  private hits: DrumHit[] = [];
  private levels: Float32Array[] = [];
  private buffer?: AudioBuffer;
  private context?: AudioContext;
  private source?: AudioBufferSourceNode;
  private filters: BiquadFilterNode[] = [];
  private previousMuted = false;
  private timer?: ReturnType<typeof setTimeout>;
  private events = new AbortController();
  private time = 0;
  constructor(
    private audio: HTMLAudioElement,
    private graphs: [HTMLCanvasElement, HTMLCanvasElement],
    private publish: (state: DrumState) => void,
    private changed: (hits: DrumHit[]) => void,
  ) {
    for (const event of ['playing', 'seeked', 'ratechange'])
      audio.addEventListener(event, () => this.restartSolo(), { signal: this.events.signal });
    for (const event of ['pause', 'ended', 'emptied'])
      audio.addEventListener(event, () => this.stopSource(), { signal: this.events.signal });
  }
  private update(patch: Partial<DrumState>) {
    this.state = { ...this.state, ...patch };
    this.publish(this.state);
  }
  select(index: number) {
    if (!this.state.channels[index]) return;
    this.update({ selected: index });
    this.updateFilter();
    this.draw(this.time);
  }
  setEnabled(enabled: boolean) {
    this.changeChannel({ enabled });
  }
  setField(field: DrumField, value: number) {
    if (!Number.isFinite(value)) return;
    const definition = drumFields.find(([key]) => key === field)!;
    const channel = this.state.channels[this.state.selected];
    let next = Math.max(definition[2], Math.min(definition[3], value));
    if (field === 'low') next = Math.min(next, channel.high - 10);
    if (field === 'high') next = Math.max(next, channel.low + 10);
    if (field === 'threshold') next = Math.round(next * 100) / 100;
    this.changeChannel({ [field]: next });
  }
  private changeChannel(patch: Partial<Channel>) {
    this.update({
      channels: this.state.channels.map((channel, index) =>
        index === this.state.selected ? { ...channel, ...patch } : channel,
      ),
    });
    this.schedule();
    this.updateFilter();
    this.draw(this.time);
  }
  reset() {
    this.update({ channels: defaults() });
    this.flush();
    this.updateFilter();
    this.draw(this.time);
  }
  private schedule() {
    clearTimeout(this.timer);
    this.update({ message: '변경된 대역으로 타격을 계산 중…' });
    this.timer = setTimeout(() => this.recalculate(), 150);
  }
  flush() {
    clearTimeout(this.timer);
    this.recalculate();
  }
  private recalculate() {
    if (!this.signal) return;
    const result = detectChannels(this.signal, this.state.channels);
    this.hits = result.hits;
    this.levels = result.levels;
    this.changed(this.hits);
    this.update({
      message: `적용 완료 · ${this.hits.length}개 타격 · 설정은 현재 세션에 유지됩니다`,
    });
    this.draw(this.time);
  }
  load(signal: Signal, samples: Float32Array, rate: number, context: AudioContext) {
    this.clear();
    this.signal = signal;
    this.context = context;
    this.buffer = context.createBuffer(1, samples.length, rate);
    this.buffer.copyToChannel(new Float32Array(samples), 0);
    this.update({ loaded: true });
    this.recalculate();
  }
  clear() {
    clearTimeout(this.timer);
    this.stopSource();
    if (this.state.solo) this.audio.muted = this.previousMuted;
    this.buffer = undefined;
    this.signal = undefined;
    this.hits = [];
    this.levels = [];
    this.update({ solo: false, loaded: false, message: '오디오를 먼저 불러오세요.' });
    this.draw(0);
  }
  toggleSolo() {
    if (!this.buffer) return;
    const solo = !this.state.solo;
    if (solo) this.previousMuted = this.audio.muted;
    else this.audio.muted = this.previousMuted;
    this.update({ solo });
    this.restartSolo();
  }
  private stopSource() {
    this.source?.stop();
    this.source?.disconnect();
    this.source = undefined;
    this.filters.forEach((filter) => filter.disconnect());
    this.filters = [];
  }
  private updateFilter() {
    if (!this.context) return;
    const channel = this.state.channels[this.state.selected];
    this.filters.forEach((filter, index) =>
      filter.frequency.setTargetAtTime(
        Math.min(index ? channel.high : channel.low, this.context!.sampleRate / 2 - 1),
        this.context!.currentTime,
        0.015,
      ),
    );
  }
  private restartSolo() {
    this.stopSource();
    if (!this.state.solo || !this.buffer || !this.context) return;
    this.audio.muted = true;
    if (this.audio.paused || this.audio.currentTime >= this.buffer.duration) return;
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.value = this.audio.playbackRate;
    const hp = this.context.createBiquadFilter(),
      lp = this.context.createBiquadFilter();
    hp.type = 'highpass';
    lp.type = 'lowpass';
    hp.Q.value = lp.Q.value = 0.707;
    this.filters = [hp, lp];
    this.updateFilter();
    source.connect(hp).connect(lp).connect(this.context.destination);
    source.start(0, this.audio.currentTime);
    this.source = source;
  }
  draw(time: number) {
    this.time = time;
    drawDrumGraphs(
      ...this.graphs,
      this.state.channels,
      this.state.selected,
      this.signal,
      this.hits,
      this.levels,
      time,
    );
  }
  dispose() {
    this.events.abort();
    this.clear();
  }
}
