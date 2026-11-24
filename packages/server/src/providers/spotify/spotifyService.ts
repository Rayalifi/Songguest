import { prisma } from '../../db/client.js';
import { spotifyClient } from './spotifyClient.js';
import { compositePreviewProvider } from '../preview/compositePreviewProvider.js';
import { validateSpotifyUrl } from '../../utils/validation.js';
import type { SpotifyImportResponse, SpotifyPlaylistMetadata, SpotifyTrackItem } from '@songgest/shared';

// Available local fixtures strictly for DEVELOPMENT ONLY mock mode
const DEV_MOCK_FIXTURES = [
  'fixture_synth_pop.wav',
  'fixture_rock_riff.wav',
  'fixture_funk_groove.wav',
  'fixture_jazz_chords.wav'
];

/**
 * Imports a Spotify playlist, validates preview availability through authorized preview providers,
 * and caches playable tracks in the session song pool without fake audio substitution.
 */
export async function importSpotifyPlaylist(
  rawUrl: string,
  userAccessToken?: string
): Promise<SpotifyImportResponse> {
  // 1. Validate URL & extract playlist ID safely
  const playlistId = validateSpotifyUrl(rawUrl);

  // 2. Fetch metadata from official Spotify Web API or development mock provider
  const metadata = await spotifyClient.getPlaylist(playlistId, userAccessToken);

  // 3. For live Spotify catalog: resolve authentic preview URLs using PreviewProvider architecture
  if (!metadata.isMockProvider) {
    // Process preview resolution in concurrent batches to respect rate limits and keep latency low
    const BATCH_SIZE = 8;
    for (let i = 0; i < metadata.tracks.length; i += BATCH_SIZE) {
      const batch = metadata.tracks.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (track) => {
          // If Spotify already supplied a preview URL, use it
          if (track.previewUrl) {
            track.hasPlayablePreview = true;
            track.previewProvider = 'spotify';
            return;
          }

          // Otherwise, query authorized external preview sources (iTunes / Deezer)
          const previewResult = await compositePreviewProvider.findPreview({
            id: track.id,
            title: track.title,
            artist: track.artist,
            album: track.album,
            releaseYear: track.releaseYear,
            spotifyPreviewUrl: track.previewUrl
          });

          if (previewResult.available && previewResult.previewUrl) {
            track.hasPlayablePreview = true;
            track.previewUrl = previewResult.previewUrl;
            track.previewProvider = previewResult.provider;
          } else {
            // Truly unavailable; do NOT substitute fake audio!
            track.hasPlayablePreview = false;
            track.previewUrl = undefined;
            track.previewProvider = undefined;
          }
        })
      );
    }
  }

  // Calculate playable and unavailable counts truthfully
  const playableTracks = metadata.tracks.filter((t) => t.hasPlayablePreview);
  const unavailableTracks = metadata.tracks.filter((t) => !t.hasPlayablePreview);

  metadata.playableCount = playableTracks.length;
  metadata.unplayableCount = unavailableTracks.length;

  if (playableTracks.length === 0) {
    const error = new Error('No tracks with playable previews were found in this playlist.');
    (error as unknown as { code: string }).code = 'NO_PLAYABLE_TRACKS';
    throw error;
  }

  // 4. Persist playable tracks into database cache for the playlist game pool
  let devFixtureIdx = 0;
  for (const track of playableTracks) {
    const dbSongId = `spotify_${playlistId}_${track.id}`;

    // For mock development mode only, associate local dev fixture
    const devFixture = metadata.isMockProvider
      ? DEV_MOCK_FIXTURES[devFixtureIdx % DEV_MOCK_FIXTURES.length]
      : null;
    devFixtureIdx++;

    const genre = metadata.genres[devFixtureIdx % metadata.genres.length] || 'Pop';
    const previewExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2-hour preview cache validity

    await prisma.song.upsert({
      where: { id: dbSongId },
      update: {
        title: track.title,
        artist: track.artist,
        album: track.album || undefined,
        releaseYear: track.releaseYear,
        genre,
        popularityScore: track.popularityScore,
        audioFixturePath: devFixture, // null in production, only set for dev mock mode
        previewUrl: track.previewUrl || null,
        previewProvider: track.previewProvider || (metadata.isMockProvider ? 'local-fixture-dev-only' : 'spotify'),
        previewExpiresAt,
        externalUrl: track.externalSpotifyUrl || `https://open.spotify.com/track/${track.id}`,
        albumArtUrl: track.albumArtUrl || null,
        previewOffsetSec: 0.0,
        provider: metadata.isMockProvider ? 'spotify-mock-dev' : 'spotify',
        providerSongId: track.id,
        spotifyTrackId: track.id,
        spotifyPlaylistId: playlistId
      },
      create: {
        id: dbSongId,
        title: track.title,
        artist: track.artist,
        album: track.album || undefined,
        releaseYear: track.releaseYear,
        genre,
        subgenres: '',
        language: 'en',
        popularityScore: track.popularityScore,
        audioFixturePath: devFixture, // null in production, only set for dev mock mode
        previewUrl: track.previewUrl || null,
        previewProvider: track.previewProvider || (metadata.isMockProvider ? 'local-fixture-dev-only' : 'spotify'),
        previewExpiresAt,
        externalUrl: track.externalSpotifyUrl || `https://open.spotify.com/track/${track.id}`,
        albumArtUrl: track.albumArtUrl || null,
        previewOffsetSec: 0.0,
        provider: metadata.isMockProvider ? 'spotify-mock-dev' : 'spotify',
        providerSongId: track.id,
        spotifyTrackId: track.id,
        spotifyPlaylistId: playlistId
      }
    });
  }

  return {
    success: true,
    playlist: {
      id: metadata.id,
      name: metadata.name,
      spotifyUrl: metadata.spotifyUrl,
      description: metadata.description,
      ownerName: metadata.ownerName,
      artists: metadata.artists,
      genres: metadata.genres,
      yearMin: metadata.yearMin,
      yearMax: metadata.yearMax,
      totalTracks: metadata.totalTracks,
      playableCount: playableTracks.length,
      unplayableCount: unavailableTracks.length,
      tracks: metadata.tracks,
      isMockProvider: metadata.isMockProvider,
      notice: metadata.notice
    },
    totalTracks: metadata.totalTracks,
    playableTracks: playableTracks.length,
    unavailableTracks: unavailableTracks.length,
    tracks: metadata.tracks,
    isMockProvider: metadata.isMockProvider,
    notice: metadata.notice
  };
}

