import { buildServer } from './index.js';
import { prisma } from './db/client.js';
import { seedDatabase } from './db/seed.js';

async function runSmokeTest() {
  console.log('[SMOKE TEST] Starting full SongSpot & Spotify journey verification...');
  await seedDatabase();
  const app = await buildServer();
  await app.ready();

  try {
    // 1. Start Quick Play Session at Stage 0 (0.1s)
    console.log('[1] Creating Quick Play session (2 rounds, hard difficulty)...');
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        sourceType: 'QUICK_PLAY',
        difficulty: 'hard',
        roundsCount: 2
      }
    });

    if (createRes.statusCode !== 201) {
      throw new Error(`Failed to create session: ${createRes.statusCode} ${createRes.body}`);
    }

    const { session, firstRound } = JSON.parse(createRes.body);
    if (firstRound.durationSec !== 0.1 || firstRound.stageIndex !== 0) {
      throw new Error(`Expected stage 0 (0.1s), got stage ${firstRound.stageIndex} (${firstRound.durationSec}s)`);
    }
    console.log(`[1 OK] Quick Play session created: ${session.id}, Round: ${firstRound.roundNumber}, Stage: ${firstRound.stageIndex} (${firstRound.durationSec}s)`);

    // 2. Progressive Clue Reveal (Skip 0.1s -> Reveal 0.5s)
    console.log('[2] Skipping initial 0.1s clue to unlock 0.5s stage...');
    const skipRes = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/skip`,
      payload: {
        ticketId: firstRound.ticketId
      }
    });

    if (skipRes.statusCode !== 200) {
      throw new Error(`Skip failed: ${skipRes.statusCode} ${skipRes.body}`);
    }
    const skipData = JSON.parse(skipRes.body);
    if (skipData.stageIndex !== 1 || skipData.durationSec !== 0.5) {
      throw new Error(`Expected progressive stage 1 (0.5s), got stage ${skipData.stageIndex}`);
    }
    console.log(`[2 OK] Clue stage advanced: ${skipData.stageIndex} (${skipData.durationSec}s)`);

    // 3. Audio Streaming with Authorized Ticket
    console.log('[3] Requesting audio stream with authorized round ticket...');
    const audioRes = await app.inject({
      method: 'GET',
      url: `/api/audio/${firstRound.ticketId}`,
      headers: {
        range: 'bytes=0-1023'
      }
    });

    if (audioRes.statusCode !== 206) {
      throw new Error(`Audio stream failed: expected 206, got ${audioRes.statusCode} ${audioRes.body}`);
    }
    console.log(`[3 OK] Audio stream verified (206 Partial Content, Content-Range: ${audioRes.headers['content-range']})`);

    // 4. Submit Guess at Stage 1 (0.5s)
    console.log('[4] Submitting guess at 0.5s stage...');
    const guessRes1 = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/guess`,
      payload: {
        ticketId: firstRound.ticketId,
        guessText: 'Echoes of Distortion Heavy Voltage',
        reactionTimeMs: 1200
      }
    });

    if (guessRes1.statusCode !== 200) {
      throw new Error(`Guess submission failed: ${guessRes1.statusCode} ${guessRes1.body}`);
    }
    const guessResult1 = JSON.parse(guessRes1.body);
    console.log(`[4 OK] Guess resolved: isCorrect=${guessResult1.isCorrect}, points=${guessResult1.pointsAwarded}`);

    // 5. Advance to Round 2 via /rounds/next
    console.log('[5] Advancing to next round via /rounds/next...');
    const nextRoundRes = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/rounds/next`
    });

    if (nextRoundRes.statusCode !== 200 && nextRoundRes.statusCode !== 201) {
      throw new Error(`Next round failed: ${nextRoundRes.statusCode} ${nextRoundRes.body}`);
    }
    const round2Data = JSON.parse(nextRoundRes.body);
    console.log(`[5 OK] Round 2 ready: Ticket ${round2Data.nextRound.ticketId}, Duration: ${round2Data.nextRound.durationSec}s`);

    // 6. Complete Round 2
    console.log('[6] Submitting guess for round 2 to complete session...');
    const guessRes2 = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/guess`,
      payload: {
        ticketId: round2Data.nextRound.ticketId,
        guessText: 'Blue Midnight Miles Trio',
        reactionTimeMs: 800
      }
    });

    if (guessRes2.statusCode !== 200) {
      throw new Error(`Round 2 guess failed: ${guessRes2.statusCode}`);
    }
    const guessResult2 = JSON.parse(guessRes2.body);
    console.log(`[6 OK] Session completed: isSessionCompleted=${guessResult2.isSessionCompleted}, totalScore=${guessResult2.totalScore}`);

    // 7. Spotify Playlist Import
    console.log('[7] Importing Spotify playlist metadata...');
    const spotifyImportRes = await app.inject({
      method: 'POST',
      url: '/api/spotify/playlists/import',
      payload: {
        url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'
      }
    });

    if (spotifyImportRes.statusCode !== 200) {
      throw new Error(`Spotify import failed: ${spotifyImportRes.statusCode} ${spotifyImportRes.body}`);
    }
    const playlistData = JSON.parse(spotifyImportRes.body);
    console.log(`[7 OK] Spotify playlist imported: "${playlistData.playlist.name}" (${playlistData.playlist.playableCount} playable tracks)`);

    // 8. Start Game Session from Spotify Playlist Pool
    console.log('[8] Starting game session using Spotify playlist pool...');
    const spotifySessionRes = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        sourceType: 'SPOTIFY_PLAYLIST',
        playlistId: playlistData.playlist.id,
        playlistName: playlistData.playlist.name,
        roundsCount: 2
      }
    });

    if (spotifySessionRes.statusCode !== 201) {
      throw new Error(`Failed to create playlist session: ${spotifySessionRes.statusCode} ${spotifySessionRes.body}`);
    }
    const spotifySessionData = JSON.parse(spotifySessionRes.body);
    console.log(`[8 OK] Spotify playlist session started: ${spotifySessionData.session.id}`);

    // 9. History Record Verification
    console.log('[9] Verifying match history...');
    const historyRes = await app.inject({
      method: 'GET',
      url: '/api/history'
    });

    if (historyRes.statusCode !== 200) {
      throw new Error(`Failed to fetch history: ${historyRes.statusCode}`);
    }
    const historyStats = JSON.parse(historyRes.body);
    const recorded = historyStats.recentGames.find((h: { sessionId: string }) => h.sessionId === session.id);
    if (!recorded) {
      throw new Error(`Session ${session.id} not found in history`);
    }
    console.log(`[9 OK] Match history confirmed: Session ${recorded.sessionId}, Score: ${recorded.finalScore}`);

    console.log('\n[SMOKE TEST PASSED] Full product re-alignment and progressive reveal verified.');
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

runSmokeTest().catch((err) => {
  console.error('[SMOKE TEST FAILED]:', err);
  process.exit(1);
});
