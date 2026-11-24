import { prisma } from '../db/client.js';
import {
  DIFFICULTY_CONFIGS,
  getDifficultyFromPopularity
} from '@songgest/shared';
import type {
  DifficultyLevel,
  FilterOptionsPayload,
  Song,
  SongAutocompleteItem,
  SongQueryFilter
} from '@songgest/shared';
import { musicProviderRegistry } from '../providers/musicProvider.js';

// Builds Prisma where clause from multi-dimensional song filter parameters.
export function buildSongWhereClause(filter: SongQueryFilter) {
  const where: Record<string, unknown> = {};

  // Isolate core catalog from imported Spotify playlists
  if (filter.playlistId !== undefined) {
    where.spotifyPlaylistId = filter.playlistId;
  } else {
    where.spotifyPlaylistId = null;
  }

  // Difficulty mapped to popularity boundaries
  if (filter.difficulty) {
    const diffConfig = DIFFICULTY_CONFIGS[filter.difficulty as DifficultyLevel];
    if (diffConfig) {
      where.popularityScore = {
        gte: diffConfig.popularityMin,
        lte: diffConfig.popularityMax
      };
    }
  } else if (filter.popularityMin !== undefined || filter.popularityMax !== undefined) {
    const popCondition: Record<string, number> = {};
    if (filter.popularityMin !== undefined) popCondition.gte = filter.popularityMin;
    if (filter.popularityMax !== undefined) popCondition.lte = filter.popularityMax;
    where.popularityScore = popCondition;
  }

  // Genre filter
  if (filter.genre && filter.genre !== 'all') {
    where.genre = filter.genre;
  }

  // Artist filter
  if (filter.artist) {
    where.artist = { contains: filter.artist };
  }

  // Language filter
  if (filter.language && filter.language !== 'all') {
    where.language = filter.language;
  }

  // Release year range
  if (filter.yearMin !== undefined || filter.yearMax !== undefined) {
    const yearCondition: Record<string, number> = {};
    if (filter.yearMin !== undefined) yearCondition.gte = filter.yearMin;
    if (filter.yearMax !== undefined) yearCondition.lte = filter.yearMax;
    where.releaseYear = yearCondition;
  }

  // Free text search matching title or artist
  if (filter.search && filter.search.trim().length > 0) {
    const term = filter.search.trim();
    where.OR = [
      { title: { contains: term } },
      { artist: { contains: term } }
    ];
  }

  return where;
}

// Queries catalog songs with combined server-side filters and pagination.
export async function queryCatalogSongs(filter: SongQueryFilter = {}) {
  const where = buildSongWhereClause(filter);
  const limit = Math.min(100, Math.max(1, filter.limit ?? 20));
  const offset = Math.max(0, filter.offset ?? 0);

  const [totalCount, records] = await Promise.all([
    prisma.song.count({ where }),
    prisma.song.findMany({
      where,
      skip: offset,
      take: limit,
      orderBy: { popularityScore: 'desc' }
    })
  ]);

  const songs: Song[] = records.map((s) => ({
    id: s.id,
    title: s.title,
    artist: s.artist,
    album: s.album ?? undefined,
    releaseYear: s.releaseYear,
    genre: s.genre,
    subgenres: s.subgenres ? s.subgenres.split(',').map((tag) => tag.trim()) : [],
    language: s.language,
    popularityScore: s.popularityScore,
    difficulty: getDifficultyFromPopularity(s.popularityScore),
    previewUrl: s.previewUrl ?? (s.audioFixturePath ? `/api/audio/fixture/${s.audioFixturePath}` : ''),
    previewOffsetSec: s.previewOffsetSec,
    albumArtUrl: s.albumArtUrl ?? undefined,
    externalUrl: s.externalUrl ?? undefined
  }));

  return {
    total: totalCount,
    limit,
    offset,
    songs
  };
}

// Searches song catalog for autocomplete suggestions by title or artist.
export async function searchSongCatalog(queryText: string, limit = 8): Promise<SongAutocompleteItem[]> {
  const trimmed = queryText.trim();
  if (!trimmed) return [];

  // If Deezer is active provider, query Deezer search for live song suggestions
  if (musicProviderRegistry.getActiveProvider().providerId === 'deezer') {
    try {
      const deezerSongs = await musicProviderRegistry.getActiveProvider().searchSongs(trimmed, { limit });
      if (deezerSongs.length > 0) {
        return deezerSongs.map((s) => ({
          id: `deezer_${s.id}`,
          title: s.title,
          artist: s.artist,
          displayText: `${s.title} (${s.artist})`
        }));
      }
    } catch {
      // Fallback to local DB search
    }
  }

  const records = await prisma.song.findMany({
    where: {
      OR: [
        { title: { contains: trimmed } },
        { artist: { contains: trimmed } }
      ]
    },
    take: limit,
    orderBy: { popularityScore: 'desc' }
  });

  return records.map((s) => ({
    id: s.id,
    title: s.title,
    artist: s.artist,
    displayText: `${s.title} (${s.artist})`
  }));
}

// Aggregates distinct filter facets available in the song database.
export async function getCatalogFilterOptions(): Promise<FilterOptionsPayload> {
  const songs = await prisma.song.findMany({
    where: { spotifyPlaylistId: null },
    select: {
      genre: true,
      language: true,
      artist: true,
      releaseYear: true
    }
  });

  const genresSet = new Set<string>();
  const languagesSet = new Set<string>();
  const artistsSet = new Set<string>();
  let minYear = 2050;
  let maxYear = 1900;

  for (const s of songs) {
    if (s.genre) genresSet.add(s.genre);
    if (s.language) languagesSet.add(s.language);
    if (s.artist) artistsSet.add(s.artist);
    if (s.releaseYear > 0 && s.releaseYear < minYear) minYear = s.releaseYear;
    if (s.releaseYear > 0 && s.releaseYear > maxYear) maxYear = s.releaseYear;
  }

  // If Deezer metadata provider is active, expose full curated genres and era bounds
  if (musicProviderRegistry.getActiveProvider().providerId === 'deezer') {
    const deezerGenres = [
      'Alternative', 'Classical', 'Country', 'Dance / EDM', 'Folk',
      'Hip Hop / Rap', 'Jazz', 'Latin', 'Metal', 'Pop', 'R&B', 'Reggae', 'Rock'
    ];
    for (const g of deezerGenres) genresSet.add(g);
    minYear = 1960;
    maxYear = 2026;
  }

  return {
    genres: Array.from(genresSet).sort(),
    languages: Array.from(languagesSet).sort(),
    artists: Array.from(artistsSet).sort(),
    yearMin: minYear <= maxYear ? minYear : 1960,
    yearMax: minYear <= maxYear ? maxYear : 2026
  };
}
