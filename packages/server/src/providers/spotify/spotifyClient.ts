import type { SpotifyPlaylistMetadata, SpotifyTrackItem } from '@songgest/shared';

// Official Spotify Web API endpoints
const SPOTIFY_AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_PLAYLIST_URL = 'https://api.spotify.com/v1/playlists';
const SPOTIFY_ME_URL = 'https://api.spotify.com/v1/me';

// Scopes strictly limited to read access for private and collaborative playlists
export const SPOTIFY_AUTH_SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative'
].join(' ');

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

interface SpotifyArtistObj {
  name: string;
}

interface SpotifyTrackObj {
  id: string;
  name: string;
  artists?: SpotifyArtistObj[];
  album?: {
    name?: string;
    release_date?: string;
    images?: Array<{ url: string; height?: number; width?: number }>;
  };
  popularity?: number;
  preview_url?: string | null;
  external_urls?: {
    spotify?: string;
  };
  is_local?: boolean;
}

interface SpotifyPlaylistItem {
  track?: SpotifyTrackObj | null;
  item?: SpotifyTrackObj | null;
}

interface SpotifyPlaylistResponse {
  id: string;
  name: string;
  description?: string | null;
  external_urls?: {
    spotify?: string;
  };
  owner?: {
    display_name?: string;
  };
  tracks?: {
    items?: SpotifyPlaylistItem[];
    total?: number;
    next?: string | null;
  };
  items?: {
    items?: SpotifyPlaylistItem[];
    total?: number;
    next?: string | null;
  };
}

interface SpotifyUserProfileResponse {
  id: string;
  display_name?: string;
}

let cachedClientToken: CachedToken | null = null;

export class SpotifyClient {
  private get clientId(): string | undefined {
    return process.env.SPOTIFY_CLIENT_ID?.trim();
  }

  private get clientSecret(): string | undefined {
    return process.env.SPOTIFY_CLIENT_SECRET?.trim();
  }

  private get redirectUri(): string {
    return (
      process.env.SPOTIFY_REDIRECT_URI?.trim() ||
      `http://127.0.0.1:${process.env.PORT || '3001'}/api/spotify/callback`
    );
  }

  public isConfigured(): boolean {
    if (process.env.NODE_ENV === 'test') {
      return false;
    }
    return Boolean(this.clientId && this.clientSecret);
  }

