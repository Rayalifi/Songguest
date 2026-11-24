export type AudioPlaybackState = 'idle' | 'loading' | 'playing' | 'stopped' | 'error';

export interface AudioEngineCallbacks {
  onStateChange?: (state: AudioPlaybackState) => void;
  onPlaybackEnd?: () => void;
  onError?: (error: Error) => void;
}

// Client audio controller responsible for loading, playing, stopping, and resource cleanup.
export class AudioEngine {
  private currentAudio: HTMLAudioElement | null = null;
  private loadedTicketId: string | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private playPromise: Promise<void> | null = null;
  private state: AudioPlaybackState = 'idle';
  private callbacks: AudioEngineCallbacks = {};

  constructor(callbacks: AudioEngineCallbacks = {}) {
    this.callbacks = callbacks;
  }

  public setCallbacks(callbacks: AudioEngineCallbacks): void {
    this.callbacks = callbacks;
  }

  public getState(): AudioPlaybackState {
    return this.state;
  }

  public hasLoadedAudio(): boolean {
    return this.currentAudio !== null && Boolean(this.currentAudio.src);
  }

  public hasLoadedTicket(ticketId: string): boolean {
    return this.loadedTicketId === ticketId && this.currentAudio !== null && Boolean(this.currentAudio.src);
  }

  private setState(newState: AudioPlaybackState): void {
    this.state = newState;
    this.callbacks.onStateChange?.(newState);
  }

  // Preloads audio stream for an authorized round ticket.
  public async loadTicketAudio(ticketId: string): Promise<void> {
    if (this.loadedTicketId === ticketId && this.currentAudio && Boolean(this.currentAudio.src)) {
      return;
    }

    this.reset();
    this.setState('loading');

    const audioUrl = `/api/audio/${ticketId}`;
    const audio = new Audio();
    audio.preload = 'auto';

    return new Promise((resolve, reject) => {
      let settled = false;

      const handleCanPlay = () => {
        if (settled) return;
        settled = true;
        cleanup();
        this.loadedTicketId = ticketId;
        this.setState('idle');
        resolve();
      };

      const handleError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        this.loadedTicketId = null;
        const err = new Error(`Failed to load audio for ticket: ${ticketId}`);
        this.setState('error');
        this.callbacks.onError?.(err);
        reject(err);
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        audio.removeEventListener('canplay', handleCanPlay);
        audio.removeEventListener('canplaythrough', handleCanPlay);
        audio.removeEventListener('error', handleError);
      };

      // 4-second safety timeout so preloading never indefinitely hangs
      const timeoutId = setTimeout(() => {
        if (!settled) {
          handleCanPlay();
        }
      }, 4000);

      audio.addEventListener('canplay', handleCanPlay);
      audio.addEventListener('canplaythrough', handleCanPlay);
      audio.addEventListener('error', handleError);

      audio.src = audioUrl;
      this.currentAudio = audio;
      audio.load();

      // Handle browsers where canplay fires immediately from memory cache
      if (audio.readyState >= 2) {
        handleCanPlay();
      }
    });
  }

  // Plays audio for the target duration in seconds and pauses automatically.
  public async play(durationSec: number): Promise<void> {
    if (!this.currentAudio) {
      const err = new Error('No audio element loaded to play.');
      this.setState('error');
      this.callbacks.onError?.(err);
      throw err;
    }

    // Stop any existing timer or playback before starting
    this.clearStopTimer();

    try {
      this.currentAudio.currentTime = 0;
      this.setState('playing');
      this.playPromise = this.currentAudio.play();

      // Schedule playback stop based on the target duration configuration
      const durationMs = Math.max(50, Math.round(durationSec * 1000));
      this.stopTimer = setTimeout(() => {
        this.stop();
      }, durationMs);

      await this.playPromise;
    } catch (err: unknown) {
      // Browsers throw AbortError when play() is interrupted by pause() on short clips.
      // This is expected and normal for micro-duration clips (e.g. 0.1s).
      if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('pause') || err.message.includes('interrupted'))) {
        return;
      }
      this.setState('error');
      const errorObj = err instanceof Error ? err : new Error('Browser audio playback was blocked or failed.');
      this.callbacks.onError?.(errorObj);
      throw errorObj;
    } finally {
      this.playPromise = null;
    }
  }

  // Stops audio playback and resets playback position.
  public stop(): void {
    this.clearStopTimer();

    if (this.currentAudio && !this.currentAudio.paused) {
      if (this.playPromise) {
        this.playPromise
          .then(() => {
            if (this.currentAudio && !this.currentAudio.paused) {
              this.currentAudio.pause();
              this.currentAudio.currentTime = 0;
            }
          })
          .catch(() => {});
      } else {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
      }
    }

    if (this.state === 'playing') {
      this.setState('stopped');
      this.callbacks.onPlaybackEnd?.();
    }
  }

  // Resets audio resources, stops active timers, and cleans up media elements.
  public reset(): void {
    this.clearStopTimer();

    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.removeAttribute('src');
      this.currentAudio.load();
      this.currentAudio = null;
    }

    this.loadedTicketId = null;
    this.playPromise = null;
    this.setState('idle');
  }

  private clearStopTimer(): void {
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
  }
}

// Global singleton instance for single audio playback guarantee
export const audioEngine = new AudioEngine();
