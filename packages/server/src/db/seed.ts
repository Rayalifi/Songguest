import { prisma } from './client.js';

export const SEED_SONGS = [
  // EASY DIFFICULTY TIER (Popularity 80-100)
  {
    id: 'song_synth_pop_1',
    title: 'Neon Horizon',
    artist: 'The Midnight Waves',
    album: 'Electric Dreams',
    releaseYear: 1984,
    genre: 'Electronic',
    subgenres: 'Synth-Pop, New Wave',
    language: 'en',
    popularityScore: 85,
    audioFixturePath: 'fixture_synth_pop.wav',
    previewOffsetSec: 0.0,
    provider: 'local-fixtures'
  },
  {
    id: 'song_disco_superstar',
    title: 'Starlight Velocity',
    artist: 'Galaxy Disco',
    album: 'Orbiting Groove',
    releaseYear: 1979,
    genre: 'Electronic',
    subgenres: 'Disco, Space Disco',
    language: 'en',
    popularityScore: 92,
    audioFixturePath: 'fixture_synth_pop.wav',
    previewOffsetSec: 0.0,
    provider: 'local-fixtures'
  },
  {
    id: 'song_rock_anthem',
    title: 'Electric Skyline',
    artist: 'Apex Horizon',
    album: 'Stadium Thunder',
    releaseYear: 1987,
    genre: 'Rock',
    subgenres: 'Arena Rock, Classic Rock',
    language: 'en',
    popularityScore: 88,
    audioFixturePath: 'fixture_rock_riff.wav',
    previewOffsetSec: 0.0,
    provider: 'local-fixtures'
  },
  {
    id: 'song_funk_groove_easy',
    title: 'Super Groove',
    artist: 'Funk Dynasty',
    album: 'Cosmic Basslines',
    releaseYear: 1977,
    genre: 'Funk',
    subgenres: 'P-Funk, Funk',
    language: 'en',
    popularityScore: 90,
    audioFixturePath: 'fixture_funk_groove.wav',
    previewOffsetSec: 0.0,
    provider: 'local-fixtures'
  },

  // MEDIUM DIFFICULTY TIER (Popularity 60-79)
  {
    id: 'song_funk_groove_2',
    title: 'Solar Groove',
    artist: 'Funk Dynasty',
    album: 'Cosmic Basslines',
    releaseYear: 1978,
    genre: 'Funk',
    subgenres: 'Disco, Funk',
    language: 'en',
    popularityScore: 72,
    audioFixturePath: 'fixture_funk_groove.wav',
    previewOffsetSec: 0.0,
    provider: 'local-fixtures'
  },
  {
    id: 'song_rock_heavy',
    title: 'Thunder Overdrive',
    artist: 'Heavy Voltage',
    album: 'High Voltage Circuit',
    releaseYear: 1991,
    genre: 'Rock',
    subgenres: 'Hard Rock, Grunge',
    language: 'en',
    popularityScore: 70,
    audioFixturePath: 'fixture_rock_riff.wav',
    previewOffsetSec: 0.0,
    provider: 'local-fixtures'
  },
  {
    id: 'song_spanish_rock',
    title: 'Fuego En La Noche',
    artist: 'Los Guitarras',
    album: 'Corazon Electrico',
    releaseYear: 1995,
    genre: 'Rock',
    subgenres: 'Latin Rock',
    language: 'es',
    popularityScore: 65,
    audioFixturePath: 'fixture_rock_riff.wav',
    previewOffsetSec: 0.0,
    provider: 'local-fixtures'
  },
  {
    id: 'song_japanese_synth',
    title: 'Tokyo Neon Lights',
    artist: 'City Pop Ensemble',
    album: 'Pacific Breeze',
    releaseYear: 1986,
    genre: 'Electronic',
    subgenres: 'City Pop, Synth-Pop',
    language: 'ja',
    popularityScore: 75,
    audioFixturePath: 'fixture_synth_pop.wav',
    previewOffsetSec: 0.0,
    provider: 'local-fixtures'
  },

  // HARD DIFFICULTY TIER (Popularity 40-59)
  {
    id: 'song_alt_rock_deep',
    title: 'Echoes of Distortion',
    artist: 'Heavy Voltage',
    album: 'High Voltage Circuit',
    releaseYear: 1998,
    genre: 'Rock',
    subgenres: 'Alternative Rock, Grunge',
    language: 'en',
    popularityScore: 50,
    audioFixturePath: 'fixture_rock_riff.wav',
    previewOffsetSec: 0.0,
    provider: 'local-fixtures'
  },
  {
    id: 'song_jazz_cool',
    title: 'Blue Midnight',
    artist: 'Miles Trio',
    album: 'Midnight Voicings',
    releaseYear: 1968,
    genre: 'Jazz',
    subgenres: 'Hard Bop, Modal Jazz',
    language: 'en',
    popularityScore: 45,
    audioFixturePath: 'fixture_jazz_chords.wav',
    previewOffsetSec: 0.0,
    provider: 'local-fixtures'
  },
  {
    id: 'song_spanish_funk',
    title: 'Ritmo Salvaje',
    artist: 'Sabor Latino',
    album: 'Calle de Oro',
    releaseYear: 2002,
    genre: 'Funk',
    subgenres: 'Funk Latino',
    language: 'es',
    popularityScore: 48,
    audioFixturePath: 'fixture_funk_groove.wav',
    previewOffsetSec: 0.0,
    provider: 'local-fixtures'
  },
  {
    id: 'song_velvet_horizon',
    title: 'Velvet Horizon',
    artist: 'The Velvet Phantoms',
    album: 'Twilight Waves',
    releaseYear: 1994,
    genre: 'Rock',
    subgenres: 'Shoegaze, Dream Pop',
    language: 'en',
    popularityScore: 55,
    audioFixturePath: 'fixture_rock_riff.wav',
    previewOffsetSec: 0.0,
    provider: 'local-fixtures'
  },

  // EXPERT DIFFICULTY TIER (Popularity 20-39)
  {
    id: 'song_kraut_synth',
    title: 'Subterranean Pulse',
    artist: 'Klangwerk',
    album: 'Autobahn Visionen',
    releaseYear: 1975,
    genre: 'Electronic',
    subgenres: 'Krautrock, Motorik',
    language: 'de',
    popularityScore: 38,
    audioFixturePath: 'fixture_synth_pop.wav',
    previewOffsetSec: 0.0,
    provider: 'local-fixtures'
  },
  {
    id: 'song_jazz_chords_4',
    title: 'Blue Velvet Hour',
    artist: 'Miles Trio',
    album: 'Midnight Voicings',
    releaseYear: 1963,
    genre: 'Jazz',
    subgenres: 'Modal Jazz, Post-Bop',
    language: 'en',
    popularityScore: 25,
    audioFixturePath: 'fixture_jazz_chords.wav',
    previewOffsetSec: 0.0,
    provider: 'local-fixtures'
  },
  {
    id: 'song_deep_jazz_modal',
    title: 'Phrygian Shadows',
    artist: 'Contemporary Sextet',
    album: 'Abstract Cadences',
    releaseYear: 1959,
    genre: 'Jazz',
    subgenres: 'Modal Jazz',
    language: 'en',
    popularityScore: 28,
    audioFixturePath: 'fixture_jazz_chords.wav',
    previewOffsetSec: 0.0,
    provider: 'local-fixtures'
  },
  {
    id: 'song_abstract_harmonics',
    title: 'Abstract Harmonics',
    artist: 'Analog Pioneers',
    album: 'Modular Series',
    releaseYear: 1982,
    genre: 'Electronic',
    subgenres: 'Ambient, IDM',
    language: 'en',
    popularityScore: 32,
    audioFixturePath: 'fixture_synth_pop.wav',
    previewOffsetSec: 0.0,
    provider: 'local-fixtures'
  },

  // IMPOSSIBLE DIFFICULTY TIER (Popularity 0-19)
  {
    id: 'song_avant_garde_rock',
    title: 'Obscure Resonance',
    artist: 'The Velvet Phantoms',
    album: 'Underground Cellar',
    releaseYear: 1971,
    genre: 'Rock',
    subgenres: 'Experimental Rock, Psychedelic',
    language: 'en',
    popularityScore: 15,
    audioFixturePath: 'fixture_rock_riff.wav',
    previewOffsetSec: 0.0,
    provider: 'local-fixtures'
  },
  {
    id: 'song_underground_synth',
    title: 'Minimal Orbit',
    artist: 'Analog Pioneers',
    album: 'Tapes from the Attic',
    releaseYear: 1981,
    genre: 'Electronic',
    subgenres: 'Minimal Synth, Tape Music',
    language: 'en',
    popularityScore: 10,
    audioFixturePath: 'fixture_synth_pop.wav',
    previewOffsetSec: 0.0,
    provider: 'local-fixtures'
  },
  {
    id: 'song_microtonal_drift',
    title: 'Microtonal Drift',
    artist: 'Spectral Collective',
    album: 'Resonance Laboratory',
    releaseYear: 1969,
    genre: 'Electronic',
    subgenres: 'Musique Concrete, Avant-Garde',
    language: 'en',
    popularityScore: 8,
    audioFixturePath: 'fixture_synth_pop.wav',
    previewOffsetSec: 0.0,
    provider: 'local-fixtures'
  },
  {
    id: 'song_tape_echoes',
    title: 'Tape Echoes 1974',
    artist: 'The Archivists',
    album: 'Found Reelsa',
    releaseYear: 1974,
    genre: 'Jazz',
    subgenres: 'Free Jazz, Loft Jazz',
    language: 'en',
    popularityScore: 12,
    audioFixturePath: 'fixture_jazz_chords.wav',
    previewOffsetSec: 0.0,
    provider: 'local-fixtures'
  }
];