/**
 * Retrieves cached imported playlist metadata from local database.
 */
export async function getImportedPlaylist(playlistId: string): Promise<SpotifyPlaylistMetadata | null> {
  const songs = await prisma.song.findMany({
    where: { spotifyPlaylistId: playlistId }
  });

  if (songs.length === 0) {
    return null;
  }

  const artistsSet = new Set<string>();
  const genresSet = new Set<string>();
  let minYear = 2050;
  let maxYear = 1900;

  const tracks: SpotifyTrackItem[] = songs.map((s) => {
    artistsSet.add(s.artist);
    if (s.genre) genresSet.add(s.genre);
    if (s.releaseYear < minYear) minYear = s.releaseYear;
    if (s.releaseYear > maxYear) maxYear = s.releaseYear;

    const hasPlayable = Boolean(s.previewUrl || s.audioFixturePath);

    return {
      id: s.spotifyTrackId || s.id,
      title: s.title,
      artist: s.artist,
      album: s.album || undefined,
      releaseYear: s.releaseYear,
      popularityScore: s.popularityScore,
      hasPlayablePreview: hasPlayable,
      previewUrl: s.previewUrl || undefined,
      previewProvider: s.previewProvider || undefined,
      externalSpotifyUrl: s.externalUrl || `https://open.spotify.com/track/${s.spotifyTrackId || s.id}`,
      albumArtUrl: s.albumArtUrl || undefined
    };
  });

  const playableCount = tracks.filter((t) => t.hasPlayablePreview).length;
  const unplayableCount = tracks.length - playableCount;

  return {
    id: playlistId,
    name: `Imported Playlist (${playlistId})`,
    spotifyUrl: `https://open.spotify.com/playlist/${playlistId}`,
    totalTracks: tracks.length,
    playableCount,
    unplayableCount,
    artists: Array.from(artistsSet).slice(0, 10),
    genres: Array.from(genresSet),
    yearMin: minYear <= maxYear ? minYear : 1970,
    yearMax: minYear <= maxYear ? maxYear : 2024,
    tracks,
    isMockProvider: songs.some((s) => s.provider === 'spotify-mock-dev')
  };
}
