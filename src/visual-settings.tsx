import type { AppState, Settings } from './app-state';
import type { PerimeterSource } from './reactive-ink';
import { Input } from './components/ui/input';
import { NativeSelect, NativeSelectOption } from './components/ui/native-select';
import { Separator } from './components/ui/separator';
import { TabsContent } from './components/ui/tabs';
import { Field, ReactionSlider } from './workspace-controls';
export function VisualSettings({
  state,
  setSettings,
}: {
  state: AppState;
  setSettings: (patch: Partial<Settings>) => void;
}) {
  const config = state.settings;
  return (
    <TabsContent value="visual" forceMount className="inspector-content">
      <fieldset className="visual-settings" disabled={state.exporting}>
        <section className="inspector-section">
          <h2>화면 반응</h2>
          <Field name="모션 프레임" id="fps">
            <NativeSelect
              id="fps"
              value={config.fps}
              onChange={(event) => setSettings({ fps: Number(event.currentTarget.value) })}
            >
              {[10, 12, 15, 24, 30, 60].map((fps) => (
                <NativeSelectOption key={fps} value={fps}>
                  {fps} FPS
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field name="외곽선 입력" id="perimeter-source">
            <NativeSelect
              id="perimeter-source"
              value={config.perimeterSource}
              onChange={(event) =>
                setSettings({
                  perimeterSource: event.currentTarget.value as PerimeterSource,
                })
              }
            >
              <NativeSelectOption value="both">드럼 + 나머지</NativeSelectOption>
              <NativeSelectOption value="drums">드럼</NativeSelectOption>
              <NativeSelectOption value="other">나머지</NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field name="박자 강조" id="impact">
            <ReactionSlider
              disabled={state.exporting}
              id="impact"
              min={0}
              max={1.6}
              step={0.05}
              value={config.impact}
              onValue={(value) => setSettings({ impact: value })}
            />
          </Field>
          <Field name="타일 페이드 (초)" id="tile-fade">
            <ReactionSlider
              disabled={state.exporting}
              id="tile-fade"
              min={0.05}
              max={0.8}
              step={0.05}
              value={config.tileFade}
              onValue={(value) => setSettings({ tileFade: value })}
            />
          </Field>
          <Field name="반응 감도" id="sensitivity">
            <ReactionSlider
              disabled={state.exporting}
              id="sensitivity"
              min={0.5}
              max={1.8}
              step={0.05}
              value={config.sensitivity}
              onValue={(value) => setSettings({ sensitivity: value })}
            />
          </Field>
        </section>
        <Separator />
        <section className="inspector-section">
          <h2>박자 보정</h2>
          <div className="tempo-status">
            <span id="beat-light" data-active={state.beatActive} aria-hidden="true" />
            <strong id="tempo-readout">{state.tempoReadout}</strong>
          </div>
          <p id="tempo-detail" className="field-help">
            {state.tempoDetail}
          </p>
          <Field name="BPM" id="bpm">
            <Input
              id="bpm"
              type="number"
              min="40"
              max="240"
              step="0.25"
              placeholder="자동"
              value={config.bpm}
              onChange={(event) => setSettings({ bpm: event.currentTarget.value })}
            />
          </Field>
          <Field name="박자 해석" id="tempo-scale">
            <NativeSelect
              id="tempo-scale"
              value={config.tempoScale}
              onChange={(event) => setSettings({ tempoScale: Number(event.currentTarget.value) })}
            >
              <NativeSelectOption value="1">자동 추정 그대로</NativeSelectOption>
              <NativeSelectOption value="0.5">절반 속도</NativeSelectOption>
              <NativeSelectOption value="2">두 배 속도</NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field name="위치 보정 (ms)" id="beat-offset">
            <Input
              id="beat-offset"
              type="number"
              min="-500"
              max="500"
              step="10"
              value={config.beatOffset}
              onChange={(event) => setSettings({ beatOffset: Number(event.currentTarget.value) })}
            />
          </Field>
          <p className="field-help">BPM을 비우면 자동 분석을 사용합니다.</p>
        </section>
        <Separator />
        <section className="inspector-section">
          <h2>문구</h2>
          <Field name="캔버스 오른쪽" id="caption">
            <Input
              id="caption"
              type="text"
              maxLength={20}
              placeholder="입력 없음"
              value={config.caption}
              onChange={(event) => setSettings({ caption: event.currentTarget.value })}
            />
          </Field>
        </section>
      </fieldset>
    </TabsContent>
  );
}
