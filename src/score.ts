export type Tile = 0 | 1 | 2;
export type CueEvent = 'orb' | 'burst' | 'halo' | undefined;

export type Cue = {
  at: number;
  tiles: Tile[];
  frame: number;
  side: 'left' | 'right';
  lyric: string;
  density: number;
  event?: CueEvent;
  observed: boolean;
};

const anchors: Cue[] = [
  { at: 0, tiles: [0,0,2,1, 0,1,0,0, 1,0,0,1, 0,0,1,1], frame: 0, side: 'right', lyric: 'あらたな灯りの', density: .08, observed: true },
  { at: 5, tiles: [1,0,2,2, 0,0,1,0, 2,1,1,0, 0,0,0,2], frame: 1, side: 'right', lyric: 'あらたな灯りの', density: .54, event: 'orb', observed: true },
  { at: 10, tiles: [2,2,0,0, 0,0,1,0, 0,0,1,1, 0,0,1,1], frame: 2, side: 'right', lyric: 'あらたな灯りの', density: .36, observed: true },
  { at: 15, tiles: [1,0,0,0, 0,0,0,2, 1,0,2,0, 0,0,0,0], frame: 0, side: 'right', lyric: 'こぼれた街の', density: .14, observed: true },
  { at: 20, tiles: [0,0,0,1, 0,0,1,2, 0,0,0,0, 2,0,0,0], frame: 1, side: 'left', lyric: '見慣れた灯火', density: .64, event: 'halo', observed: true },
  { at: 25, tiles: [1,0,0,0, 0,0,1,1, 0,1,0,1, 2,0,0,0], frame: 2, side: 'right', lyric: '雨下花々に', density: .48, observed: true },
  { at: 30, tiles: [1,0,0,0, 2,0,0,0, 1,0,0,1, 2,0,0,1], frame: 0, side: 'right', lyric: 'こぼれた街の', density: .16, observed: true },
  { at: 35, tiles: [0,0,0,0, 2,0,0,1, 0,0,1,1, 0,0,1,1], frame: 0, side: 'right', lyric: 'あさけながらの', density: .22, observed: true },
  { at: 40, tiles: [0,1,0,2, 1,0,0,0, 0,1,1,1, 1,1,0,2], frame: 2, side: 'left', lyric: 'あらたな灯りの', density: .58, observed: true },
  { at: 60, tiles: [1,2,1,0, 0,1,1,0, 0,0,0,0, 0,0,0,0], frame: 1, side: 'left', lyric: '壁の向こうを', density: .24, observed: true },
  { at: 90, tiles: [0,0,0,1, 2,1,0,2, 1,2,1,1, 0,1,0,1], frame: 2, side: 'right', lyric: 'すれ違う声を', density: .38, event: 'burst', observed: true },
  { at: 120, tiles: [0,0,0,1, 2,0,0,0, 0,1,0,1, 0,2,0,1], frame: 1, side: 'right', lyric: '伸ばした手の', density: .17, observed: true },
  { at: 150, tiles: [2,0,1,0, 1,0,0,2, 0,0,2,0, 0,0,0,1], frame: 0, side: 'left', lyric: '遠ざかる景色', density: .28, observed: true },
];

const lines = ['あらたな灯りの', 'こぼれた街の', '見慣れた灯火', '雨下花々に', '壁の向こうを', 'すれ違う声を', '伸ばした手の', '遠ざかる景色'];

function random(index: number) {
  const value = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function closestAnchor(at: number) {
  return anchors.reduce((best, cue) => Math.abs(cue.at - at) < Math.abs(best.at - at) ? cue : best, anchors[0]);
}

function fillCue(at: number): Cue {
  const anchor = closestAnchor(at);
  const step = Math.round(at * 10);
  const tiles = anchor.tiles.map((base, index) => {
    const roll = random(step + index * 19);
    if (roll < .16) return ((base + 1) % 3) as Tile;
    if (roll > .9) return 0 as Tile;
    return base;
  });
  return {
    at,
    tiles,
    frame: (anchor.frame + Math.floor(at / 7.5)) % 3,
    side: Math.floor(at / 17.5) % 2 ? 'left' : 'right',
    lyric: lines[Math.floor(at / 22.5) % lines.length],
    density: Math.max(.05, Math.min(.72, anchor.density + (random(step + 9) - .5) * .18)),
    event: undefined,
    observed: false,
  };
}

export const score: Cue[] = Array.from({ length: 72 }, (_, index) => index * 2.5)
  .map((at) => anchors.find((cue) => cue.at === at) ?? fillCue(at));

export function activeCue(seconds: number) {
  return score.reduce((current, cue) => cue.at <= seconds ? cue : current, score[0]);
}

export function cueIndex(seconds: number) {
  return score.reduce((lastIndex, cue, index) => cue.at <= seconds ? index : lastIndex, 0);
}
