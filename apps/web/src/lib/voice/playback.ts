/**
 * Spoken answers, in order, that can be stopped at once.
 *
 * Each answer gets a new generation. Chunks are prepared ahead (a provider fetches audio while
 * the previous sentence plays) but played strictly in the order queued, and a chunk from an older
 * generation is never played: interrupting bumps the generation and aborts what is in flight, so
 * stale audio can't start after a newer answer begins.
 */

export interface SpeechOutput<Prepared> {
  /** Get a chunk ready to play (fetch its audio, for a provider). */
  prepare(text: string, signal: AbortSignal): Promise<Prepared>;
  /** Play a prepared chunk; resolves when it finishes, or when `signal` aborts. */
  play(prepared: Prepared, signal: AbortSignal): Promise<void>;
  pause(): void;
  resume(): void;
  /** Stop anything playing now. */
  stop(): void;
  /** Free a chunk that won't be played. */
  release?(prepared: Prepared): void;
}

type Item<Prepared> = { text: string; ready: Promise<Prepared> };

export type PlaybackCallbacks = {
  /** A chunk began playing (the first one marks when the answer is heard). */
  onStart?: (text: string) => void;
  /** Everything queued has been played. */
  onIdle?: () => void;
  onError?: (error: unknown) => void;
};

/** How many chunks are prepared ahead of the one playing. */
const LOOKAHEAD = 2;

export class SpeechQueue<Prepared> {
  private generation = 0;
  private items: Item<Prepared>[] = [];
  private pending: string[] = [];
  private controller = new AbortController();
  private running = false;
  private pausedFlag = false;

  constructor(
    private readonly output: SpeechOutput<Prepared>,
    private readonly callbacks: PlaybackCallbacks = {},
  ) {}

  get busy(): boolean {
    return this.running;
  }

  get paused(): boolean {
    return this.pausedFlag;
  }

  get currentGeneration(): number {
    return this.generation;
  }

  /** Queue a chunk of the current answer. */
  enqueue(text: string): void {
    if (!text.trim()) return;
    this.pending.push(text);
    this.fill();
    if (!this.running) void this.run(this.generation);
  }

  /** Stop at once and drop everything queued; returns the new generation. */
  cancel(): number {
    this.generation += 1;
    this.controller.abort();
    this.controller = new AbortController();
    for (const item of this.items) {
      void item.ready.then((prepared) => this.output.release?.(prepared)).catch(() => undefined);
    }
    this.items = [];
    this.pending = [];
    this.output.stop();
    if (this.pausedFlag) {
      this.pausedFlag = false;
      this.output.resume();
    }
    return this.generation;
  }

  pause(): void {
    if (!this.running || this.pausedFlag) return;
    this.pausedFlag = true;
    this.output.pause();
  }

  resume(): void {
    if (!this.pausedFlag) return;
    this.pausedFlag = false;
    this.output.resume();
  }

  private fill(): void {
    const signal = this.controller.signal;
    while (this.items.length < LOOKAHEAD + 1 && this.pending.length > 0) {
      const text = this.pending.shift() as string;
      const ready = this.output.prepare(text, signal);
      // Failures surface when the item's turn comes; don't leave an unhandled rejection.
      ready.catch(() => undefined);
      this.items.push({ text, ready });
    }
  }

  private async run(generation: number): Promise<void> {
    this.running = true;
    try {
      while (generation === this.generation && this.items.length > 0) {
        const item = this.items.shift() as Item<Prepared>;
        this.fill();
        const signal = this.controller.signal;
        let prepared: Prepared;
        try {
          prepared = await item.ready;
        } catch (error) {
          if (generation === this.generation && !signal.aborted) this.callbacks.onError?.(error);
          continue;
        }
        if (generation !== this.generation || signal.aborted) {
          this.output.release?.(prepared);
          break;
        }
        this.callbacks.onStart?.(item.text);
        try {
          await this.output.play(prepared, signal);
        } catch (error) {
          if (generation === this.generation && !signal.aborted) this.callbacks.onError?.(error);
        } finally {
          this.output.release?.(prepared);
        }
      }
    } finally {
      if (generation === this.generation) {
        this.running = false;
        this.callbacks.onIdle?.();
      } else if (this.items.length > 0 || this.pending.length > 0) {
        // A newer answer was queued while this loop wound down: play it.
        void this.run(this.generation);
      } else {
        this.running = false;
      }
    }
  }
}
