import type { ChapterBlock } from './chapterParser';

export interface SpeechSpeakOptions {
  rate: number;
  pitch?: number;
  voice?: string;
}

export interface SpeechCallbacks {
  onDone: () => void;
  onStopped?: () => void;
  onError?: (err: unknown) => void;
}

export interface SpeechDriver {
  speak(text: string, opts: SpeechSpeakOptions, callbacks: SpeechCallbacks): void;
  stop(): void;
}

export interface TtsState {
  enabled: boolean;
  playing: boolean;
  activeBlockIndex: number | null;
  rate: number;
  voice?: string;
}

export interface TtsListenerOptions {
  onStateChange?: (state: TtsState) => void;
  onActiveBlockChange?: (blockIndex: number | null) => void;
  onChapterComplete?: () => void;
}

function isSpeakableBlock(block: ChapterBlock): block is { type: 'heading' | 'paragraph' | 'blockquote'; text: string } {
  return (
    (block.type === 'paragraph' || block.type === 'heading' || block.type === 'blockquote') &&
    block.text.trim().length > 0
  );
}

export class TtsController {
  private readonly driver: SpeechDriver;
  private readonly listeners: TtsListenerOptions;
  private blocks: ChapterBlock[] = [];
  private state: TtsState = {
    enabled: false, // Strictly OFF by default so nothing ever intrudes on reading
    playing: false,
    activeBlockIndex: null,
    rate: 1.0,
    voice: undefined,
  };
  private generation = 0;

  constructor(driver: SpeechDriver, listeners: TtsListenerOptions = {}) {
    this.driver = driver;
    this.listeners = listeners;
  }

  getState(): TtsState {
    return { ...this.state };
  }

  loadBlocks(blocks: ChapterBlock[], startIndex = 0): void {
    this.generation++;
    this.driver.stop();
    this.blocks = blocks;
    const first = this.findNextSpeakable(startIndex);
    this.state = {
      ...this.state,
      playing: false,
      activeBlockIndex: first,
    };
    this.emit();
  }

  setEnabled(enabled: boolean): void {
    if (this.state.enabled === enabled) return;
    if (!enabled) {
      this.generation++;
      this.driver.stop();
      this.state = {
        ...this.state,
        enabled: false,
        playing: false,
      };
      this.listeners.onActiveBlockChange?.(null);
      this.emit();
      return;
    }
    this.state = {
      ...this.state,
      enabled: true,
      activeBlockIndex: this.state.activeBlockIndex ?? this.findNextSpeakable(0),
    };
    this.emit();
  }

  play(fromIndex?: number): void {
    if (!this.state.enabled) return;
    const target = this.findNextSpeakable(fromIndex ?? this.state.activeBlockIndex ?? 0);
    if (target === null) {
      this.state = { ...this.state, playing: false };
      this.emit();
      return;
    }
    this.speakAt(target);
  }

  pause(): void {
    if (!this.state.playing) return;
    this.generation++;
    this.driver.stop();
    this.state = { ...this.state, playing: false };
    this.emit();
  }

  nextParagraph(): void {
    if (!this.state.enabled) return;
    const current = this.state.activeBlockIndex ?? -1;
    const next = this.findNextSpeakable(current + 1);
    if (next === null) return;
    if (this.state.playing) {
      this.speakAt(next);
    } else {
      this.state = { ...this.state, activeBlockIndex: next };
      this.listeners.onActiveBlockChange?.(next);
      this.emit();
    }
  }

  prevParagraph(): void {
    if (!this.state.enabled) return;
    const current = this.state.activeBlockIndex ?? 0;
    const prev = this.findPrevSpeakable(current - 1);
    if (prev === null) return;
    if (this.state.playing) {
      this.speakAt(prev);
    } else {
      this.state = { ...this.state, activeBlockIndex: prev };
      this.listeners.onActiveBlockChange?.(prev);
      this.emit();
    }
  }

  setRate(rate: number): void {
    const clamped = Math.max(0.75, Math.min(2.0, rate));
    this.state = { ...this.state, rate: clamped };
    if (this.state.playing && this.state.activeBlockIndex !== null) {
      this.speakAt(this.state.activeBlockIndex);
    } else {
      this.emit();
    }
  }

  setVoice(voice: string | undefined): void {
    this.state = { ...this.state, voice };
    if (this.state.playing && this.state.activeBlockIndex !== null) {
      this.speakAt(this.state.activeBlockIndex);
    } else {
      this.emit();
    }
  }

  dispose(): void {
    this.generation++;
    this.driver.stop();
  }

  private findNextSpeakable(start: number): number | null {
    for (let i = Math.max(0, start); i < this.blocks.length; i++) {
      if (isSpeakableBlock(this.blocks[i])) return i;
    }
    return null;
  }

  private findPrevSpeakable(start: number): number | null {
    for (let i = Math.min(start, this.blocks.length - 1); i >= 0; i--) {
      if (isSpeakableBlock(this.blocks[i])) return i;
    }
    return null;
  }

  private speakAt(index: number): void {
    const block = this.blocks[index];
    if (!block || !isSpeakableBlock(block)) return;

    this.generation++;
    const token = this.generation;
    this.driver.stop();

    this.state = {
      ...this.state,
      playing: true,
      activeBlockIndex: index,
    };
    this.listeners.onActiveBlockChange?.(index);
    this.emit();

    this.driver.speak(
      block.text,
      { rate: this.state.rate, voice: this.state.voice },
      {
        onDone: () => {
          if (token !== this.generation || !this.state.enabled) return;
          const next = this.findNextSpeakable(index + 1);
          if (next === null) {
            this.state = { ...this.state, playing: false };
            this.emit();
            this.listeners.onChapterComplete?.();
          } else {
            this.speakAt(next);
          }
        },
        onError: () => {
          if (token !== this.generation) return;
          this.state = { ...this.state, playing: false };
          this.emit();
        },
      }
    );
  }

  private emit(): void {
    this.listeners.onStateChange?.(this.getState());
  }
}

export function createExpoSpeechDriver(): SpeechDriver {
  return {
    speak(text, opts, callbacks) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Speech = require('expo-speech') as typeof import('expo-speech');
      Speech.speak(text, {
        rate: opts.rate,
        voice: opts.voice,
        onDone: callbacks.onDone,
        onStopped: callbacks.onStopped,
        onError: callbacks.onError,
      });
    },
    stop() {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Speech = require('expo-speech') as typeof import('expo-speech');
      Speech.stop();
    },
  };
}
