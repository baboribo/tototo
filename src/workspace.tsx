import { Hint } from './workspace-controls';
import { AudioSettings } from './audio-settings';
import { VisualSettings } from './visual-settings';
import './style.css';
import { useEffect, useRef, useState } from 'react';
import { createAppStore, useAppState, type Settings, type TileMode } from './app-state';
import { createEngine, type Engine } from './engine';
import { DrumEditor } from './drum-editor';
import {
  AudioLines,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  PanelRightClose,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Video,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipProvider } from './components/ui/tooltip';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Progress } from '@/components/ui/progress';

const timeLabel = (time: number, precise = false) =>
  String(Math.floor(time / 60)).padStart(2, '0') +
  ':' +
  (precise
    ? (time % 60).toFixed(3).padStart(6, '0')
    : String(Math.floor(time % 60)).padStart(2, '0'));
export function Workspace() {
  const [store] = useState(createAppStore);
  const state = useAppState(store),
    config = state.settings,
    exportState = state.export;
  const engine = useRef<Engine | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null),
    audio = useRef<HTMLAudioElement>(null),
    spectrum = useRef<HTMLCanvasElement>(null),
    levels = useRef<HTMLCanvasElement>(null),
    preview = useRef<HTMLElement>(null);
  const [tileModeOpen, setTileModeOpen] = useState(false),
    [inspectorHidden, setInspectorHidden] = useState(false);
  const [drumFile, setDrumFile] = useState<File>(),
    [otherFile, setOtherFile] = useState<File>();
  const locked = !state.ready || state.exporting || state.switchingMonitor;
  const setSettings = (patch: Partial<Settings>) => engine.current?.setSettings(patch);
  const loadStems = (mode: TileMode) => {
    setTileModeOpen(false);
    if (drumFile && otherFile) void engine.current?.loadFile(drumFile, otherFile, mode);
  };
  useEffect(() => {
    const mounted = createEngine(
      {
        canvas: canvas.current!,
        audio: audio.current!,
        spectrum: spectrum.current!,
        levels: levels.current!,
      },
      store,
    );
    engine.current = mounted;
    return () => {
      engine.current = null;
      mounted.dispose();
    };
  }, [store]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (tileModeOpen || state.exporting || state.export.open) return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input,button,select,textarea,[role="slider"],[role="tab"],summary,a,[contenteditable="true"]',
        )
      )
        return;
      if (event.key === ' ') {
        event.preventDefault();
        void engine.current?.togglePlaying();
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        engine.current?.seek(store.getSnapshot().time + (event.key === 'ArrowLeft' ? -2.5 : 2.5));
      }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [store, tileModeOpen, state.exporting, state.export.open]);
  return (
    <TooltipProvider delayDuration={350}>
      <a href="#preview" className="skip-link">
        캔버스로 이동
      </a>
      <div className="workspace" id="workspace" data-inspector-hidden={inspectorHidden}>
        <header className="app-toolbar">
          <span className="app-name">tototo</span>
          <Separator orientation="vertical" className="toolbar-divider" />
          <div className="document-name">
            <AudioLines aria-hidden="true" />
            <span id="source-label">{state.source}</span>
          </div>
          <Separator orientation="vertical" className="toolbar-divider" />
          <Hint text="현재 음악과 화면을 동영상으로 내보내기">
            <Button
              id="export-video"
              variant="outline"
              size="sm"
              disabled={locked}
              onClick={() => void engine.current?.exportVideo()}
            >
              <Video aria-hidden="true" />
              동영상 내보내기
            </Button>
          </Hint>
          <Hint text="설정 패널 표시 / 숨기기">
            <Button
              size="icon"
              variant="ghost"
              aria-label={inspectorHidden ? '설정 패널 표시' : '설정 패널 숨기기'}
              aria-pressed={inspectorHidden}
              onClick={() => setInspectorHidden(!inspectorHidden)}
            >
              <PanelRightClose aria-hidden="true" />
            </Button>
          </Hint>
        </header>

        <main className="editor-body">
          <section
            ref={preview}
            className="preview-column"
            id="preview"
            tabIndex={-1}
            aria-label="미리보기"
          >
            <div className="preview-toolbar">
              <span>미리보기</span>
              <div>
                <span className="mono">960 × 720</span>
                <Hint text="미리보기 전체 화면">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="미리보기 전체 화면"
                    onClick={() => {
                      if (document.fullscreenElement) void document.exitFullscreen();
                      else
                        void preview.current?.requestFullscreen().catch(() =>
                          store.update({
                            status: '이 브라우저에서는 전체 화면을 사용할 수 없습니다.',
                          }),
                        );
                    }}
                  >
                    <Maximize2 aria-hidden="true" />
                  </Button>
                </Hint>
              </div>
            </div>
            <div className="canvas-area">
              <div className="stage-wrap">
                <canvas ref={canvas} id="visualizer" width="960" height="720"></canvas>
              </div>
            </div>
            <div className="preview-footer">
              <span id="meter">{state.meter}</span>
              <span id="fps-readout">{config.fps} FPS</span>
            </div>
            <section className="transport" aria-label="재생 제어">
              <div className="transport-buttons">
                <Hint text="처음으로">
                  <Button
                    id="reset"
                    size="icon"
                    variant="ghost"
                    aria-label="처음으로"
                    disabled={locked}
                    onClick={() => engine.current?.seek(0)}
                  >
                    <RotateCcw aria-hidden="true" />
                  </Button>
                </Hint>
                <Button
                  id="toggle"
                  className="play-button"
                  size="icon"
                  aria-label={state.playing ? '일시정지' : '재생'}
                  data-playing={state.playing}
                  disabled={locked}
                  onClick={() => void engine.current?.togglePlaying()}
                >
                  <Play className="play-icon" aria-hidden="true" />
                  <Pause className="pause-icon" aria-hidden="true" />
                  <span id="toggle-label" className="sr-only">
                    {state.playing ? '일시정지' : '재생'}
                  </span>
                </Button>
                <Hint text="2.5초 뒤로">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="seek-button"
                    aria-label="2.5초 뒤로"
                    disabled={locked}
                    onClick={() => engine.current?.seek(state.time - 2.5)}
                  >
                    <ChevronLeft aria-hidden="true" />
                  </Button>
                </Hint>
                <Hint text="2.5초 앞으로">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="seek-button"
                    aria-label="2.5초 앞으로"
                    disabled={locked}
                    onClick={() => engine.current?.seek(state.time + 2.5)}
                  >
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </Hint>
              </div>
              <span className="time-readout" id="time-readout">
                {timeLabel(state.time, true)}
              </span>
              <input
                id="scrubber"
                className="timeline"
                type="range"
                min="0"
                max={state.duration || 1}
                step="0.001"
                value={state.time}
                aria-label="재생 위치"
                disabled={locked}
                onChange={(event) => engine.current?.seek(event.currentTarget.valueAsNumber)}
              />
              <span id="duration-readout" className="duration-readout">
                {timeLabel(state.duration)}
              </span>
            </section>
          </section>

          <aside className="inspector" aria-label="반응 설정">
            <Tabs defaultValue="audio" className="inspector-tabs">
              <TabsList className="inspector-tab-list" aria-label="설정 종류">
                <TabsTrigger value="audio">오디오</TabsTrigger>
                <TabsTrigger value="visual">화면</TabsTrigger>
                <TabsTrigger value="drums">드럼</TabsTrigger>
              </TabsList>
              <div className="inspector-scroll">
                <AudioSettings
                  {...{
                    state,
                    engine,
                    drumFile,
                    otherFile,
                    setDrumFile,
                    setOtherFile,
                    locked,
                    tileModeOpen,
                    setTileModeOpen,
                    loadStems,
                  }}
                />

                <VisualSettings state={state} setSettings={setSettings} />

                <TabsContent value="drums" forceMount className="inspector-content">
                  <DrumEditor
                    state={state.drum}
                    controller={() => engine.current?.drums}
                    spectrum={spectrum}
                    levels={levels}
                    disabled={state.exporting}
                    hits={state.drumReadout}
                  />
                </TabsContent>
              </div>
              <div className="inspector-bottom">
                <SlidersHorizontal aria-hidden="true" />
                <span>설정은 현재 세션에 적용됩니다</span>
              </div>
            </Tabs>
          </aside>
        </main>
        <footer className="statusbar">
          <p id="load-status" role="status" aria-live="polite" data-error={state.error}>
            {state.status}
          </p>
          <span className="shortcut-hint">
            <kbd>Space</kbd> 재생 / 일시정지
          </span>
        </footer>
        <Sheet
          open={exportState.open}
          onOpenChange={(open) => {
            if (!open) engine.current?.closeExport();
          }}
        >
          <SheetContent
            id="export-sheet"
            aria-labelledby="export-sheet-title"
            aria-describedby="export-sheet-status"
            side="bottom"
            showCloseButton={false}
            className="export-sheet"
          >
            <SheetHeader className="export-sheet-header">
              <p className="export-eyebrow">RENDER QUEUE</p>
              <SheetTitle id="export-sheet-title">동영상 내보내기</SheetTitle>
              <SheetDescription id="export-sheet-status" className="export-sheet-status">
                {exportState.message}
              </SheetDescription>
            </SheetHeader>
            <Progress id="export-progress" value={exportState.value} aria-label="내보내기 진행률" />
            <div className="export-sheet-meta">
              <span id="export-progress-label">{Math.round(exportState.value)}%</span>
              <span id="export-format-label">{exportState.format}</span>
            </div>
            <Button
              id="cancel-export"
              variant="outline"
              size="sm"
              onClick={() => engine.current?.closeExport()}
            >
              {exportState.value >= 100 ? '닫기' : '취소'}
            </Button>
          </SheetContent>
        </Sheet>
        <audio ref={audio} id="audio" preload="metadata" />
      </div>
    </TooltipProvider>
  );
}
