import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../db/client.js';
import type {
  MusicProvider,
  PlayablePreviewResult,
  ProviderSearchOptions,
  ProviderSongMetadata,
  Song
} from '@songgest/shared';
import { getDifficultyFromPopularity } from '@songgest/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures/audio');

export class LocalFixtureProvider implements MusicProvider {
  public readonly providerId = 'local-fixtures';

  public async searchSongs(query: string, options?: ProviderSearchOptions): Promise<Song[]> {
    const whereClause: Record<string, unknown> = {};

    if (query.trim()) {
      whereClause.OR = [
        { title: { contains: query } },
        { artist: { contains: query } }
      ];
    }

    if (options?.genre && options.genre !== 'all') {
      whereClause.genre = options.genre;
    }

    if (options?.artist) {
      whereClause.artist = { contains: options.artist };
    }

    if (options?.language && options.language !== 'all') {
      whereClause.language = options.language;
    }

    if (options?.yearMin !== undefined || options?.yearMax !== undefined) {
      const yearCond: Record<string, number> = {};
      if (options.yearMin !== undefined) yearCond.gte = options.yearMin;
      if (options.yearMax !== undefined) yearCond.lte = options.yearMax;
      whereClause.releaseYear = yearCond;
    }

    const records = await prisma.song.findMany({
      where: whereClause,
      take: options?.limit ?? 20,
      skip: options?.offset ?? 0
    });

    return records.map((r) => ({
      id: r.id,
      title: r.title,
      artist: r.artist,
      album: r.album ?? undefined,
      releaseYear: r.releaseYear,
      genre: r.genre,
      subgenres: r.subgenres ? r.subgenres.split(',').map((s) => s.trim()) : [],
      language: r.language,
      popularityScore: r.popularityScore,
      difficulty: getDifficultyFromPopularity(r.popularityScore),
      previewUrl: `/api/audio/fixture/${r.id}`,
      previewOffsetSec: r.previewOffsetSec
    }));
  }

  public async getSongMetadata(providerTrackId: string): Promise<ProviderSongMetadata | null> {
    const record = await prisma.song.findUnique({
      where: { id: providerTrackId }
    });

    if (!record) return null;

    return {
      id: record.id,
      title: record.title,
      artist: record.artist,
      album: record.album ?? undefined,
      releaseYear: record.releaseYear,
      genre: record.genre,
      subgenres: record.subgenres ? record.subgenres.split(',').map((s) => s.trim()) : [],
      language: record.language,
      popularityScore: record.popularityScore,
      durationMs: 30000 // Standard 30s local preview
    };
  }

  public async getPlayablePreview(providerTrackId: string): Promise<PlayablePreviewResult | null> {
    const record = await prisma.song.findUnique({
      where: { id: providerTrackId }
    });

    if (!record || !record.audioFixturePath) return null;

    const fixturePath = path.join(FIXTURES_DIR, record.audioFixturePath);
    if (!fs.existsSync(fixturePath)) {
      return null;
    }

    return {
      previewUrl: `/api/audio/fixture/${record.id}`,
      previewOffsetSec: record.previewOffsetSec,
      durationSec: 30.0,
      format: 'audio/wav',
      isLocalFixture: true
    };
  }

  public async validatePreviewAvailability(providerTrackId: string): Promise<boolean> {
    const record = await prisma.song.findUnique({
      where: { id: providerTrackId }
    });

    if (!record || !record.audioFixturePath) return false;

    const fixturePath = path.join(FIXTURES_DIR, record.audioFixturePath);
    return fs.existsSync(fixturePath);
  }
}

export const localFixtureProvider = new LocalFixtureProvider();