  /**
   * Generates official Spotify OAuth authorization URL requesting minimum necessary scopes.
   */
  public getAuthorizeUrl(state: string): string {
    if (!this.clientId) {
      throw new Error('SPOTIFY_CLIENT_ID is not configured.');
    }

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      state,
      scope: SPOTIFY_AUTH_SCOPES
    });

    return `${SPOTIFY_AUTHORIZE_URL}?${params.toString()}`;
  }

  /**
   * Exchanges authorization code for user access token and refresh token via Spotify OAuth flow.
   */
  public async exchangeCodeForToken(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
    scope?: string;
  }> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('Spotify client credentials are not configured.');
    }

    const authHeader = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri
    });

    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Spotify authorization code exchange failed (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as SpotifyTokenResponse;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in ?? 3600,
      scope: data.scope
    };
  }

  /**
   * Fetches user profile for authenticated Spotify account.
   */
  public async getUserProfile(accessToken: string): Promise<{ id: string; displayName?: string }> {
    const response = await fetch(SPOTIFY_ME_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Spotify user profile request failed with status ${response.status}`);
    }

    const data = (await response.json()) as SpotifyUserProfileResponse;
    return {
      id: data.id,
      displayName: data.display_name
    };
  }

  /**
   * Retrieves an application token via official Spotify Client Credentials flow.
   */
  public async getClientCredentialsToken(): Promise<string> {
    if (cachedClientToken && cachedClientToken.expiresAt > Date.now() + 60000) {
      return cachedClientToken.accessToken;
    }

    if (!this.clientId || !this.clientSecret) {
      throw new Error('Spotify credentials not configured.');
    }

    const authHeader = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Spotify token request failed with status ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as SpotifyTokenResponse;
    cachedClientToken = {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000
    };

    return cachedClientToken.accessToken;
  }

  /**
   * Retrieves playlist metadata and tracks from Spotify Web API or development provider.
   * If a user access token is provided, it is used to access user-owned or private playlists.
   */
  public async getPlaylist(
    playlistId: string,
    userAccessToken?: string
  ): Promise<SpotifyPlaylistMetadata> {
    if (this.isConfigured()) {
      return this.fetchFromLiveApi(playlistId, userAccessToken);
    }

    return this.getDevelopmentMockPlaylist(playlistId);
  }

  /**
   * Official Spotify Web API integration.
   * Supports pagination up to 500 items and preserves Spotify URL attribution.
   */
  private async fetchFromLiveApi(
    playlistId: string,
    userAccessToken?: string
  ): Promise<SpotifyPlaylistMetadata> {
    const token = userAccessToken || (await this.getClientCredentialsToken());

    const response = await fetch(`${SPOTIFY_PLAYLIST_URL}/${encodeURIComponent(playlistId)}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        const error = new Error('Playlist not found on Spotify.');
        (error as unknown as { code: string }).code = 'PLAYLIST_NOT_FOUND';
        throw error;
      }
      if (response.status === 401 || response.status === 403) {
        const error = new Error(
          'Spotify authorization required or playlist is private. Please connect your Spotify account.'
        );
        (error as unknown as { code: string }).code = 'SPOTIFY_AUTH_REQUIRED';
        throw error;
      }
      if (response.status === 429) {
        const error = new Error('Spotify API rate limit reached. Please wait before retrying.');
        (error as unknown as { code: string }).code = 'SPOTIFY_RATE_LIMITED';
        throw error;
      }

      throw new Error(`Spotify playlist fetch failed (${response.status})`);
    }

    const data = (await response.json()) as SpotifyPlaylistResponse;

    const playlistContainer = data.items || data.tracks;

    // Spotify Web API policy (Nov 2024+):
    // 1. Client Credentials tokens cannot access playlist tracks -> prompt user to connect.
    // 2. In Spotify Development Mode, Spotify blocks access to playlists created by unapproved 3rd-party accounts.
    if (!playlistContainer || !playlistContainer.items || playlistContainer.items.length === 0) {
      if (!userAccessToken) {
        const error = new Error(
          'Spotify requires user authorization to access playlist tracks. Please click "Connect Spotify" to connect your account.'
        );
        (error as unknown as { code: string }).code = 'SPOTIFY_AUTH_REQUIRED';
        throw error;
      } else {
        const ownerName = data.owner?.display_name || 'the playlist creator';
        const error = new Error(
          `Spotify did not return any tracks for this playlist. In Spotify Development Mode, Spotify restricts API access to playlists created by your authorized account. This playlist was created by "${ownerName}". Please import a playlist created by your own account, or duplicate/save this playlist into your Spotify library first.`
        );
        (error as unknown as { code: string }).code = 'PLAYLIST_ACCESS_RESTRICTED';
        throw error;
      }
    }

    // Collect all tracks, handling pagination up to 500 tracks
    let rawItems: SpotifyPlaylistItem[] = playlistContainer?.items || [];
    let nextUrl = playlistContainer?.next;
    let pageCount = 1;
    const MAX_PAGES = 5; // Up to 500 tracks maximum to protect memory and rate limit

    while (nextUrl && pageCount < MAX_PAGES) {
      try {
        const pageRes = await fetch(nextUrl, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        if (!pageRes.ok) break;
        const pageData = (await pageRes.json()) as { items?: SpotifyPlaylistItem[]; next?: string | null };
        if (pageData.items && pageData.items.length > 0) {
          rawItems = rawItems.concat(pageData.items);
        }
        nextUrl = pageData.next;
        pageCount++;
      } catch {
        break;
      }
    }

    const tracks: SpotifyTrackItem[] = [];
    const artistsSet = new Set<string>();
    let minYear = 2050;
    let maxYear = 1900;

    for (const item of rawItems) {
      const track = item.item || item.track;
      // Skip non-track items, podcast episodes, or local files that have no Spotify ID
      if (!track || !track.id || !track.name || track.is_local) {
        continue;
      }

      const artistName = track.artists?.map((a) => a.name).join(', ') || 'Unknown Artist';
      const albumName = track.album?.name || '';
      const releaseDate = track.album?.release_date || '';
      const releaseYear = releaseDate ? parseInt(releaseDate.slice(0, 4), 10) || 2020 : 2020;
      const albumArtUrl = track.album?.images?.[0]?.url;
      const externalSpotifyUrl =
        track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`;

      if (releaseYear < minYear) minYear = releaseYear;
      if (releaseYear > maxYear) maxYear = releaseYear;
      if (track.artists?.[0]?.name) {
        artistsSet.add(track.artists[0].name);
      }

      // Authentic preview availability: DO NOT force true!
      const hasPreview = Boolean(track.preview_url);

      tracks.push({
        id: track.id,
        title: track.name,
        artist: artistName,
        album: albumName,
        releaseYear,
        popularityScore: track.popularity ?? 50,
        hasPlayablePreview: hasPreview,
        previewUrl: track.preview_url || undefined,
        previewProvider: hasPreview ? 'spotify' : undefined,
        externalSpotifyUrl,
        albumArtUrl
      });
    }

    const playableCount = tracks.filter((t) => t.hasPlayablePreview).length;
    const unplayableCount = tracks.length - playableCount;
    const spotifyUrl = data.external_urls?.spotify || `https://open.spotify.com/playlist/${playlistId}`;

    return {
      id: data.id || playlistId,
      name: data.name || 'Imported Spotify Playlist',
      spotifyUrl,
      description: data.description || undefined,
      ownerName: data.owner?.display_name || undefined,
      totalTracks: tracks.length,
      playableCount,
      unplayableCount,
      artists: Array.from(artistsSet).slice(0, 20),
      genres: ['Pop', 'Rock', 'Electronic', 'Hip-Hop'],
      yearMin: minYear <= maxYear ? minYear : 2000,
      yearMax: minYear <= maxYear ? maxYear : 2024,
      tracks,
      isMockProvider: false
    };
  }

  /**
   * Curated development mock provider when Spotify credentials are not configured.
   * Clearly marked DEVELOPMENT ONLY with transparent playable/unplayable status.
   */
  private getDevelopmentMockPlaylist(playlistId: string): SpotifyPlaylistMetadata {
    const mockTracks: SpotifyTrackItem[] = [
      {
        id: `spot_${playlistId}_1`,
        title: 'Neon Horizon',
        artist: 'The Midnight Waves',
        album: 'Electric Dreams',
        releaseYear: 1984,
        popularityScore: 85,
        hasPlayablePreview: true,
        previewProvider: 'local-fixture-dev-only',
        externalSpotifyUrl: `https://open.spotify.com/track/spot_${playlistId}_1`
      },
      {
        id: `spot_${playlistId}_2`,
        title: 'Starlight Velocity',
        artist: 'Galaxy Disco',
        album: 'Orbiting Groove',
        releaseYear: 1979,
        popularityScore: 92,
        hasPlayablePreview: true,
        previewProvider: 'local-fixture-dev-only',
        externalSpotifyUrl: `https://open.spotify.com/track/spot_${playlistId}_2`
      },
      {
        id: `spot_${playlistId}_3`,
        title: 'Electric Skyline',
        artist: 'Apex Horizon',
        album: 'Stadium Thunder',
        releaseYear: 1987,
        popularityScore: 88,
        hasPlayablePreview: true,
        previewProvider: 'local-fixture-dev-only',
        externalSpotifyUrl: `https://open.spotify.com/track/spot_${playlistId}_3`
      },
      {
        id: `spot_${playlistId}_4`,
        title: 'Super Groove',
        artist: 'Funk Dynasty',
        album: 'Cosmic Basslines',
        releaseYear: 1977,
        popularityScore: 90,
        hasPlayablePreview: true,
        previewProvider: 'local-fixture-dev-only',
        externalSpotifyUrl: `https://open.spotify.com/track/spot_${playlistId}_4`
      },
      {
        id: `spot_${playlistId}_5`,
        title: 'Solar Groove',
        artist: 'Funk Dynasty',
        album: 'Cosmic Basslines',
        releaseYear: 1978,
        popularityScore: 72,
        hasPlayablePreview: true,
        previewProvider: 'local-fixture-dev-only',
        externalSpotifyUrl: `https://open.spotify.com/track/spot_${playlistId}_5`
      },
      {
        id: `spot_${playlistId}_6`,
        title: 'Thunder Overdrive',
        artist: 'Heavy Voltage',
        album: 'High Voltage Circuit',
        releaseYear: 1991,
        popularityScore: 70,
        hasPlayablePreview: true,
        previewProvider: 'local-fixture-dev-only',
        externalSpotifyUrl: `https://open.spotify.com/track/spot_${playlistId}_6`
      },
      {
        id: `spot_${playlistId}_7`,
        title: 'Tokyo Neon Lights',
        artist: 'City Pop Ensemble',
        album: 'Pacific Breeze',
        releaseYear: 1986,
        popularityScore: 75,
        hasPlayablePreview: true,
        previewProvider: 'local-fixture-dev-only',
        externalSpotifyUrl: `https://open.spotify.com/track/spot_${playlistId}_7`
      },
      {
        id: `spot_${playlistId}_8`,
        title: 'Echoes of Distortion',
        artist: 'Heavy Voltage',
        album: 'High Voltage Circuit',
        releaseYear: 1998,
        popularityScore: 50,
        hasPlayablePreview: true,
        previewProvider: 'local-fixture-dev-only',
        externalSpotifyUrl: `https://open.spotify.com/track/spot_${playlistId}_8`
      },
      {
        id: `spot_${playlistId}_9`,
        title: 'Blue Midnight',
        artist: 'Miles Trio',
        album: 'Midnight Voicings',
        releaseYear: 1968,
        popularityScore: 45,
        hasPlayablePreview: true,
        previewProvider: 'local-fixture-dev-only',
        externalSpotifyUrl: `https://open.spotify.com/track/spot_${playlistId}_9`
      },
      {
        id: `spot_${playlistId}_10`,
        title: 'Subterranean Pulse',
        artist: 'Klangwerk',
        album: 'Autobahn Visionen',
        releaseYear: 1975,
        popularityScore: 38,
        hasPlayablePreview: true,
        previewProvider: 'local-fixture-dev-only',
        externalSpotifyUrl: `https://open.spotify.com/track/spot_${playlistId}_10`
      },
      {
        id: `spot_${playlistId}_11`,
        title: 'Obscure Resonance',
        artist: 'The Velvet Phantoms',
        album: 'Underground Cellar',
        releaseYear: 1971,
        popularityScore: 15,
        hasPlayablePreview: false, // Intentionally unplayable to test preview exclusion
        externalSpotifyUrl: `https://open.spotify.com/track/spot_${playlistId}_11`
      },
      {
        id: `spot_${playlistId}_12`,
        title: 'Minimal Orbit',
        artist: 'Analog Pioneers',
        album: 'Tapes from the Attic',
        releaseYear: 1981,
        popularityScore: 10,
        hasPlayablePreview: false, // Intentionally unplayable to test preview exclusion
        externalSpotifyUrl: `https://open.spotify.com/track/spot_${playlistId}_12`
      }
    ];

    const playableCount = mockTracks.filter((t) => t.hasPlayablePreview).length;
    const unplayableCount = mockTracks.length - playableCount;

    return {
      id: playlistId,
      name: 'Featured Development Playlist',
      spotifyUrl: `https://open.spotify.com/playlist/${playlistId}`,
      description: 'Curated 12-track development playlist for testing with 10 playable and 2 unplayable tracks.',
      ownerName: 'Songgest Dev',
      totalTracks: mockTracks.length,
      playableCount,
      unplayableCount,
      artists: [
        'The Midnight Waves',
        'Galaxy Disco',
        'Apex Horizon',
        'Funk Dynasty',
        'Heavy Voltage',
        'City Pop Ensemble',
        'Miles Trio',
        'Klangwerk'
      ],
      genres: ['Electronic', 'Rock', 'Funk', 'Jazz'],
      yearMin: 1968,
      yearMax: 1998,
      tracks: mockTracks,
      isMockProvider: true,
      notice:
        'Operating in Development Mock Mode: SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are not set in .env. Live Spotify Web API requires registered developer credentials.'
    };
  }
}

export const spotifyClient = new SpotifyClient();
