import crypto from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './index.js';
import { prisma } from './db/client.js';
import { seedDatabase } from './db/seed.js';
import { markTicketUsed } from './services/sessionService.js';
import { localFixtureProvider, musicProviderRegistry } from './providers/index.js';

describe('Backend Audio Infrastructure & Session Integration Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await seedDatabase();
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('verifies database creation and song seeding', async () => {
    const songs = await prisma.song.findMany();
    expect(songs.length).toBeGreaterThanOrEqual(4);

    const synthPop = await prisma.song.findUnique({
      where: { id: 'song_synth_pop_1' }
    });
    expect(synthPop).toBeDefined();
    expect(synthPop?.title).toBe('Neon Horizon');
    expect(synthPop?.popularityScore).toBe(85);
  });

  let createdSessionId = '';
  let activeTicketId = '';

  it('creates a new game session with first round ticket', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        mode: 'arcade',
        difficulty: 'normal',
        guessDuration: 0.5,
        roundsCount: 3
      }
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    expect(body.session).toBeDefined();
    expect(body.session.status).toBe('active');
    expect(body.session.difficulty).toBe('normal');
    expect(body.session.guessDuration).toBe(0.5);

    expect(body.firstRound).toBeDefined();
    expect(body.firstRound.roundNumber).toBe(1);
    expect(body.firstRound.ticketId).toBeDefined();
    expect(body.firstRound.durationSec).toBe(0.5);
    expect(body.firstRound.expiresAt).toBeGreaterThan(Date.now());

    createdSessionId = body.session.id;
    activeTicketId = body.firstRound.ticketId;
  });

  it('retrieves an existing session by ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/${createdSessionId}`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.session.id).toBe(createdSessionId);
    expect(body.session.tickets.length).toBe(1);
  });

  it('generates next round ticket within an active session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/sessions/${createdSessionId}/tickets`
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.nextRound).toBeDefined();
    expect(body.nextRound.roundNumber).toBe(2);
    expect(body.nextRound.ticketId).toBeDefined();
  });

  it('streams audio fixture completely with HTTP 200 when no Range is requested', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/audio/${activeTicketId}`
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('audio/wav');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-length']).toBe('882044');
    expect(res.rawPayload.length).toBe(882044);
  });

  it('serves HTTP 206 Partial Content for valid closed Range request (bytes=0-499)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/audio/${activeTicketId}`,
      headers: {
        range: 'bytes=0-499'
      }
    });

    expect(res.statusCode).toBe(206);
    expect(res.headers['content-type']).toBe('audio/wav');
    expect(res.headers['content-length']).toBe('500');
    expect(res.headers['content-range']).toBe('bytes 0-499/882044');
    expect(res.rawPayload.length).toBe(500);
  });

  it('serves HTTP 206 Partial Content for open-ended Range request (bytes=1000-)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/audio/${activeTicketId}`,
      headers: {
        range: 'bytes=1000-'
      }
    });

    expect(res.statusCode).toBe(206);
    const expectedLength = 882044 - 1000;
    expect(res.headers['content-length']).toBe(expectedLength.toString());
    expect(res.headers['content-range']).toBe(`bytes 1000-882043/882044`);
    expect(res.rawPayload.length).toBe(expectedLength);
  });

  it('returns HTTP 416 Range Not Satisfiable for out-of-bounds Range header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/audio/${activeTicketId}`,
      headers: {
        range: 'bytes=9999999-'
      }
    });

    expect(res.statusCode).toBe(416);
    expect(res.headers['content-range']).toBe('bytes */882044');
    const body = JSON.parse(res.body);
    expect(body.error).toBe('RANGE_NOT_SATISFIABLE');
  });

  it('handles missing audio fixture gracefully with HTTP 404', async () => {
    const missingSong = await prisma.song.create({
      data: {
        title: 'Ghost Track',
        artist: 'Unknown',
        releaseYear: 2020,
        genre: 'Ambient',
        subgenres: 'None',
        popularityScore: 50,
        audioFixturePath: 'non_existent_audio.wav'
      }
    });

    const ghostTicket = await prisma.roundTicket.create({
      data: {
        ticketId: `tkt_ghost_${crypto.randomUUID().replace(/-/g, '')}`,
        sessionId: createdSessionId,
        songId: missingSong.id,
        roundNumber: 99,
        durationSec: 2.0,
        expiresAt: new Date(Date.now() + 60000),
        status: 'issued'
      }
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/audio/${ghostTicket.ticketId}`
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('AUDIO_NOT_FOUND');

    await prisma.roundTicket.delete({ where: { id: ghostTicket.id } });
    await prisma.song.delete({ where: { id: missingSong.id } });
  });

  it('rejects expired round tickets with HTTP 403', async () => {
    const expiredTicket = await prisma.roundTicket.create({
      data: {
        ticketId: `tkt_expired_${crypto.randomUUID().replace(/-/g, '')}`,
        sessionId: createdSessionId,
        songId: 'song_synth_pop_1',
        roundNumber: 98,
        durationSec: 0.5,
        expiresAt: new Date(Date.now() - 5000),
        status: 'issued'
      }
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/audio/${expiredTicket.ticketId}`
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('TICKET_EXPIRED');
  });

  it('rejects duplicate or already-used tickets with HTTP 409', async () => {
    // Create dedicated session for already-used ticket test
    const sessionRes = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { mode: 'arcade', difficulty: 'normal', guessDuration: 0.5, roundsCount: 2 }
    });
    const { firstRound } = JSON.parse(sessionRes.body);

    await markTicketUsed(firstRound.ticketId, 850);

    const res = await app.inject({
      method: 'GET',
      url: `/api/audio/${firstRound.ticketId}`
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('TICKET_ALREADY_USED');
  });

  // ==========================================
  // MILESTONE 3: GUESS SUBMISSION & SCORING TESTS
  // ==========================================

  it('evaluates a correct song guess and awards calculated points', async () => {
    const sessionRes = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { mode: 'arcade', difficulty: 'normal', guessDuration: 0.5, roundsCount: 3 }
    });
    const { session, firstRound } = JSON.parse(sessionRes.body);

    const ticketRecord = await prisma.roundTicket.findUnique({
      where: { ticketId: firstRound.ticketId },
      include: { song: true }
    });

    expect(ticketRecord).toBeDefined();
    const targetTitle = ticketRecord!.song.title;

    const res = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/guess`,
      payload: {
        ticketId: firstRound.ticketId,
        guessText: targetTitle,
        reactionTimeMs: 1500
      }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.isCorrect).toBe(true);
    expect(body.pointsAwarded).toBeGreaterThan(0);
    expect(body.totalScore).toBe(body.pointsAwarded);
    expect(body.currentStreak).toBe(1);
    expect(body.revealedSong.title).toBe(targetTitle);
  });

  it('evaluates a guess with a reasonable typo using fuzzy matching', async () => {
    const sessionRes = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { mode: 'arcade', difficulty: 'easy', guessDuration: 2.0, roundsCount: 2 }
    });
    const { session, firstRound } = JSON.parse(sessionRes.body);

    const ticketRecord = await prisma.roundTicket.findUnique({
      where: { ticketId: firstRound.ticketId },
      include: { song: true }
    });

    // For Neon Horizon -> submit "Neon Horzon" (1 letter typo)
    const typoGuess = ticketRecord!.song.title.slice(0, -2) + 'on';

    const guessRes = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/guess`,
      payload: {
        ticketId: firstRound.ticketId,
        guessText: typoGuess,
        reactionTimeMs: 2200
      }
    });

    expect(guessRes.statusCode).toBe(200);
    const body = JSON.parse(guessRes.body);
    expect(body.isCorrect).toBe(true);
    expect(body.pointsAwarded).toBeGreaterThan(0);
  });

  it('evaluates an incorrect guess and awards 0 points', async () => {
    const sessionRes = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { mode: 'arcade', difficulty: 'hard', guessDuration: 0.5, roundsCount: 2 }
    });
    const { session, firstRound } = JSON.parse(sessionRes.body);

    const guessRes = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/guess`,
      payload: {
        ticketId: firstRound.ticketId,
        guessText: 'Completely Wrong Track Name',
        reactionTimeMs: 3000
      }
    });

    expect(guessRes.statusCode).toBe(200);
    const body = JSON.parse(guessRes.body);
    expect(body.isCorrect).toBe(false);
    expect(body.pointsAwarded).toBe(0);
    expect(body.currentStreak).toBe(0);
  });

  it('evaluates round timeout and resets streak with 0 points', async () => {
    const sessionRes = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { mode: 'arcade', difficulty: 'normal', guessDuration: 0.1, roundsCount: 2 }
    });
    const { session, firstRound } = JSON.parse(sessionRes.body);

    const timeoutRes = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/guess`,
      payload: {
        ticketId: firstRound.ticketId,
        guessText: '',
        reactionTimeMs: 20000,
        isTimeout: true
      }
    });

    expect(timeoutRes.statusCode).toBe(200);
    const body = JSON.parse(timeoutRes.body);
    expect(body.isCorrect).toBe(false);
    expect(body.pointsAwarded).toBe(0);
    expect(body.currentStreak).toBe(0);
  });

  it('prevents submitting a guess on an already-used ticket with HTTP 409', async () => {
    const sessionRes = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { mode: 'arcade', difficulty: 'normal', guessDuration: 0.5, roundsCount: 1 }
    });
    const { session, firstRound } = JSON.parse(sessionRes.body);

    // First submission
    await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/guess`,
      payload: { ticketId: firstRound.ticketId, guessText: 'Song Title', reactionTimeMs: 1500 }
    });

    // Duplicate submission
    const duplicateRes = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/guess`,
      payload: { ticketId: firstRound.ticketId, guessText: 'Song Title Again', reactionTimeMs: 1800 }
    });

    expect(duplicateRes.statusCode).toBe(409);
    const body = JSON.parse(duplicateRes.body);
    expect(body.error).toBe('TICKET_ALREADY_USED');
  });

  it('prevents submitting a guess on an expired ticket with HTTP 403', async () => {
    const sessionRes = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { mode: 'arcade', difficulty: 'normal', guessDuration: 0.5, roundsCount: 1 }
    });
    const { session, firstRound } = JSON.parse(sessionRes.body);

    // Manually expire the ticket in the database
    await prisma.roundTicket.update({
      where: { ticketId: firstRound.ticketId },
      data: { expiresAt: new Date(Date.now() - 1000) }
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/guess`,
      payload: { ticketId: firstRound.ticketId, guessText: 'Neon Horizon', reactionTimeMs: 1500 }
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('TICKET_EXPIRED');
  });

  it('completes game session when all configured rounds are answered', async () => {
    const sessionRes = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { mode: 'arcade', difficulty: 'normal', guessDuration: 0.5, roundsCount: 1 }
    });
    const { session, firstRound } = JSON.parse(sessionRes.body);

    const guessRes = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/guess`,
      payload: { ticketId: firstRound.ticketId, guessText: 'Neon Horizon', reactionTimeMs: 1200 }
    });

    expect(guessRes.statusCode).toBe(200);
    const body = JSON.parse(guessRes.body);
    expect(body.isSessionCompleted).toBe(true);

    const checkSessionRes = await app.inject({
      method: 'GET',
      url: `/api/sessions/${session.id}`
    });
    const sessionBody = JSON.parse(checkSessionRes.body);
    expect(sessionBody.session.status).toBe('completed');
  });

  // ========================================================
  // MILESTONE 4: CATALOG FILTERING, SEARCH & HISTORY TESTS
  // ========================================================

  it('filters catalog songs by single dimension (genre)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/songs?genre=Jazz'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.songs).toBeDefined();
    expect(body.songs.length).toBeGreaterThanOrEqual(3);
    for (const song of body.songs) {
      expect(song.genre).toBe('Jazz');
    }
  });

  it('filters catalog songs by derived difficulty (hard = popularity 35-59)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/songs?difficulty=hard'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.songs.length).toBeGreaterThanOrEqual(4);
    for (const song of body.songs) {
      expect(song.popularityScore).toBeGreaterThanOrEqual(35);
      expect(song.popularityScore).toBeLessThanOrEqual(59);
      expect(song.difficulty).toBe('hard');
    }
  });

  it('filters catalog songs by language and release year range', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/songs?language=es&yearMin=1990&yearMax=2005'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.songs.length).toBeGreaterThanOrEqual(2);
    for (const song of body.songs) {
      expect(song.language).toBe('es');
      expect(song.releaseYear).toBeGreaterThanOrEqual(1990);
      expect(song.releaseYear).toBeLessThanOrEqual(2005);
    }
  });

  it('supports combined multi-dimensional filtering (difficulty + genre + language)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/songs?difficulty=normal&genre=Rock&language=en'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.songs.length).toBe(1);
    expect(body.songs[0].title).toBe('Thunder Overdrive');
    expect(body.songs[0].genre).toBe('Rock');
    expect(body.songs[0].difficulty).toBe('medium');
  });

  it('provides catalog search / autocomplete by title and artist', async () => {
    // Search by title fragment
    const titleRes = await app.inject({
      method: 'GET',
      url: '/api/songs/search?q=Horizon'
    });
    expect(titleRes.statusCode).toBe(200);
    const titleBody = JSON.parse(titleRes.body);
    expect(titleBody.results.length).toBeGreaterThanOrEqual(1);
    expect(titleBody.results.some((r: { title: string }) => r.title.includes('Horizon'))).toBe(true);

    // Search by artist fragment
    const artistRes = await app.inject({
      method: 'GET',
      url: '/api/songs/search?q=Miles'
    });
    expect(artistRes.statusCode).toBe(200);
    const artistBody = JSON.parse(artistRes.body);
    expect(artistBody.results.length).toBeGreaterThanOrEqual(1);
    expect(artistBody.results.every((r: { artist: string }) => r.artist.includes('Miles'))).toBe(true);
  });

  it('retrieves catalog filter options with facets and era bounds', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/songs/filters'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.genres).toContain('Rock');
    expect(body.genres).toContain('Electronic');
    expect(body.genres).toContain('Funk');
    expect(body.genres).toContain('Jazz');
    expect(body.languages).toContain('en');
    expect(body.yearMin).toBeLessThanOrEqual(1960);
    expect(body.yearMax).toBeGreaterThanOrEqual(2000);
  });

  it('rejects session creation with INSUFFICIENT_SONGS when filter matches fewer than required rounds', async () => {
    // Only 1 song in catalog is Funk in Spanish (Ritmo Salvaje)
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        mode: 'arcade',
        difficulty: 'hard',
        guessDuration: 0.5,
        roundsCount: 5,
        genre: 'Funk',
        language: 'es'
      }
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('INSUFFICIENT_SONGS');
    expect(body.message).toContain('Found only 1 songs matching the selected filters (5 required)');
  });

  it('prevents duplicate songs across rounds in a multi-round filtered session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        mode: 'arcade',
        difficulty: 'normal',
        guessDuration: 0.5,
        roundsCount: 3
      }
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    const sessionId = body.session.id;

    // Retrieve Round 1 ticket
    const ticket1 = await prisma.roundTicket.findUnique({
      where: { ticketId: body.firstRound.ticketId }
    });

    // Request Round 2 ticket
    const round2Res = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/tickets`
    });
    expect(round2Res.statusCode).toBe(201);
    const round2Body = JSON.parse(round2Res.body);

    const ticket2 = await prisma.roundTicket.findUnique({
      where: { ticketId: round2Body.nextRound.ticketId }
    });

    // Verify songs are distinct
    expect(ticket1?.songId).toBeDefined();
    expect(ticket2?.songId).toBeDefined();
    expect(ticket1?.songId).not.toBe(ticket2?.songId);
  });

  it('creates a GameHistory record and provides statistics via GET /api/history', async () => {
    // 1. Create a 1-round session
    const sessionRes = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        mode: 'arcade',
        difficulty: 'easy',
        guessDuration: 2.0,
        roundsCount: 1,
        genre: 'Rock'
      }
    });
    expect(sessionRes.statusCode).toBe(201);
    const { session, firstRound } = JSON.parse(sessionRes.body);

    // 2. Submit a correct guess to complete session and trigger history creation
    const guessRes = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/guess`,
      payload: {
        ticketId: firstRound.ticketId,
        guessText: 'Electric Skyline',
        reactionTimeMs: 800
      }
    });
    expect(guessRes.statusCode).toBe(200);
    const guessBody = JSON.parse(guessRes.body);
    expect(guessBody.isSessionCompleted).toBe(true);

    // 3. Verify GameHistory record exists in database
    const historyRec = await prisma.gameHistory.findFirst({
      where: { sessionId: session.id }
    });
    expect(historyRec).toBeDefined();
    expect(historyRec?.sessionId).toBe(session.id);
    expect(historyRec?.difficulty).toBe('easy');
    expect(historyRec?.guessDuration).toBe(2.0);
    expect(historyRec?.genre).toBe('Rock');
    expect(historyRec?.finalScore).toBeGreaterThan(0);
    expect(historyRec?.accuracy).toBe(100);

    // 4. Retrieve history through GET /api/history
    const historyApiRes = await app.inject({
      method: 'GET',
      url: '/api/history?limit=5'
    });
    expect(historyApiRes.statusCode).toBe(200);
    const stats = JSON.parse(historyApiRes.body);

    expect(stats.gamesPlayed).toBeGreaterThanOrEqual(1);
    expect(stats.highestScore).toBeGreaterThan(0);
    expect(stats.averageScore).toBeGreaterThan(0);
    expect(stats.overallAccuracy).toBeGreaterThan(0);
    expect(stats.recentGames.length).toBeGreaterThanOrEqual(1);

    const matchFound = stats.recentGames.some((g: { sessionId: string }) => g.sessionId === session.id);
    expect(matchFound).toBe(true);
  });

  // ========================================================
  // MILESTONE 5: SECURITY, ANTI-CHEAT & E2E TESTS
  // ========================================================

  describe('API Security & Input Validation', () => {
    it('rejects session creation with invalid mode', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { mode: 'invalid-mode' }
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('INVALID_MODE');
    });

    it('rejects session creation with invalid difficulty', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { difficulty: 'extreme' }
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('INVALID_DIFFICULTY');
    });

    it('rejects session creation with invalid guess duration', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { guessDuration: 45.0 }
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('INVALID_GUESS_DURATION');
    });

    it('rejects session creation with out-of-range roundsCount', async () => {
      const resNegative = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { roundsCount: -2 }
      });
      expect(resNegative.statusCode).toBe(400);
      expect(JSON.parse(resNegative.body).error).toBe('INVALID_ROUNDS_COUNT');

      const resExcessive = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { roundsCount: 50 }
      });
      expect(resExcessive.statusCode).toBe(400);
      expect(JSON.parse(resExcessive.body).error).toBe('INVALID_ROUNDS_COUNT');
    });

    it('rejects session creation with inverted release year range', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { yearMin: 2020, yearMax: 1980 }
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('INVALID_YEAR_RANGE');
    });

    it('rejects malformed session identifier in URL path', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/sessions/invalid!id@with#chars'
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('INVALID_IDENTIFIER');
    });

    it('returns 404 for non-existent session ID without leaking internals', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/sessions/sess_nonexistent_12345'
      });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('SESSION_NOT_FOUND');
    });

    it('rejects guess submission with missing ticketId', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/sess_any/guess',
        payload: { guessText: 'Song Title' }
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('MISSING_TICKET_ID');
    });

    it('rejects guess submission with negative or excessive reaction time', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions/sess_any/guess',
        payload: { ticketId: 'tkt_valid_id', reactionTimeMs: -500 }
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('INVALID_REACTION_TIME');
    });

    it('rejects excessive pagination limits in catalog queries', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/songs?limit=500'
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('INVALID_LIMIT');
    });

    it('rejects negative offset in catalog queries', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/songs?offset=-10'
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('INVALID_OFFSET');
    });

    it('rejects inverted popularity bounds in catalog queries', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/songs?popularityMin=90&popularityMax=20'
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('INVALID_POPULARITY_RANGE');
    });

    it('rejects out-of-range history query limit', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/history?limit=150'
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('INVALID_LIMIT');
    });
  });

  describe('Anti-Cheat & Ticket Security', () => {
    it('prevents cross-session ticket smuggling (ticket from Session A used in Session B)', async () => {
      // Create Session A
      const sessionARes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { mode: 'arcade', difficulty: 'normal', guessDuration: 0.5, roundsCount: 1 }
      });
      const sessionA = JSON.parse(sessionARes.body);

      // Create Session B
      const sessionBRes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { mode: 'arcade', difficulty: 'normal', guessDuration: 0.5, roundsCount: 1 }
      });
      const sessionB = JSON.parse(sessionBRes.body);

      // Attempt to submit Session A's ticket to Session B's guess endpoint
      const smugglingRes = await app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionB.session.id}/guess`,
        payload: {
          ticketId: sessionA.firstRound.ticketId,
          guessText: 'Neon Horizon',
          reactionTimeMs: 1200
        }
      });

      expect(smugglingRes.statusCode).toBe(403);
      const body = JSON.parse(smugglingRes.body);
      expect(body.error).toBe('TICKET_INVALID_FOR_SESSION');
    });

    it('enforces atomic state transition preventing race-like double submissions', async () => {
      const sessionRes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { mode: 'arcade', difficulty: 'normal', guessDuration: 0.5, roundsCount: 1 }
      });
      const { session, firstRound } = JSON.parse(sessionRes.body);

      // Launch two concurrent guess submissions with the exact same ticket
      const [res1, res2] = await Promise.all([
        app.inject({
          method: 'POST',
          url: `/api/sessions/${session.id}/guess`,
          payload: { ticketId: firstRound.ticketId, guessText: 'Neon Horizon', reactionTimeMs: 1000 }
        }),
        app.inject({
          method: 'POST',
          url: `/api/sessions/${session.id}/guess`,
          payload: { ticketId: firstRound.ticketId, guessText: 'Neon Horizon', reactionTimeMs: 1100 }
        })
      ]);

      const statuses = [res1.statusCode, res2.statusCode].sort();
      // Exactly one request must succeed (200) and the other must be rejected (409)
      expect(statuses).toEqual([200, 409]);
    });

    it('handles concurrent round generation idempotently without creating duplicate tickets', async () => {
      const sessionRes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { mode: 'arcade', difficulty: 'normal', guessDuration: 0.5, roundsCount: 3 }
      });
      const { session } = JSON.parse(sessionRes.body);

      // Launch two concurrent requests to generate Round 2 ticket
      const [round2A, round2B] = await Promise.all([
        app.inject({ method: 'POST', url: `/api/sessions/${session.id}/tickets` }),
        app.inject({ method: 'POST', url: `/api/sessions/${session.id}/tickets` })
      ]);

      expect(round2A.statusCode).toBe(201);
      expect(round2B.statusCode).toBe(201);
      const bodyA = JSON.parse(round2A.body);
      const bodyB = JSON.parse(round2B.body);

      // Both concurrent requests receive the exact same round 2 ticket ID
      expect(bodyA.nextRound.ticketId).toBe(bodyB.nextRound.ticketId);
      expect(bodyA.nextRound.roundNumber).toBe(2);
    });

    it('enforces server authority over points and streak regardless of client payload', async () => {
      const sessionRes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { mode: 'arcade', difficulty: 'normal', guessDuration: 0.5, roundsCount: 1 }
      });
      const { session, firstRound } = JSON.parse(sessionRes.body);

      // Client attempts to pass 0ms reaction time and fabricated score in body
      const guessRes = await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/guess`,
        payload: {
          ticketId: firstRound.ticketId,
          guessText: 'Neon Horizon',
          reactionTimeMs: 10, // Clamped to server minimum bounds
          pointsAwarded: 999999, // Should be ignored
          totalScore: 999999 // Should be ignored
        }
      });

      expect(guessRes.statusCode).toBe(200);
      const body = JSON.parse(guessRes.body);
      // Awarded points must follow server formula, not client payload
      expect(body.pointsAwarded).toBeLessThan(5000);
      expect(body.totalScore).toBe(body.pointsAwarded);
    });

    it('rejects audio requests for expired or used tickets', async () => {
      const sessionRes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { mode: 'arcade', difficulty: 'normal', guessDuration: 0.5, roundsCount: 1 }
      });
      const { session, firstRound } = JSON.parse(sessionRes.body);

      // Mark ticket used
      await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/guess`,
        payload: { ticketId: firstRound.ticketId, guessText: 'Neon Horizon', reactionTimeMs: 1000 }
      });

      // Audio request after ticket used
      const audioRes = await app.inject({
        method: 'GET',
        url: `/api/audio/${firstRound.ticketId}`
      });
      expect(audioRes.statusCode).toBe(409);
      expect(JSON.parse(audioRes.body).error).toBe('TICKET_ALREADY_USED');
    });
  });

  describe('Music Provider Abstraction', () => {
    it('implements MusicProvider contract in LocalFixtureProvider', async () => {
      expect(localFixtureProvider.providerId).toBe('local-fixtures');

      // Search songs through provider interface
      const searchResults = await localFixtureProvider.searchSongs('Horizon');
      expect(searchResults.length).toBeGreaterThanOrEqual(1);
      expect(searchResults.some((s) => s.title.includes('Horizon') || s.artist.includes('Horizon'))).toBe(true);

      // Metadata lookup
      const metadata = await localFixtureProvider.getSongMetadata('song_synth_pop_1');
      expect(metadata).toBeDefined();
      expect(metadata?.artist).toBe('The Midnight Waves');
      expect(metadata?.releaseYear).toBe(1984);

      // Playable preview resolution
      const preview = await localFixtureProvider.getPlayablePreview('song_synth_pop_1');
      expect(preview).toBeDefined();
      expect(preview?.format).toBe('audio/wav');
      expect(preview?.durationSec).toBe(30.0);
      expect(preview?.isLocalFixture).toBe(true);

      // Availability check
      const isAvailable = await localFixtureProvider.validatePreviewAvailability('song_synth_pop_1');
      expect(isAvailable).toBe(true);

      const nonExistent = await localFixtureProvider.validatePreviewAvailability('non_existent_id');
      expect(nonExistent).toBe(false);
    });

    it('manages active provider via MusicProviderRegistry', () => {
      const activeProvider = musicProviderRegistry.getActiveProvider();
      expect(activeProvider.providerId).toBe('local-fixtures');
    });
  });

  describe('End-to-End Gameplay & Failure Paths', () => {
    it('executes a full end-to-end game flow from session creation to history ledger', async () => {
      // 1. Create a 2-round session with Rock filter
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          mode: 'arcade',
          difficulty: 'normal',
          guessDuration: 2.0,
          roundsCount: 2,
          genre: 'Rock'
        }
      });
      expect(createRes.statusCode).toBe(201);
      const sessionData = JSON.parse(createRes.body);
      const sessionId = sessionData.session.id;
      let currentTicketId = sessionData.firstRound.ticketId;

      expect(sessionData.session.status).toBe('active');
      expect(sessionData.session.genre).toBe('Rock');

      // 2. Stream audio for Round 1
      const audio1Res = await app.inject({
        method: 'GET',
        url: `/api/audio/${currentTicketId}`,
        headers: { range: 'bytes=0-499' }
      });
      expect(audio1Res.statusCode).toBe(206);
      expect(audio1Res.headers['content-type']).toBe('audio/wav');

      // 3. Submit valid guess for Round 1
      const ticket1 = await prisma.roundTicket.findUnique({
        where: { ticketId: currentTicketId },
        include: { song: true }
      });
      const guess1Res = await app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/guess`,
        payload: {
          ticketId: currentTicketId,
          guessText: ticket1!.song.title,
          reactionTimeMs: 1200
        }
      });
      expect(guess1Res.statusCode).toBe(200);
      const guess1Data = JSON.parse(guess1Res.body);
      expect(guess1Data.roundNumber).toBe(1);
      expect(guess1Data.pointsAwarded).toBeGreaterThan(0);
      expect(guess1Data.isSessionCompleted).toBe(false);

      // 4. Request Round 2 ticket
      const round2Res = await app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/tickets`
      });
      expect(round2Res.statusCode).toBe(201);
      const round2Data = JSON.parse(round2Res.body);
      expect(round2Data.nextRound.roundNumber).toBe(2);
      currentTicketId = round2Data.nextRound.ticketId;

      // 5. Stream audio for Round 2
      const audio2Res = await app.inject({
        method: 'GET',
        url: `/api/audio/${currentTicketId}`
      });
      expect(audio2Res.statusCode).toBe(200);

      // 6. Submit valid guess for Round 2 (Completes Match)
      const ticket2 = await prisma.roundTicket.findUnique({
        where: { ticketId: currentTicketId },
        include: { song: true }
      });
      const guess2Res = await app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/guess`,
        payload: {
          ticketId: currentTicketId,
          guessText: ticket2!.song.title,
          reactionTimeMs: 1400
        }
      });
      expect(guess2Res.statusCode).toBe(200);
      const guess2Data = JSON.parse(guess2Res.body);
      expect(guess2Data.roundNumber).toBe(2);
      expect(guess2Data.isSessionCompleted).toBe(true);

      // 7. Verify session status is updated to completed
      const checkSessionRes = await app.inject({
        method: 'GET',
        url: `/api/sessions/${sessionId}`
      });
      expect(checkSessionRes.statusCode).toBe(200);
      expect(JSON.parse(checkSessionRes.body).session.status).toBe('completed');

      // 8. Verify history ledger recorded the completed game
      const historyRes = await app.inject({
        method: 'GET',
        url: '/api/history?limit=10'
      });
      expect(historyRes.statusCode).toBe(200);
      const historyData = JSON.parse(historyRes.body);
      expect(historyData.gamesPlayed).toBeGreaterThanOrEqual(1);

      const foundRecord = historyData.recentGames.find((g: { sessionId: string }) => g.sessionId === sessionId);
      expect(foundRecord).toBeDefined();
      expect(foundRecord.roundsPlayed).toBe(2);
      expect(foundRecord.finalScore).toBeGreaterThan(0);
    });

    it('executes a complete end-to-end failure path verifying all rejection gates', async () => {
      // 1. Attempt session creation with impossible filter -> Rejection 400
      const impossibleFilterRes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          mode: 'arcade',
          difficulty: 'impossible',
          guessDuration: 0.5,
          roundsCount: 5,
          genre: 'NonExistentGenre'
        }
      });
      expect(impossibleFilterRes.statusCode).toBe(400);
      expect(JSON.parse(impossibleFilterRes.body).error).toBe('INSUFFICIENT_SONGS');

      // 2. Create valid session
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { mode: 'arcade', difficulty: 'normal', guessDuration: 0.5, roundsCount: 1 }
      });
      expect(createRes.statusCode).toBe(201);
      const { session, firstRound } = JSON.parse(createRes.body);

      // 3. Audio access with forged ticket -> Rejection 404
      const badAudioRes = await app.inject({
        method: 'GET',
        url: '/api/audio/tkt_forged_ticket_123456789'
      });
      expect(badAudioRes.statusCode).toBe(404);
      expect(JSON.parse(badAudioRes.body).error).toBe('TICKET_NOT_FOUND');

      // 4. Guess submission with forged ticket -> Rejection 404
      const badGuessRes = await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/guess`,
        payload: { ticketId: 'tkt_forged_ticket_123456789', guessText: 'Title' }
      });
      expect(badGuessRes.statusCode).toBe(404);
      expect(JSON.parse(badGuessRes.body).error).toBe('TICKET_NOT_FOUND');

      // 5. Expire ticket manually and verify audio stream is rejected -> Rejection 403
      await prisma.roundTicket.update({
        where: { ticketId: firstRound.ticketId },
        data: { expiresAt: new Date(Date.now() - 5000) }
      });

      const expiredAudioRes = await app.inject({
        method: 'GET',
        url: `/api/audio/${firstRound.ticketId}`
      });
      expect(expiredAudioRes.statusCode).toBe(403);
      expect(JSON.parse(expiredAudioRes.body).error).toBe('TICKET_EXPIRED');

      // 6. Expired ticket guess submission is rejected -> Rejection 403
      const expiredGuessRes = await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/guess`,
        payload: { ticketId: firstRound.ticketId, guessText: 'Neon Horizon' }
      });
      expect(expiredGuessRes.statusCode).toBe(403);
      expect(JSON.parse(expiredGuessRes.body).error).toBe('TICKET_EXPIRED');
    });
  });

  describe('SongSpot-Style Progressive Audio & Spotify Playlist Integration', () => {
    it('initializes game sessions at progressive stage 0 (0.1s)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          difficulty: 'medium',
          roundsCount: 3
        }
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.firstRound.durationSec).toBe(0.1);
      expect(body.firstRound.stageIndex).toBe(0);
    });

    it('progressively advances clue stages on skip (0.1s -> 0.5s -> 2.0s -> 8.0s -> 15.0s -> reveal)', async () => {
      // 1. Create a 1-round session
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          difficulty: 'easy',
          roundsCount: 1
        }
      });
      const { session, firstRound } = JSON.parse(createRes.body);
      expect(firstRound.stageIndex).toBe(0);
      expect(firstRound.durationSec).toBe(0.1);

      // Stage 0 -> Stage 1 (0.5s)
      const skip1Res = await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/skip`,
        payload: { ticketId: firstRound.ticketId }
      });
      expect(skip1Res.statusCode).toBe(200);
      const skip1 = JSON.parse(skip1Res.body);
      expect(skip1.stageIndex).toBe(1);
      expect(skip1.durationSec).toBe(0.5);
      expect(skip1.isRevealed).toBe(false);

      // Stage 1 -> Stage 2 (2.0s)
      const skip2Res = await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/skip`,
        payload: { ticketId: firstRound.ticketId }
      });
      const skip2 = JSON.parse(skip2Res.body);
      expect(skip2.stageIndex).toBe(2);
      expect(skip2.durationSec).toBe(2.0);

      // Stage 2 -> Stage 3 (8.0s)
      const skip3Res = await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/skip`,
        payload: { ticketId: firstRound.ticketId }
      });
      const skip3 = JSON.parse(skip3Res.body);
      expect(skip3.stageIndex).toBe(3);
      expect(skip3.durationSec).toBe(8.0);

      // Stage 3 -> Stage 4 (15.0s)
      const skip4Res = await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/skip`,
        payload: { ticketId: firstRound.ticketId }
      });
      const skip4 = JSON.parse(skip4Res.body);
      expect(skip4.stageIndex).toBe(4);
      expect(skip4.durationSec).toBe(15.0);
      expect(skip4.isRevealed).toBe(false);

      // Skipping on Stage 4 (15.0s) ends round as skipped / 0 points and reveals song
      const finalSkipRes = await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/skip`,
        payload: { ticketId: firstRound.ticketId }
      });
      expect(finalSkipRes.statusCode).toBe(200);
      const finalSkip = JSON.parse(finalSkipRes.body);
      expect(finalSkip.isRevealed).toBe(true);
      expect(finalSkip.pointsAwarded).toBe(0);
      expect(finalSkip.revealedSong).toBeDefined();
      expect(finalSkip.revealedSong.title).toBeDefined();
      expect(finalSkip.isSessionCompleted).toBe(true);
    });

    it('advances clue stage on wrong guess when advanceOnWrong is true', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { difficulty: 'easy', roundsCount: 1 }
      });
      const { session, firstRound } = JSON.parse(createRes.body);

      // Submit incorrect guess at stage 0 (0.1s) with advanceOnWrong: true
      const guessRes = await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/guess`,
        payload: {
          ticketId: firstRound.ticketId,
          guessText: 'Completely Wrong Song Title XYZ',
          reactionTimeMs: 500,
          advanceOnWrong: true
        }
      });

      expect(guessRes.statusCode).toBe(200);
      const body = JSON.parse(guessRes.body);
      expect(body.isCorrect).toBe(false);
      expect(body.isRevealed).toBe(false);
      expect(body.stageIndex).toBe(1);
      expect(body.durationSec).toBe(0.5);
    });

    it('supports all 5 difficulty levels (easy, medium, hard, expert, impossible)', async () => {
      const difficulties = ['easy', 'medium', 'hard', 'expert', 'impossible'];

      for (const diff of difficulties) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/sessions',
          payload: {
            difficulty: diff,
            roundsCount: 2
          }
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.session.difficulty).toBe(diff);
      }
    });

    it('supports next round ticket generation via POST /api/sessions/:id/rounds/next alias', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { difficulty: 'easy', roundsCount: 2 }
      });
      const { session } = JSON.parse(createRes.body);

      const nextRes = await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/rounds/next`
      });

      expect(nextRes.statusCode).toBe(201);
      const nextBody = JSON.parse(nextRes.body);
      expect(nextBody.nextRound.roundNumber).toBe(2);
      expect(nextBody.nextRound.stageIndex).toBe(0);
      expect(nextBody.nextRound.durationSec).toBe(0.1);
    });

    it('rejects invalid Spotify playlist URLs with 400 INVALID_SPOTIFY_URL', async () => {
      const badUrls = [
        'https://notspotify.com/playlist/12345',
        'https://open.spotify.com/track/1234567890123456789012',
        'random-text-string'
      ];

      for (const url of badUrls) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/spotify/playlists/import',
          payload: { url }
        });
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toBe('INVALID_SPOTIFY_URL');
      }
    });

    it('imports Spotify playlist with metadata and playable tracks (handling query params)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/spotify/playlists/import',
        payload: {
          url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abcd1234efgh'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.playlist.id).toBe('37i9dQZF1DXcBWIGoYBM5M');
      expect(body.playlist.totalTracks).toBeGreaterThanOrEqual(10);
      expect(body.playlist.playableCount).toBeGreaterThanOrEqual(5);
      expect(body.playlist.unplayableCount).toBeGreaterThanOrEqual(1);
      expect(body.playlist.tracks.length).toBeGreaterThanOrEqual(10);
      expect(body.playlist.isMockProvider).toBe(true); // Transparent development mock indicator
    });

    it('creates game session using ONLY imported Spotify playlist pool', async () => {
      const playlistId = '37i9dQZF1DXcBWIGoYBM5M';

      // Ensure playlist tracks are imported
      await app.inject({
        method: 'POST',
        url: '/api/spotify/playlists/import',
        payload: { url: `https://open.spotify.com/playlist/${playlistId}` }
      });

      // Start game session bounded strictly to this Spotify playlist
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          sourceType: 'SPOTIFY_PLAYLIST',
          playlistId,
          playlistName: 'My Rock Favorites',
          roundsCount: 3
        }
      });

      expect(createRes.statusCode).toBe(201);
      const body = JSON.parse(createRes.body);
      expect(body.session.sourceType).toBe('SPOTIFY_PLAYLIST');
      expect(body.session.playlistId).toBe(playlistId);

      // Verify the selected song actually came from the playlist pool
      const firstTicket = await prisma.roundTicket.findUnique({
        where: { ticketId: body.firstRound.ticketId },
        include: { song: true }
      });
      expect(firstTicket?.song.spotifyPlaylistId).toBe(playlistId);
    });

    it('rejects Spotify playlist game session if insufficient matching songs exist in the pool', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          sourceType: 'SPOTIFY_PLAYLIST',
          playlistId: 'non_existent_playlist_pool',
          roundsCount: 5
        }
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('INSUFFICIENT_SONGS');
    });
  });
});



