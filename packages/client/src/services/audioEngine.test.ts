import { describe, expect, it, vi } from 'vitest';
import { AudioEngine } from './audioEngine.js';

describe('Client AudioEngine Service', () => {
  it('initializes in idle state', () => {
    const engine = new AudioEngine();
    expect(engine.getState()).toBe('idle');
  });

  it('throws an error and updates state when play is called without loaded audio', async () => {
    const onError = vi.fn();
    const engine = new AudioEngine({ onError });

    await expect(engine.play(0.5)).rejects.toThrow('No audio element loaded to play.');
    expect(engine.getState()).toBe('error');
    expect(onError).toHaveBeenCalled();
  });

  it('resets state and cleans up resources cleanly', () => {
    const onStateChange = vi.fn();
    const engine = new AudioEngine({ onStateChange });

    engine.reset();
    expect(engine.getState()).toBe('idle');
  });
});
