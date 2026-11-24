import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to write a 44-byte standard RIFF WAV header for 16-bit mono PCM.
function createWavHeader(sampleRate: number, numSamples: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = numSamples * blockAlign;
  const buffer = Buffer.alloc(44);

  // RIFF chunk descriptor
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt subchunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data subchunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

interface NoteEvent {
  startTime: number;
  duration: number;
  freq: number;
  harmonics?: number[];
}

// Synthesizes a mono 16-bit PCM buffer from musical note events.
function synthesizeClip(sampleRate: number, totalSeconds: number, notes: NoteEvent[]): Buffer {
  const numSamples = Math.floor(sampleRate * totalSeconds);
  const dataBuffer = Buffer.alloc(numSamples * 2);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;

    for (const note of notes) {
      if (t >= note.startTime && t < note.startTime + note.duration) {
        const noteT = t - note.startTime;
        // Simple attack/decay envelope (50ms attack, gradual decay)
        const attack = Math.min(1.0, noteT / 0.05);
        const decay = Math.max(0.0, 1.0 - noteT / note.duration);
        const envelope = attack * Math.pow(decay, 0.7);

        // Fundamental
        let wave = Math.sin(2 * Math.PI * note.freq * noteT);

        // Harmonics
        if (note.harmonics) {
          for (let h = 0; h < note.harmonics.length; h++) {
            const hNum = h + 2;
            const hAmp = note.harmonics[h];
            wave += hAmp * Math.sin(2 * Math.PI * (note.freq * hNum) * noteT);
          }
        }

        sample += wave * envelope * 0.35;
      }
    }

    // Soft clip limiter
    const clamped = Math.max(-0.95, Math.min(0.95, sample));
    const intSample = Math.round(clamped * 32767);
    dataBuffer.writeInt16LE(intSample, i * 2);
  }

  const header = createWavHeader(sampleRate, numSamples);
  return Buffer.concat([header, dataBuffer]);
}

export function generateAllFixtures(targetDir: string) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const sampleRate = 44100;
  const durationSec = 10;

  // 1. Synth Pop: C major to A minor progression (C4: 261.63, E4: 329.63, G4: 392.0, A4: 440.0)
  const synthNotes: NoteEvent[] = [
    { startTime: 0.0, duration: 2.5, freq: 261.63, harmonics: [0.5, 0.25, 0.1] },
    { startTime: 0.0, duration: 2.5, freq: 329.63, harmonics: [0.4, 0.2] },
    { startTime: 0.0, duration: 2.5, freq: 392.0, harmonics: [0.3, 0.15] },
    { startTime: 2.5, duration: 2.5, freq: 220.0, harmonics: [0.5, 0.25, 0.1] },
    { startTime: 2.5, duration: 2.5, freq: 261.63, harmonics: [0.4, 0.2] },
    { startTime: 2.5, duration: 2.5, freq: 329.63, harmonics: [0.3, 0.15] },
    { startTime: 5.0, duration: 2.5, freq: 174.61, harmonics: [0.5, 0.25] },
    { startTime: 5.0, duration: 2.5, freq: 261.63, harmonics: [0.4, 0.2] },
    { startTime: 7.5, duration: 2.5, freq: 196.0, harmonics: [0.5, 0.25] },
    { startTime: 7.5, duration: 2.5, freq: 293.66, harmonics: [0.4, 0.2] }
  ];

  // 2. Funk Bass Groove: D minor syncopated rhythm (D2: 73.42, F2: 87.31, G2: 98.0, A2: 110.0)
  const funkNotes: NoteEvent[] = [
    { startTime: 0.0, duration: 0.4, freq: 73.42, harmonics: [0.7, 0.4, 0.2] },
    { startTime: 0.5, duration: 0.3, freq: 73.42, harmonics: [0.7, 0.4, 0.2] },
    { startTime: 1.0, duration: 0.4, freq: 87.31, harmonics: [0.6, 0.3] },
    { startTime: 1.5, duration: 0.5, freq: 98.0, harmonics: [0.6, 0.3] },
    { startTime: 2.5, duration: 0.4, freq: 110.0, harmonics: [0.6, 0.3] },
    { startTime: 3.5, duration: 0.5, freq: 73.42, harmonics: [0.7, 0.4] },
    { startTime: 5.0, duration: 0.4, freq: 73.42, harmonics: [0.7, 0.4] },
    { startTime: 6.0, duration: 0.6, freq: 87.31, harmonics: [0.6, 0.3] },
    { startTime: 7.5, duration: 0.5, freq: 98.0, harmonics: [0.6, 0.3] },
    { startTime: 8.5, duration: 1.2, freq: 73.42, harmonics: [0.7, 0.4, 0.2] }
  ];

  // 3. Rock Riff: E minor overdrive power chords (E2: 82.41, B2: 123.47, G3: 196.0)
  const rockNotes: NoteEvent[] = [
    { startTime: 0.0, duration: 1.8, freq: 82.41, harmonics: [0.8, 0.6, 0.4, 0.2] },
    { startTime: 0.0, duration: 1.8, freq: 123.47, harmonics: [0.7, 0.5, 0.3] },
    { startTime: 2.0, duration: 1.2, freq: 98.0, harmonics: [0.8, 0.6, 0.4] },
    { startTime: 3.5, duration: 2.0, freq: 110.0, harmonics: [0.8, 0.6, 0.4] },
    { startTime: 6.0, duration: 1.5, freq: 82.41, harmonics: [0.8, 0.6, 0.4] },
    { startTime: 7.8, duration: 2.0, freq: 73.42, harmonics: [0.8, 0.6, 0.4] }
  ];

  // 4. Modal Jazz Chords: D minor 9th (D3: 146.83, F3: 174.61, A3: 220.0, C4: 261.63, E4: 329.63)
  const jazzNotes: NoteEvent[] = [
    { startTime: 0.0, duration: 4.5, freq: 146.83, harmonics: [0.3, 0.1] },
    { startTime: 0.0, duration: 4.5, freq: 174.61, harmonics: [0.25, 0.1] },
    { startTime: 0.0, duration: 4.5, freq: 220.0, harmonics: [0.2, 0.1] },
    { startTime: 0.0, duration: 4.5, freq: 261.63, harmonics: [0.2, 0.05] },
    { startTime: 0.0, duration: 4.5, freq: 329.63, harmonics: [0.15, 0.05] },
    { startTime: 5.0, duration: 4.8, freq: 196.0, harmonics: [0.3, 0.1] },
    { startTime: 5.0, duration: 4.8, freq: 246.94, harmonics: [0.25, 0.1] },
    { startTime: 5.0, duration: 4.8, freq: 293.66, harmonics: [0.2, 0.1] },
    { startTime: 5.0, duration: 4.8, freq: 349.23, harmonics: [0.2, 0.05] }
  ];

  const fixtures = [
    { name: 'fixture_synth_pop.wav', notes: synthNotes },
    { name: 'fixture_funk_groove.wav', notes: funkNotes },
    { name: 'fixture_rock_riff.wav', notes: rockNotes },
    { name: 'fixture_jazz_chords.wav', notes: jazzNotes }
  ];

  for (const f of fixtures) {
    const filePath = path.join(targetDir, f.name);
    const wavBuffer = synthesizeClip(sampleRate, durationSec, f.notes);
    fs.writeFileSync(filePath, wavBuffer);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outDir = path.resolve(__dirname, '../fixtures/audio');
  generateAllFixtures(outDir);
  console.log(`Generated 4 development audio fixtures in ${outDir}`);
}
