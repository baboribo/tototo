import { useRef, useState, type ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Slider } from './components/ui/slider';
import { Tooltip, TooltipTrigger, TooltipContent } from './components/ui/tooltip';
export function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

export function Field({ name, id, children }: { name: string; id: string; children: ReactNode }) {
  return (
    <div className="field">
      <Label htmlFor={id}>{name}</Label>
      {children}
    </div>
  );
}

export function StemFileInput({
  id,
  label,
  onFile,
  disabled,
}: {
  id: 'drum-file' | 'other-file';
  label: string;
  onFile: (file: File | undefined) => void;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState('선택된 파일 없음');
  return (
    <div className="stem-file-row">
      <div className="stem-file-copy">
        <strong>{label}</strong>
        <span title={filename}>{filename}</span>
      </div>
      <Input
        ref={input}
        id={id}
        type="file"
        accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac"
        className="file-input"
        aria-label={`${label} 파일`}
        disabled={disabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          setFilename(file?.name ?? '선택된 파일 없음');
          onFile(file);
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        aria-label={`${label} 파일 선택`}
        onClick={() => input.current?.click()}
      >
        <Upload aria-hidden="true" />
        선택
      </Button>
    </div>
  );
}

export function ReactionSlider({
  id,
  min,
  max,
  step,
  value,
  onValue,
  disabled,
}: {
  id: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onValue: (value: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="slider-field">
      <Slider
        disabled={disabled}
        id={id}
        aria-label={
          id === 'impact' ? '박자 강조' : id === 'tile-fade' ? '타일 페이드' : '반응 감도'
        }
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([next]) => onValue(next)}
      />
      <output>{value.toFixed(2)}</output>
    </div>
  );
}
