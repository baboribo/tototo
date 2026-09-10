import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import type { DrumState } from './app-state';
import { drumFields, type DrumController, type DrumField } from './drum-controller';
import { drumColors } from './drum-graphs';

type Props = {
  state: DrumState;
  controller: () => DrumController | undefined;
  spectrum: RefObject<HTMLCanvasElement | null>;
  levels: RefObject<HTMLCanvasElement | null>;
  disabled: boolean;
  hits: string;
};
function NumberField({
  field,
  name,
  min,
  max,
  step,
  value,
  kind,
  onChange,
}: {
  field: DrumField;
  name: string;
  min: number;
  max: number;
  step: number;
  value: number;
  kind: string;
  onChange: (field: DrumField, value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <Label>
      {name}
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        aria-label={`${kind} ${name}`}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          if (event.currentTarget.value) onChange(field, event.currentTarget.valueAsNumber);
        }}
        onBlur={() => setDraft(String(value))}
      />
    </Label>
  );
}
export function DrumEditor({ state, controller, spectrum, levels, disabled, hits }: Props) {
  const area = useRef<HTMLDivElement>(null);
  const edge = useRef<'low' | 'high' | null>(null);
  const channel = state.channels[state.selected],
    kind = channel.kind.toUpperCase();
  const color = { '--channel': drumColors[state.selected] } as CSSProperties;
  const frequency = (clientX: number) => {
    const bounds = spectrum.current!.getBoundingClientRect();
    return Math.round(
      20 * 1000 ** Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)),
    );
  };
  const threshold = (clientY: number) => {
    const bounds = area.current!.getBoundingClientRect();
    controller()?.setField('threshold', (1 - (clientY - bounds.top) / bounds.height) * 1.6);
  };
  return (
    <fieldset className="drum-eq" disabled={disabled} aria-label="드럼 스템 EQ 반응 조절">
      <div className="eq-heading">
        <div>
          <p className="eyebrow">DRUM STEM / FREQUENCY TRIGGER</p>
          <h2>드럼 반응 조절</h2>
        </div>
        <Button id="eq-reset" variant="outline" size="sm" onClick={() => controller()?.reset()}>
          기본값 복원
        </Button>
      </div>
      <p>
        드럼 스템의 주파수를 보며 악기별 타일·펜 반응을 조절하세요. 그래프 양쪽 선을 드래그하면
        대역을 바꿀 수 있습니다.
      </p>
      <div className="eq-tabs" role="group" aria-label="드럼 채널">
        {state.channels.map((item, index) => (
          <Button
            key={item.kind}
            variant="outline"
            size="sm"
            style={{ '--channel': drumColors[index] } as CSSProperties}
            aria-pressed={state.selected === index}
            data-hit={hits.includes(item.kind.toUpperCase())}
            onClick={() => controller()?.select(index)}
          >
            {item.kind.toUpperCase()}
          </Button>
        ))}
      </div>
      <canvas
        ref={spectrum}
        id="drum-spectrum"
        width="720"
        height="300"
        aria-label="재생 시점의 드럼 주파수 스펙트럼과 선택 대역"
        onPointerDown={(event) => {
          if (disabled) return;
          const f = frequency(event.clientX);
          edge.current =
            Math.abs(Math.log(f / channel.low)) < Math.abs(Math.log(f / channel.high))
              ? 'low'
              : 'high';
          event.currentTarget.setPointerCapture(event.pointerId);
          controller()?.setField(edge.current, f);
        }}
        onPointerMove={(event) => {
          if (!disabled && edge.current)
            controller()?.setField(edge.current, frequency(event.clientX));
        }}
        onPointerUp={() => {
          edge.current = null;
          controller()?.flush();
        }}
        onPointerCancel={() => {
          edge.current = null;
        }}
      />
      <p>
        대역 세기 / 반응 기준 — 가로 바를 위아래로 드래그하세요. 낮출수록 작은 소리에도 반응합니다.
      </p>
      <div ref={area} className="eq-threshold-area">
        <canvas
          ref={levels}
          id="drum-level"
          width="720"
          height="230"
          aria-label="선택 대역의 최근 3초 세기와 감지 임계값"
        />
        <div
          id="threshold-bar"
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          aria-label="선택 드럼 감지 임계값"
          aria-orientation="vertical"
          aria-valuemin={0.02}
          aria-valuemax={1.5}
          aria-valuenow={channel.threshold}
          aria-valuetext={`${kind} ${channel.threshold.toFixed(2)} 이상`}
          style={{ ...color, top: `${(1 - channel.threshold / 1.6) * 100}%` }}
          onPointerDown={(event) => {
            if (!disabled) {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
            }
          }}
          onPointerMove={(event) => {
            if (!disabled && event.currentTarget.hasPointerCapture(event.pointerId))
              threshold(event.clientY);
          }}
          onPointerUp={() => controller()?.flush()}
          onKeyDown={(event) => {
            if (
              disabled ||
              !['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Home', 'End'].includes(
                event.key,
              )
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            const step = event.shiftKey ? 0.1 : 0.01;
            controller()?.setField(
              'threshold',
              event.key === 'Home'
                ? 0.02
                : event.key === 'End'
                  ? 1.5
                  : channel.threshold +
                    (['ArrowUp', 'ArrowRight'].includes(event.key) ? step : -step),
            );
          }}
        >
          <span>
            ↕ {kind} 기준 {channel.threshold.toFixed(2)}
          </span>
        </div>
      </div>
      <p className="eq-note">
        선 이상이면 세기 조건을 충족합니다. 실제 타격은 어택 조건과 재타격 간격도 충족해야 합니다.
        밝은 점은 감지된 타격입니다. 위 주파수 그래프와 달리 이 그래프는 선택 대역 전체의 분석
        게인이 반영된 세기입니다.
      </p>
      <div className="eq-controls">
        <Label>
          <Input
            type="checkbox"
            checked={channel.enabled}
            onChange={(event) => controller()?.setEnabled(event.currentTarget.checked)}
          />
          타일·펜 반응 켜기
        </Label>
        {drumFields.map(([field, name, min, max, step]) => (
          <NumberField
            key={`${kind}-${field}`}
            {...{ field, name, min, max, step, kind }}
            value={channel[field]}
            onChange={(field, value) => controller()?.setField(field, value)}
          />
        ))}
      </div>
      <div className="eq-footer">
        <Button
          id="eq-solo"
          variant="outline"
          size="sm"
          disabled={!state.loaded || disabled}
          aria-pressed={state.solo}
          onClick={() => controller()?.toggleSolo()}
        >
          {state.solo ? '단독 듣기 종료' : '선택 대역만 듣기'}
        </Button>
        <output id="eq-status" aria-live="polite">
          {state.message}
        </output>
      </div>
      <p className="eq-note">
        분석 게인은 타일·펜 타격 감지에 적용됩니다. 단독 듣기는 드럼 스템에 대역 필터를 적용하며
        원본·저장 파일은 바꾸지 않습니다. 주파수가 겹치는 악기는 완전히 분리되지 않습니다.
      </p>
    </fieldset>
  );
}
