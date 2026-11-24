import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DeezerMetadataProvider,
  deezerMetadataProvider,
  DEEZER_GENRE_MAP,
  type DeezerTrackItem
} from './providers/deezerMetadataProvider.js';
import { musicProviderRegistry, localFixtureProvider } from './providers/index.js';
import { createGameSession, createNextRoundTicket } from './services/sessionService.js';
import { prisma } from './db/client.js';

describe('DeezerMetadataProvider Unit & Integration Tests', () => {
  // Sample realistic Deezer track item for tests
  const mockDeezerTrack: DeezerTrackItem = {
    id: 4091937401,
    title: 'Bohemian Rhapsody',
    title_short: 'Bohemian Rhapsody',
    link: 'https://www.deezer.com/track/4091937401',
    duration: 354,
    rank: 958949,
    release_date: '1975-11-21',
    isrc: 'GBUM71029604',
    preview: 'https://cdnt-preview.dzcdn.net/api/1/1/5/f/9/0/mock_preview.mp3',
    artist: {
      id: 412,
      name: 'Queen',
      picture_medium: 'https://cdn-images.dzcdn.net/images/artist/queen_medium.jpg'
    },
    album: {
      id: 1007321681,
      title: 'A Night At The Opera',
      cover_medium: 'https://cdn-images.dzcdn.net/images/cover/opera_250x250.jpg',
      cover_big: 'https://cdn-images.dzcdn.net/images/cover/opera_500x500.jpg',
      release_date: '1975-11-21'
    },
    genres: {
      data: [
        { id: 152, name: 'Rock' },
        { id: 85, name: 'Classic Rock' }
      ]
    }
  };

  beforeEach(() => {
    deezerMetadataProvider.clearCache();
    musicProviderRegistry.resetActiveProvider();
  });

  afterEach(() => {
    musicProviderRegistry.resetActiveProvider();
    vi.restoreAllMocks();
  });

  describe('TASK 4: Metadata Mapping', () => {
    it('correctly maps full Deezer track item to Song interface', () => {
      const provider = new DeezerMetadataProvider();
      const song = provider.mapTrackToSong(mockDeezerTrack, 'Rock');

      expect(song).not.toBeNull();
      expect(song!.id).toBe('4091937401');
      expect(song!.title).toBe('Bohemian Rhapsody');
      expect(song!.artist).toBe('Queen');
      expect(song!.album).toBe('A Night At The Opera');
      expect(song!.releaseYear).toBe(1975);
      expect(song!.genre).toBe('Rock');
      expect(song!.subgenres).toEqual(['Classic Rock']);
      expect(song!.language).toBe('en');
      expect(song!.popularityScore).toBe(96); // 958949 / 10000 = 96
      expect(song!.difficulty).toBe('easy');
      expect(song!.previewUrl).toBe('https://cdnt-preview.dzcdn.net/api/1/1/5/f/9/0/mock_preview.mp3');
      expect(song!.albumArtUrl).toBe('https://cdn-images.dzcdn.net/images/cover/opera_250x250.jpg');
      expect(song!.externalUrl).toBe('https://www.deezer.com/track/4091937401');
      expect(song!.previewOffsetSec).toBe(0.0);
    });

    it('correctly maps full Deezer track item to ProviderSongMetadata interface', () => {
      const provider = new DeezerMetadataProvider();
      const metadata = provider.mapTrackToMetadata(mockDeezerTrack);

      expect(metadata).not.toBeNull();
      expect(metadata!.id).toBe('4091937401');
      expect(metadata!.isrc).toBe('GBUM71029604');
      expect(metadata!.title).toBe('Bohemian Rhapsody');
      expect(metadata!.artist).toBe('Queen');
      expect(metadata!.album).toBe('A Night At The Opera');
      expect(metadata!.releaseYear).toBe(1975);
      expect(metadata!.genre).toBe('Rock');
      expect(metadata!.subgenres).toEqual(['Classic Rock']);
      expect(metadata!.popularityScore).toBe(96);
      expect(metadata!.durationMs).toBe(354000);
      expect(metadata!.albumArtUrl).toBe('https://cdn-images.dzcdn.net/images/cover/opera_250x250.jpg');
      expect(metadata!.externalUrl).toBe('https://www.deezer.com/track/4091937401');
    });

    it('falls back to album release_date when track release_date is missing', () => {
      const provider = new DeezerMetadataProvider();
      const trackWithoutRelease: DeezerTrackItem = {
        ...mockDeezerTrack,
        release_date: undefined,
        album: {
          ...mockDeezerTrack.album,
          release_date: '1984-02-27'
        }
      };

      const song = provider.mapTrackToSong(trackWithoutRelease);
      expect(song!.releaseYear).toBe(1984);
    });

    it('calculates difficulty tiers accurately from popularity rank', () => {
      const provider = new DeezerMetadataProvider();

      const easyTrack = provider.mapTrackToSong({ ...mockDeezerTrack, rank: 900000 });
      expect(easyTrack!.difficulty).toBe('easy');
      expect(easyTrack!.popularityScore).toBe(90);

      const mediumTrack = provider.mapTrackToSong({ ...mockDeezerTrack, rank: 700000 });
      expect(mediumTrack!.difficulty).toBe('medium');
      expect(mediumTrack!.popularityScore).toBe(70);

      const hardTrack = provider.mapTrackToSong({ ...mockDeezerTrack, rank: 500000 });
      expect(hardTrack!.difficulty).toBe('hard');
      expect(hardTrack!.popularityScore).toBe(50);

      const expertTrack = provider.mapTrackToSong({ ...mockDeezerTrack, rank: 300000 });
      expect(expertTrack!.difficulty).toBe('expert');
      expect(expertTrack!.popularityScore).toBe(30);

      const impossibleTrack = provider.mapTrackToSong({ ...mockDeezerTrack, rank: 100000 });
      expect(impossibleTrack!.difficulty).toBe('impossible');
      expect(impossibleTrack!.popularityScore).toBe(10);
    });
  });

  describe('Missing Metadata Handling', () => {
    it('handles track with missing album without throwing', () => {
      const provider = new DeezerMetadataProvider();
      const trackNoAlbum: DeezerTrackItem = {
        id: 12345,
        title: 'Single Track',
        rank: 600000,
        preview: 'https://preview.com/audio.mp3',
        artist: { name: 'Solo Artist' }
      };

      const song = provider.mapTrackToSong(trackNoAlbum);
      expect(song).not.toBeNull();
      expect(song!.title).toBe('Single Track');
      expect(song!.artist).toBe('Solo Artist');
      expect(song!.album).toBeUndefined();
      expect(song!.albumArtUrl).toBeUndefined();
      expect(song!.releaseYear).toBe(0);
    });

    it('handles track with missing artist by falling back to Unknown Artist', () => {
      const provider = new DeezerMetadataProvider();
      const trackNoArtist: DeezerTrackItem = {
        id: 12345,
        title: 'Mysterious Song',
        preview: 'https://preview.com/audio.mp3'
      };

      const song = provider.mapTrackToSong(trackNoArtist);
      expect(song).not.toBeNull();
      expect(song!.artist).toBe('Unknown Artist');
    });

    it('returns null when id or title is completely missing', () => {
      const provider = new DeezerMetadataProvider();
      expect(provider.mapTrackToSong(null as any)).toBeNull();
      expect(provider.mapTrackToSong({} as any)).toBeNull();
      expect(provider.mapTrackToSong({ id: 0, title: '' } as any)).toBeNull();

      expect(provider.mapTrackToMetadata(null as any)).toBeNull();
      expect(provider.mapTrackToMetadata({} as any)).toBeNull();
    });

    it('getSongMetadata returns null for invalid or empty track ID', async () => {
      const provider = new DeezerMetadataProvider();
      expect(await provider.getSongMetadata('')).toBeNull();
      expect(await provider.getSongMetadata('undefined')).toBeNull();
      expect(await provider.getSongMetadata('null')).toBeNull();
    });
  });

  describe('TASK 5: Unavailable Previews & Separation of Concerns', () => {
    it('excludes tracks with missing or empty preview from searchSongs', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 1,
              title: 'Playable Song',
              rank: 800000,
              preview: 'https://cdnt.dzcdn.net/preview.mp3',
              artist: { name: 'Band A' }
            },
            {
              id: 2,
              title: 'Unplayable Song (no preview)',
              rank: 850000,
              preview: '', // empty preview
              artist: { name: 'Band B' }
            },
            {
              id: 3,
              title: 'Unplayable Song (undefined preview)',
              rank: 900000,
              preview: undefined,
              artist: { name: 'Band C' }
            }
          ]
        })
      });

      const provider = new DeezerMetadataProvider({ fetchFn: mockFetch as any });
      const results = await provider.searchSongs('Rock');

      // Only the track with valid preview is returned
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('1');
      expect(results[0].title).toBe('Playable Song');
    });

    it('getPlayablePreview returns null when preview is unavailable', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 999,
          title: 'Track Without Preview',
          preview: null // No preview
        })
      });

      const provider = new DeezerMetadataProvider({ fetchFn: mockFetch as any });
      const preview = await provider.getPlayablePreview('999');

      expect(preview).toBeNull();
    });

    it('validatePreviewAvailability returns false when preview is unavailable', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 999,
          title: 'Track Without Preview',
          preview: ''
        })
      });

      const provider = new DeezerMetadataProvider({ fetchFn: mockFetch as any });
      const isAvailable = await provider.validatePreviewAvailability('999');

      expect(isAvailable).toBe(false);
    });

    it('getPlayablePreview returns correct streamable preview structure when available', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockDeezerTrack
      });

      const provider = new DeezerMetadataProvider({ fetchFn: mockFetch as any });
      const preview = await provider.getPlayablePreview('4091937401');

      expect(preview).not.toBeNull();
      expect(preview!.previewUrl).toBe('https://cdnt-preview.dzcdn.net/api/1/1/5/f/9/0/mock_preview.mp3');
      expect(preview!.format).toBe('audio/mpeg');
      expect(preview!.durationSec).toBe(30.0);
      expect(preview!.isLocalFixture).toBe(false); // MUST NOT be marked as local fixture!
      expect(preview!.previewOffsetSec).toBe(0.0);
    });
  });

  describe('Filtering Functionality', () => {
    const multiTracks: DeezerTrackItem[] = [
      {
        id: 101,
        title: '1970s Classic Rock',
        rank: 850000, // popularity: 85 (easy)
        release_date: '1975-06-01',
        preview: 'https://preview/101.mp3',
        artist: { name: 'Queen' },
        album: { title: '70s Album' }
      },
      {
        id: 102,
        title: '1980s Rock Anthem',
        rank: 650000, // popularity: 65 (medium)
        release_date: '1984-03-15',
        preview: 'https://preview/102.mp3',
        artist: { name: 'Queen' },
        album: { title: '80s Album' }
      },
      {
        id: 103,
        title: '1990s Deep Cut',
        rank: 450000, // popularity: 45 (hard)
        release_date: '1995-10-20',
        preview: 'https://preview/103.mp3',
        artist: { name: 'Queen' },
        album: { title: '90s Album' }
      },
      {
        id: 104,
        title: '2000s Pop Hit',
        rank: 750000, // popularity: 75 (medium)
        release_date: '2005-08-12',
        preview: 'https://preview/104.mp3',
        artist: { name: 'Other Artist' },
        album: { title: '2000s Album' }
      }
    ];

    it('filters songs by release year range (yearMin and yearMax)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: multiTracks })
      });

      const provider = new DeezerMetadataProvider({ fetchFn: mockFetch as any });

      // Filter for the 1980s (1980 - 1989)
      const results80s = await provider.searchSongs('Queen', { yearMin: 1980, yearMax: 1989 });
      expect(results80s).toHaveLength(1);
      expect(results80s[0].title).toBe('1980s Rock Anthem');
      expect(results80s[0].releaseYear).toBe(1984);

      // Filter for 1970 - 1985
      const results70to85 = await provider.searchSongs('Queen', { yearMin: 1970, yearMax: 1985 });
      expect(results70to85).toHaveLength(2);
      expect(results70to85.map((s) => s.id)).toEqual(['101', '102']);
    });

    it('filters songs by difficulty level', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: multiTracks })
      });

      const provider = new DeezerMetadataProvider({ fetchFn: mockFetch as any });

      // Easy tier: 80 - 100
      const easySongs = await provider.searchSongs('', { difficulty: 'easy' });
      expect(easySongs).toHaveLength(1);
      expect(easySongs[0].title).toBe('1970s Classic Rock');

      // Medium tier: 60 - 79
      const mediumSongs = await provider.searchSongs('', { difficulty: 'medium' });
      expect(mediumSongs).toHaveLength(2);
      expect(mediumSongs.map((s) => s.id)).toEqual(['102', '104']);

      // Hard tier: 40 - 59
      const hardSongs = await provider.searchSongs('', { difficulty: 'hard' });
      expect(hardSongs).toHaveLength(1);
      expect(hardSongs[0].title).toBe('1990s Deep Cut');
    });

    it('targets appropriate Deezer chart URL when genre is specified', async () => {
      let requestedUrl = '';
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        requestedUrl = url;
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [mockDeezerTrack] })
        });
      });

      const provider = new DeezerMetadataProvider({ fetchFn: mockFetch as any });

      // Rock genre maps to 152
      await provider.searchSongs('', { genre: 'Rock' });
      expect(requestedUrl).toContain('/chart/152/tracks');

      // Electronic genre maps to 106
      await provider.searchSongs('', { genre: 'Electronic' });
      expect(requestedUrl).toContain('/chart/106/tracks');

      // Global chart when genre is all or any
      await provider.searchSongs('', { genre: 'all' });
      expect(requestedUrl).toContain('/chart/0/tracks');
    });
  });

  describe('Error & Rate Limit Handling', () => {
    it('gracefully handles network error / timeout without throwing unhandled exceptions', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network connection aborted'));
      const provider = new DeezerMetadataProvider({ fetchFn: mockFetch as any });

      const songs = await provider.searchSongs('test');
      expect(songs).toEqual([]);

      const metadata = await provider.getSongMetadata('123');
      expect(metadata).toBeNull();

      const preview = await provider.getPlayablePreview('123');
      expect(preview).toBeNull();

      const available = await provider.validatePreviewAvailability('123');
      expect(available).toBe(false);
    });

    it('handles HTTP 500 error gracefully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });
      const provider = new DeezerMetadataProvider({ fetchFn: mockFetch as any });

      const songs = await provider.searchSongs('test');
      expect(songs).toEqual([]);

      const metadata = await provider.getSongMetadata('123');
      expect(metadata).toBeNull();
    });

    it('handles Deezer Quota limit exceeded error gracefully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          error: {
            type: 'OAuthException',
            message: 'Quota limit exceeded',
            code: 4
          }
        })
      });
      const provider = new DeezerMetadataProvider({ fetchFn: mockFetch as any });

      const songs = await provider.searchSongs('test');
      expect(songs).toEqual([]);

      const metadata = await provider.getSongMetadata('123');
      expect(metadata).toBeNull();
    });
  });

  describe('MusicProviderRegistry & Active Provider Switching', () => {
    it('registers both local-fixtures and deezer providers', () => {
      expect(musicProviderRegistry.hasProvider('local-fixtures')).toBe(true);
      expect(musicProviderRegistry.hasProvider('deezer')).toBe(true);

      const registered = musicProviderRegistry.getRegisteredProviders();
      expect(registered).toContain('local-fixtures');
      expect(registered).toContain('deezer');
    });

    it('allows switching active provider to deezer and back to local-fixtures', () => {
      // Default is local-fixtures
      expect(musicProviderRegistry.getActiveProvider().providerId).toBe('local-fixtures');

      // Switch to deezer
      musicProviderRegistry.setActiveProvider('deezer');
      expect(musicProviderRegistry.getActiveProvider().providerId).toBe('deezer');

      // Switch back
      musicProviderRegistry.setActiveProvider('local-fixtures');
      expect(musicProviderRegistry.getActiveProvider().providerId).toBe('local-fixtures');
    });

    it('throws when attempting to set an unknown provider as active', () => {
      expect(() => musicProviderRegistry.setActiveProvider('non-existent-provider')).toThrow(
        /Cannot set unknown provider/
      );
    });
  });

  describe('Quick Play Integration & Provider Fallback', () => {
    it('creates a session with local-fixtures by default without breaking existing flows', async () => {
      const result = await createGameSession({
        sourceType: 'QUICK_PLAY',
        mode: 'quick_play',
        difficulty: 'medium',
        roundsCount: 2
      });

      expect(result.session).toBeDefined();
      expect(result.session.status).toBe('active');
      expect(result.firstRound).toBeDefined();
      expect(result.firstRound.roundNumber).toBe(1);

      // Verify the song used is a local fixture
      const firstTicket = await prisma.roundTicket.findUnique({
        where: { ticketId: result.firstRound.ticketId },
        include: { song: true }
      });
      expect(firstTicket?.song.provider).toBe('local-fixtures');
      expect(firstTicket?.song.audioFixturePath).not.toBeNull();
    });

    it('falls back to local fixtures when Deezer returns insufficient tracks and fallback is enabled', async () => {
      // Mock Deezer search to return only 1 song when 3 are required
      const searchSpy = vi.spyOn(deezerMetadataProvider, 'searchSongs').mockResolvedValue([
        {
          id: 'mock_single',
          title: 'Single Mock Song',
          artist: 'Mock Artist',
          releaseYear: 1980,
          genre: 'Rock',
          subgenres: [],
          language: 'en',
          popularityScore: 70,
          difficulty: 'medium',
          previewUrl: 'https://preview.mp3',
          previewOffsetSec: 0
        }
      ]);

      const result = await createGameSession({
        sourceType: 'QUICK_PLAY',
        provider: 'deezer',
        providerFallback: true,
        roundsCount: 2,
        genre: 'Rock'
      });

      expect(result.session).toBeDefined();
      expect(result.session.status).toBe('active');

      // Fallback used local fixture pool
      const firstTicket = await prisma.roundTicket.findUnique({
        where: { ticketId: result.firstRound.ticketId },
        include: { song: true }
      });
      expect(firstTicket?.song.provider).toBe('local-fixtures');

      searchSpy.mockRestore();
    });

    it('throws INSUFFICIENT_SONGS when Deezer fails and fallback is disabled', async () => {
      const searchSpy = vi.spyOn(deezerMetadataProvider, 'searchSongs').mockResolvedValue([]);

      await expect(
        createGameSession({
          sourceType: 'QUICK_PLAY',
          provider: 'deezer',
          providerFallback: false,
          roundsCount: 3
        })
      ).rejects.toThrow(/INSUFFICIENT_SONGS|No songs match your filters on Deezer/);

      searchSpy.mockRestore();
    });

    it('persists Deezer tracks with provider=deezer and audioFixturePath=null when Deezer succeeds', async () => {
      // Mock Deezer to return 3 valid playable songs
      const mockSongs = [
        {
          id: 'deezer_test_1',
          title: 'Deezer Song 1',
          artist: 'Deezer Artist A',
          album: 'Deezer Album A',
          releaseYear: 2021,
          genre: 'Pop',
          subgenres: [],
          language: 'en',
          popularityScore: 75,
          difficulty: 'medium' as const,
          previewUrl: 'https://cdnt-preview.dzcdn.net/preview1.mp3',
          previewOffsetSec: 0,
          albumArtUrl: 'https://cdn-images.dzcdn.net/cover1.jpg',
          externalUrl: 'https://deezer.com/track/deezer_test_1'
        },
        {
          id: 'deezer_test_2',
          title: 'Deezer Song 2',
          artist: 'Deezer Artist B',
          album: 'Deezer Album B',
          releaseYear: 2022,
          genre: 'Pop',
          subgenres: [],
          language: 'en',
          popularityScore: 70,
          difficulty: 'medium' as const,
          previewUrl: 'https://cdnt-preview.dzcdn.net/preview2.mp3',
          previewOffsetSec: 0,
          albumArtUrl: 'https://cdn-images.dzcdn.net/cover2.jpg',
          externalUrl: 'https://deezer.com/track/deezer_test_2'
        },
        {
          id: 'deezer_test_3',
          title: 'Deezer Song 3',
          artist: 'Deezer Artist C',
          album: 'Deezer Album C',
          releaseYear: 2023,
          genre: 'Pop',
          subgenres: [],
          language: 'en',
          popularityScore: 72,
          difficulty: 'medium' as const,
          previewUrl: 'https://cdnt-preview.dzcdn.net/preview3.mp3',
          previewOffsetSec: 0,
          albumArtUrl: 'https://cdn-images.dzcdn.net/cover3.jpg',
          externalUrl: 'https://deezer.com/track/deezer_test_3'
        }
      ];

      const searchSpy = vi.spyOn(deezerMetadataProvider, 'searchSongs').mockResolvedValue(mockSongs);

      const result = await createGameSession({
        sourceType: 'QUICK_PLAY',
        provider: 'deezer',
        difficulty: 'medium',
        roundsCount: 2
      });

      expect(result.session).toBeDefined();

      const ticket = await prisma.roundTicket.findUnique({
        where: { ticketId: result.firstRound.ticketId },
        include: { song: true }
      });

      // Verify authentic Deezer attributes
      expect(ticket?.song.provider).toBe('deezer');
      expect(ticket?.song.audioFixturePath).toBeNull(); // Must NOT be local fixture!
      expect(ticket?.song.previewUrl).toContain('https://cdnt-preview.dzcdn.net');
      expect(ticket?.song.previewProvider).toBe('deezer');
      expect(ticket?.song.albumArtUrl).toContain('https://cdn-images.dzcdn.net');
      expect(ticket?.song.externalUrl).toContain('https://deezer.com/track');

      // Subsequent round ticket should also draw from Deezer provider
      const nextRound = await createNextRoundTicket(result.session.id);
      expect(nextRound).not.toBeNull();
      const round2Ticket = await prisma.roundTicket.findUnique({
        where: { ticketId: nextRound!.ticketId },
        include: { song: true }
      });
      expect(round2Ticket?.song.provider).toBe('deezer');
      searchSpy.mockRestore();

      // Clean up test session and dummy test tracks so dev database is never polluted
      await prisma.roundTicket.deleteMany({ where: { sessionId: result.session.id } });
      await prisma.gameSession.delete({ where: { id: result.session.id } });
      await prisma.song.deleteMany({
        where: { id: { in: ['deezer_deezer_test_1', 'deezer_deezer_test_2', 'deezer_deezer_test_3'] } }
      });
    });
  });
});
