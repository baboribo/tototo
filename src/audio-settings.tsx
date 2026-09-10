import type { RefObject } from 'react';
import type { AppState, Monitor, TileMode } from './app-state';
import type { Engine } from './engine';
import { Download, Headphones } from 'lucide-react';
import { Button } from './components/ui/button';
import { NativeSelect, NativeSelectOption } from './components/ui/native-select';
import { Separator } from './components/ui/separator';
import { TabsContent } from './components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './components/ui/dialog';
import { Field, StemFileInput } from './workspace-controls';
type Props = {
  state: AppState;
  engine: RefObject<Engine | null>;
  drumFile?: File;
  otherFile?: File;
  setDrumFile: (file: File | undefined) => void;
  setOtherFile: (file: File | undefined) => void;
  locked: boolean;
  tileModeOpen: boolean;
  setTileModeOpen: (open: boolean) => void;
  loadStems: (mode: TileMode) => void;
};
export function AudioSettings({
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
}: Props) {
  return (
    <TabsContent value="audio" forceMount className="inspector-content">
      <section className="inspector-section stems-panel">
        <h2>입력 파일</h2>
        <p className="field-help">같은 시작 시점에서 분리한 드럼과 나머지 스템을 선택하세요.</p>
        <div className="stem-file-list">
          <StemFileInput
            id="drum-file"
            label="드럼 스템"
            onFile={setDrumFile}
            disabled={state.exporting}
          />
          <StemFileInput
            id="other-file"
            label="나머지 스템"
            onFile={setOtherFile}
            disabled={state.exporting}
          />
        </div>
        <Button
          id="apply-stems"
          className="w-full"
          disabled={!drumFile || !otherFile || state.exporting}
          onClick={() => setTileModeOpen(true)}
        >
          두 스템 불러오기
        </Button>
        <p id="tile-mode-readout" className="field-help">
          {state.tileModeReadout}
        </p>
        <Dialog open={tileModeOpen} onOpenChange={setTileModeOpen}>
          <DialogContent
            id="tile-mode-dialog"
            aria-labelledby="tile-mode-title"
            aria-describedby="tile-mode-description"
            className="tile-mode-dialog"
            showCloseButton={false}
          >
            <DialogHeader>
              <DialogTitle id="tile-mode-title">타일 생성 방식</DialogTitle>
              <DialogDescription id="tile-mode-description">
                이 곡의 타일을 어떻게 준비할까요?
              </DialogDescription>
            </DialogHeader>
            <div className="tile-mode-choices">
              <Button id="choose-live" variant="outline" onClick={() => loadStems('live')}>
                <span>즉흥 생성 · 현재 방식</span>
                <small>재생 위치의 오디오로 타일을 계산합니다.</small>
              </Button>
              <Button id="choose-preload" variant="outline" onClick={() => loadStems('preload')}>
                <span>사전 생성 · 프리로드</span>
                <small>곡 전체의 타일과 반응을 미리 준비한 뒤 재생합니다.</small>
              </Button>
            </div>
            <p className="field-help">
              사전 생성은 준비 시간이 필요합니다. 감도·박자·드럼 설정을 바꾸면 다시 생성합니다.
            </p>
            <Button id="cancel-tile-mode" variant="ghost" onClick={() => setTileModeOpen(false)}>
              취소
            </Button>
          </DialogContent>
        </Dialog>
        <details className="technical-note">
          <summary>입력 안내</summary>
          <p id="stem-mode">{state.stemMode}</p>
        </details>
        <div className="stem-downloads">
          <a
            id="download-drums"
            hidden={!state.downloads}
            href={state.downloads?.drums.url}
            download={state.downloads?.drums.name}
          >
            <Download aria-hidden="true" />
            드럼 저장
          </a>
          <a
            id="download-other"
            hidden={!state.downloads}
            href={state.downloads?.other.url}
            download={state.downloads?.other.name}
          >
            <Download aria-hidden="true" />
            나머지 저장
          </a>
        </div>
      </section>
      <Separator />
      <section className="inspector-section">
        <h2>모니터링</h2>
        <Field name="듣기" id="monitor">
          <NativeSelect
            id="monitor"
            disabled={locked}
            value={state.monitor}
            onChange={(event) =>
              engine.current?.switchMonitor(event.currentTarget.value as Monitor)
            }
          >
            <NativeSelectOption value="mix">전체 믹스</NativeSelectOption>
            <NativeSelectOption value="drums">드럼만</NativeSelectOption>
            <NativeSelectOption value="other">나머지만</NativeSelectOption>
          </NativeSelect>
        </Field>
        <div className="detection-readout">
          <Headphones aria-hidden="true" />
          <span id="drum-readout">{state.drumReadout}</span>
        </div>
      </section>
      <Separator />
      <details className="diagnostics inspector-section">
        <summary>테스트 신호</summary>
        <div className="diagnostic-actions">
          <Button
            id="rhythm"
            variant="outline"
            size="sm"
            disabled={state.exporting}
            onClick={() => void engine.current?.loadDemo(true)}
          >
            리듬 테스트
          </Button>
          <Button
            id="demo"
            variant="outline"
            size="sm"
            disabled={state.exporting}
            onClick={() => void engine.current?.loadDemo(false)}
          >
            주파수 테스트
          </Button>
        </div>
      </details>
    </TabsContent>
  );
}
