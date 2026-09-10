// Structural types for browser APIs missing from TypeScript's DOM definitions.
// Runtime support is checked before construction/configuration.
export type EncodedChunk = {
  byteLength: number;
  timestamp: number;
  duration?: number;
  type?: string;
  copyTo(destination: Uint8Array): void;
};
export type ChunkMetadata = { decoderConfig?: { description?: ArrayBuffer | ArrayBufferView } };
type Frame = { close(): void };
type CodecConfig = {
  codec: string;
  width?: number;
  height?: number;
  bitrate?: number;
  framerate?: number;
  avc?: { format: string };
  sampleRate?: number;
  numberOfChannels?: number;
};
type Encoder = {
  encodeQueueSize: number;
  configure(config: CodecConfig): void;
  encode(data: Frame, options?: { keyFrame: boolean }): void;
  flush(): Promise<void>;
  close(): void;
};
type EncoderConstructor = {
  new (options: {
    output(chunk: EncodedChunk, metadata?: ChunkMetadata): void;
    error(error: Error): void;
  }): Encoder;
  isConfigSupported(config: CodecConfig): Promise<{ supported?: boolean }>;
};
export type ExportGlobals = {
  VideoEncoder?: EncoderConstructor;
  AudioEncoder?: EncoderConstructor;
  VideoFrame?: new (
    source: CanvasImageSource,
    options: { timestamp: number; duration?: number },
  ) => Frame;
  AudioData?: new (options: {
    format: string;
    sampleRate: number;
    numberOfFrames: number;
    numberOfChannels: number;
    timestamp: number;
    data: Float32Array;
  }) => Frame;
  MediaStreamTrackGenerator?: new (options: {
    kind: 'audio' | 'video';
  }) => MediaStreamTrack & { writable: WritableStream<Frame> };
};
export function copyDescription(
  description: ArrayBuffer | ArrayBufferView,
): Uint8Array<ArrayBuffer> {
  return ArrayBuffer.isView(description)
    ? new Uint8Array(
        new Uint8Array(description.buffer, description.byteOffset, description.byteLength),
      )
    : new Uint8Array(description.slice(0));
}
