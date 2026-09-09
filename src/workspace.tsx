import './style.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AudioLines, ChevronLeft, ChevronRight, Download, Headphones, Maximize2, PanelRightClose, Pause, Play, RotateCcw, SlidersHorizontal, Upload, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

function Hint({ text, children }: { text: string; children: ReactNode }) {
  return <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent>{text}</TooltipContent></Tooltip>;
}

function Field({ name, id, children }: { name: string; id: string; children: ReactNode }) {
  return <div className="field"><Label htmlFor={id}>{name}</Label>{children}</div>;
}

function StemFileInput({ id, label }: { id: 'drum-file' | 'other-file'; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState('선택된 파일 없음');
  return <div className="stem-file-row">
    <div className="stem-file-copy"><strong>{label}</strong><span title={filename}>{filename}</span></div>
    <Input ref={input} id={id} type="file" accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac" className="file-input" aria-label={`${label} 파일`} onChange={event => setFilename(event.currentTarget.files?.[0]?.name ?? '선택된 파일 없음')} />
    <Button type="button" variant="outline" size="sm" aria-label={`${label} 파일 선택`} onClick={() => input.current?.click()}><Upload aria-hidden="true" />선택</Button>
  </div>;
}

// Keep the existing audio engine's native input contract at the UI boundary.
function ReactionSlider({ id, min, max, step, initial }: { id: string; min: number; max: number; step: number; initial: number }) {
  const input = useRef<HTMLInputElement>(null);
  const output = useRef<HTMLOutputElement>(null);
  return <div className="slider-field">
    <input ref={input} id={id} type="hidden" defaultValue={initial} />
    <Slider aria-label={id === 'impact' ? '박자 강조' : id === 'tile-fade' ? '타일 페이드' : '반응 감도'} min={min} max={max} step={step} defaultValue={[initial]} onValueChange={([value]) => {
      if (!input.current) return;
      input.current.value = String(value);
      input.current.dispatchEvent(new Event('input', { bubbles: true }));
      if (output.current) output.current.textContent = value.toFixed(2);
    }} />
    <output ref={output}>{initial.toFixed(2)}</output>
  </div>;
}

function Workspace() {
  const [exportState, setExportState] = useState({ open: false, message: '렌더링을 준비하고 있습니다…', value: 0, format: 'MP4 / WebM' });
  const [tileModeOpen, setTileModeOpen] = useState(false);
  useEffect(() => {
    const open = (event: Event) => { const detail = (event as CustomEvent<{ format?: string }>).detail; setExportState(state => ({ ...state, open: true, value: 0, format: detail?.format ?? state.format })); };
    const progress = (event: Event) => { const detail = (event as CustomEvent<{ message: string; value: number; format?: string }>).detail; setExportState(state => ({ ...state, message: detail.message, value: detail.value, format: detail.format ?? state.format })); };
    const close = () => setExportState(state => ({ ...state, open: false }));
    const openTileMode = () => setTileModeOpen(true);
    const closeTileMode = () => setTileModeOpen(false);
    window.addEventListener('tototo:export-open', open); window.addEventListener('tototo:export-progress', progress); window.addEventListener('tototo:export-close', close); window.addEventListener('tototo:tile-mode-open', openTileMode); window.addEventListener('tototo:tile-mode-close', closeTileMode);
    return () => { window.removeEventListener('tototo:export-open', open); window.removeEventListener('tototo:export-progress', progress); window.removeEventListener('tototo:export-close', close); window.removeEventListener('tototo:tile-mode-open', openTileMode); window.removeEventListener('tototo:tile-mode-close', closeTileMode); };
  }, []);
  return <TooltipProvider delayDuration={350}>
    <a href="#preview" className="skip-link">캔버스로 이동</a>
    <div className="workspace" id="workspace">
      <header className="app-toolbar">
        <span className="app-name">tototo</span>
        <Separator orientation="vertical" className="toolbar-divider" />
        <div className="document-name"><AudioLines aria-hidden="true" /><span id="source-label">파일 없음</span></div>
        <Separator orientation="vertical" className="toolbar-divider" />
        <Hint text="현재 음악과 화면을 동영상으로 내보내기"><Button id="export-video" variant="outline" size="sm" disabled><Video aria-hidden="true" />동영상 내보내기</Button></Hint>
        <Hint text="설정 패널 표시 / 숨기기"><Button size="icon" variant="ghost" aria-label="설정 패널 숨기기" aria-pressed={false} onClick={event => {
          const shell = document.querySelector<HTMLElement>('#workspace')!;
          const hidden = shell.dataset.inspectorHidden !== 'true';
          shell.dataset.inspectorHidden = String(hidden);
          event.currentTarget.setAttribute('aria-pressed', String(hidden));
          event.currentTarget.setAttribute('aria-label', hidden ? '설정 패널 표시' : '설정 패널 숨기기');
        }}><PanelRightClose aria-hidden="true" /></Button></Hint>
      </header>

      <main className="editor-body">
        <section className="preview-column" id="preview" tabIndex={-1} aria-label="미리보기">
          <div className="preview-toolbar"><span>미리보기</span><div><span className="mono">960 × 720</span><Hint text="미리보기 전체 화면"><Button size="icon" variant="ghost" aria-label="미리보기 전체 화면" onClick={() => {
            const preview = document.querySelector<HTMLElement>('#preview')!;
            if (document.fullscreenElement) void document.exitFullscreen();
            else void preview.requestFullscreen().catch(() => { document.querySelector<HTMLElement>('#load-status')!.textContent = '이 브라우저에서는 전체 화면을 사용할 수 없습니다.'; });
          }}><Maximize2 aria-hidden="true" /></Button></Hint></div></div>
          <div className="canvas-area"><div className="stage-wrap"><canvas id="visualizer" width="960" height="720"></canvas></div></div>
          <div className="preview-footer"><span id="meter">LOW 00 · MID 00 · HIGH 00</span><span id="fps-readout">10 FPS</span></div>
          <section className="transport" aria-label="재생 제어">
            <div className="transport-buttons">
              <Hint text="처음으로"><Button id="reset" size="icon" variant="ghost" aria-label="처음으로" disabled><RotateCcw aria-hidden="true" /></Button></Hint>
              <Button id="toggle" className="play-button" size="icon" aria-label="재생" disabled><Play className="play-icon" aria-hidden="true" /><Pause className="pause-icon" aria-hidden="true" /><span id="toggle-label" className="sr-only">재생</span></Button>
              <Hint text="2.5초 뒤로"><Button size="icon" variant="ghost" className="seek-button" aria-label="2.5초 뒤로" onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))}><ChevronLeft aria-hidden="true" /></Button></Hint>
              <Hint text="2.5초 앞으로"><Button size="icon" variant="ghost" className="seek-button" aria-label="2.5초 앞으로" onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))}><ChevronRight aria-hidden="true" /></Button></Hint>
            </div>
            <span className="time-readout" id="time-readout">00:00.000</span>
            <input id="scrubber" className="timeline" type="range" min="0" max="1" step="0.001" defaultValue="0" aria-label="재생 위치" disabled />
            <span id="duration-readout" className="duration-readout">00:00</span>
          </section>
        </section>

        <aside className="inspector" aria-label="반응 설정">
          <Tabs defaultValue="audio" className="inspector-tabs">
            <TabsList className="inspector-tab-list" aria-label="설정 종류">
              <TabsTrigger value="audio">오디오</TabsTrigger><TabsTrigger value="visual">화면</TabsTrigger><TabsTrigger value="drums">드럼</TabsTrigger>
            </TabsList>
            <div className="inspector-scroll">
              <TabsContent value="audio" forceMount className="inspector-content">
                <section className="inspector-section stems-panel">
                  <h2>입력 파일</h2>
                  <p className="field-help">같은 시작 시점에서 분리한 드럼과 나머지 스템을 선택하세요.</p>
                  <div className="stem-file-list"><StemFileInput id="drum-file" label="드럼 스템" /><StemFileInput id="other-file" label="나머지 스템" /></div>
                  <Button id="apply-stems" className="w-full" disabled>두 스템 불러오기</Button>
                  <p id="tile-mode-readout" className="field-help">타일 생성 방식은 불러올 때 선택합니다.</p>
                  <Dialog open={tileModeOpen} onOpenChange={open => { setTileModeOpen(open); if (!open) window.dispatchEvent(new CustomEvent('tototo:tile-mode-close')); }}>
                    <DialogContent id="tile-mode-dialog" className="tile-mode-dialog" showCloseButton={false}>
                      <DialogHeader><DialogTitle id="tile-mode-title">타일 생성 방식</DialogTitle><DialogDescription id="tile-mode-description">이 곡의 타일을 어떻게 준비할까요?</DialogDescription></DialogHeader>
                    <div className="tile-mode-choices">
                      <Button id="choose-live" variant="outline"><span>즉흥 생성 · 현재 방식</span><small>재생 위치의 오디오로 타일을 계산합니다.</small></Button>
                      <Button id="choose-preload" variant="outline"><span>사전 생성 · 프리로드</span><small>곡 전체의 타일과 반응을 미리 준비한 뒤 재생합니다.</small></Button>
                    </div>
                    <p className="field-help">사전 생성은 준비 시간이 필요합니다. 감도·박자·드럼 설정을 바꾸면 다시 생성합니다.</p>
                    <Button id="cancel-tile-mode" variant="ghost">취소</Button>
                    </DialogContent>
                  </Dialog>
                  <details className="technical-note"><summary>입력 안내</summary><p id="stem-mode">드럼과 나머지 파일은 같은 곡에서 같은 시작 시점으로 분리한 스템이어야 합니다.</p></details>
                  <div className="stem-downloads"><a id="download-drums" hidden><Download aria-hidden="true" />드럼 저장</a><a id="download-other" hidden><Download aria-hidden="true" />나머지 저장</a></div>
                </section>
                <Separator />
                <section className="inspector-section">
                  <h2>모니터링</h2>
                  <Field name="듣기" id="monitor"><NativeSelect id="monitor" disabled defaultValue="mix"><NativeSelectOption value="mix">전체 믹스</NativeSelectOption><NativeSelectOption value="drums">드럼만</NativeSelectOption><NativeSelectOption value="other">나머지만</NativeSelectOption></NativeSelect></Field>
                  <div className="detection-readout"><Headphones aria-hidden="true" /><span id="drum-readout">—</span></div>
                </section>
                <Separator />
                <details className="diagnostics inspector-section"><summary>테스트 신호</summary><div className="diagnostic-actions"><Button id="rhythm" variant="outline" size="sm">리듬 테스트</Button><Button id="demo" variant="outline" size="sm">주파수 테스트</Button></div></details>
              </TabsContent>

              <TabsContent value="visual" forceMount className="inspector-content">
                <section className="inspector-section">
                  <h2>화면 반응</h2>
                  <Field name="모션 프레임" id="fps"><NativeSelect id="fps" defaultValue="10">{[10,12,15,24,30,60].map(fps => <NativeSelectOption key={fps} value={fps}>{fps} FPS</NativeSelectOption>)}</NativeSelect></Field>
                  <Field name="외곽선 입력" id="perimeter-source"><NativeSelect id="perimeter-source" defaultValue="both"><NativeSelectOption value="both">드럼 + 나머지</NativeSelectOption><NativeSelectOption value="drums">드럼</NativeSelectOption><NativeSelectOption value="other">나머지</NativeSelectOption></NativeSelect></Field>
                  <Field name="박자 강조" id="impact"><ReactionSlider id="impact" min={0} max={1.6} step={.05} initial={1.1} /></Field>
                  <Field name="타일 페이드 (초)" id="tile-fade"><ReactionSlider id="tile-fade" min={.05} max={.8} step={.05} initial={.3} /></Field>
                  <Field name="반응 감도" id="sensitivity"><ReactionSlider id="sensitivity" min={.5} max={1.8} step={.05} initial={1} /></Field>
                </section>
                <Separator />
                <section className="inspector-section">
                  <h2>박자 보정</h2>
                  <div className="tempo-status"><span id="beat-light" aria-hidden="true" /><strong id="tempo-readout">BPM —</strong></div><p id="tempo-detail" className="field-help">파일을 불러오면 자동으로 분석합니다.</p>
                  <Field name="BPM" id="bpm"><Input id="bpm" type="number" min="40" max="240" step="0.25" placeholder="자동" /></Field>
                  <Field name="박자 해석" id="tempo-scale"><NativeSelect id="tempo-scale" defaultValue="1"><NativeSelectOption value="1">자동 추정 그대로</NativeSelectOption><NativeSelectOption value="0.5">절반 속도</NativeSelectOption><NativeSelectOption value="2">두 배 속도</NativeSelectOption></NativeSelect></Field>
                  <Field name="위치 보정 (ms)" id="beat-offset"><Input id="beat-offset" type="number" min="-500" max="500" step="10" defaultValue="0" /></Field>
                  <p className="field-help">BPM을 비우면 자동 분석을 사용합니다.</p>
                </section>
                <Separator />
                <section className="inspector-section"><h2>문구</h2><Field name="캔버스 오른쪽" id="caption"><Input id="caption" type="text" maxLength={20} placeholder="입력 없음" /></Field></section>
              </TabsContent>

              <TabsContent value="drums" forceMount className="inspector-content"><div id="drum-editor-host" /></TabsContent>
            </div>
            <div className="inspector-bottom"><SlidersHorizontal aria-hidden="true" /><span>설정은 현재 세션에 적용됩니다</span></div>
          </Tabs>
        </aside>
      </main>
      <footer className="statusbar"><p id="load-status" role="status" aria-live="polite">드럼과 나머지 스템을 선택하세요.</p><span className="shortcut-hint"><kbd>Space</kbd> 재생 / 일시정지</span></footer>
      <Sheet open={exportState.open} onOpenChange={open => { if (!open) window.dispatchEvent(new CustomEvent('tototo:export-cancel')); }}>
        <SheetContent id="export-sheet" side="bottom" showCloseButton={false} className="export-sheet">
          <SheetHeader className="export-sheet-header"><p className="export-eyebrow">RENDER QUEUE</p><SheetTitle id="export-sheet-title">동영상 내보내기</SheetTitle><SheetDescription id="export-sheet-status" className="export-sheet-status">{exportState.message}</SheetDescription></SheetHeader>
          <Progress id="export-progress" value={exportState.value} aria-label="내보내기 진행률" />
          <div className="export-sheet-meta"><span id="export-progress-label">{Math.round(exportState.value)}%</span><span id="export-format-label">{exportState.format}</span></div>
          <Button id="cancel-export" variant="outline" size="sm" onClick={() => window.dispatchEvent(new CustomEvent(exportState.value >= 100 ? 'tototo:export-close' : 'tototo:export-cancel'))}>{exportState.value >= 100 ? '닫기' : '취소'}</Button>
        </SheetContent>
      </Sheet>
      <audio id="audio" preload="metadata" />
    </div>
  </TooltipProvider>;
}

// Mount controls before the engine binds listeners. Tab panels stay mounted so
// switching inspectors never replaces the canvas, audio element or file inputs.
flushSync(() => createRoot(document.getElementById('root')!).render(<Workspace />));
void import('./main').catch(error => {
  const status = document.querySelector<HTMLElement>('#load-status');
  if (status) { status.dataset.error = 'true'; status.textContent = `시각화 엔진을 불러오지 못했습니다. ${error instanceof Error ? error.message : String(error)}`; }
  console.error(error);
});