export async function seedDatabase() {
  const ghostSongs = await prisma.song.findMany({
    where: { audioFixturePath: 'non_existent_audio.wav' },
    select: { id: true }
  });
  if (ghostSongs.length > 0) {
    const ids = ghostSongs.map((s) => s.id);
    await prisma.roundTicket.deleteMany({ where: { songId: { in: ids } } });
    await prisma.song.deleteMany({ where: { id: { in: ids } } });
  }

  // In test environment, purge external provider records so integration tests run against isolated seed fixtures
  if (process.env.NODE_ENV === 'test') {
    const nonLocal = await prisma.song.findMany({
      where: { provider: { not: 'local-fixtures' } },
      select: { id: true }
    });
    if (nonLocal.length > 0) {
      const nonLocalIds = nonLocal.map((s) => s.id);
      await prisma.roundTicket.deleteMany({ where: { songId: { in: nonLocalIds } } });
      await prisma.song.deleteMany({ where: { id: { in: nonLocalIds } } });
    }
  }

  for (const song of SEED_SONGS) {
    await prisma.song.upsert({
      where: { id: song.id },
      update: song,
      create: song
    });
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  seedDatabase()
    .then(() => {
      console.log(`Seeded ${SEED_SONGS.length} development songs into database.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seed error:', err);
      process.exit(1);
    });
}
