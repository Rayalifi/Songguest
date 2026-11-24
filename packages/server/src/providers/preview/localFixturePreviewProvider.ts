import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { PreviewProvider, PreviewResult, PreviewTrackInput } from '@songgest/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../../fixtures/audio');

/**
 * DEVELOPMENT ONLY: Local fixture preview provider.
 * Strictly used for automated test suites and offline development.
 * Never used to represent real Spotify tracks in production.
 */
export class LocalFixturePreviewProvider implements PreviewProvider {
  public readonly providerId = 'local-fixtures-dev-only';

  public async findPreview(track: PreviewTrackInput): Promise<PreviewResult> {
    // Only resolve if a local fixture exists for this ID
    const possibleFiles = [
      `${track.id}.wav`,
      'fixture_synth_pop.wav',
      'fixture_rock_riff.wav',
      'fixture_funk_groove.wav',
      'fixture_jazz_chords.wav'
    ];

    for (const file of possibleFiles) {
      const fullPath = path.join(FIXTURES_DIR, file);
      if (fs.existsSync(fullPath)) {
        return {
          available: true,
          previewUrl: `/api/audio/fixture/${file}`,
          provider: 'local-fixture-dev-only',
          format: 'audio/wav'
        };
      }
    }

    return { available: false };
  }
}

export const localFixturePreviewProvider = new LocalFixturePreviewProvider();
