// Normalizes a string by stripping accents, parenthetical metadata, punctuation, and extra whitespace.
export function normalizeSongString(input: string): string {
  if (!input) return '';

  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Remove bracketed or parenthesized tags like [Radio Edit], (Remastered 2011), (Deluxe)
    .replace(/\s*[\(\[][^\)\]]*(feat|ft|remaster|deluxe|version|edit|live|mono|stereo|bonus|mix)[^\)\]]*[\)\]]/gi, '')
    // Remove standalone featuring credits with proper word boundaries
    .replace(/\s*\b(feat|ft|featuring)\b\.?\s+.*$/gi, '')
    // Replace punctuation with spaces
    .replace(/[^a-z0-9\s]/gi, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

// Compute the Levenshtein edit distance between two strings.
export function computeLevenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, // deletion
        dp[i][j - 1] + 1, // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return dp[m][n];
}

// Calculates similarity ratio between 0.0 and 1.0.
export function calculateStringSimilarity(s1: string, s2: string): number {
  const norm1 = normalizeSongString(s1);
  const norm2 = normalizeSongString(s2);

  if (norm1 === norm2) return 1.0;
  if (norm1.length === 0 || norm2.length === 0) return 0.0;

  const distance = computeLevenshteinDistance(norm1, norm2);
  const maxLength = Math.max(norm1.length, norm2.length);
  return 1.0 - distance / maxLength;
}

export interface MatchEvaluationResult {
  isCorrect: boolean;
  isPartial: boolean;
  similarity: number;
}

// Evaluates whether a user's guess matches target song title and artist.
export function evaluateSongGuess(
  guess: string,
  targetTitle: string,
  targetArtist: string
): MatchEvaluationResult {
  const normGuess = normalizeSongString(guess);
  const normTitle = normalizeSongString(targetTitle);
  const normArtist = normalizeSongString(targetArtist);

  if (!normGuess) {
    return { isCorrect: false, isPartial: false, similarity: 0 };
  }

  // Exact or near-exact match on title alone
  const titleSimilarity = calculateStringSimilarity(normGuess, normTitle);
  const distance = computeLevenshteinDistance(normGuess, normTitle);

  // Match if 85%+ similar, or for longer titles (>= 10 chars) allow edit distance up to 3
  const isTitleMatch =
    normGuess === normTitle ||
    titleSimilarity >= 0.85 ||
    (normTitle.length >= 10 && (titleSimilarity >= 0.80 || distance <= 3));

  if (isTitleMatch) {
    return { isCorrect: true, isPartial: false, similarity: titleSimilarity };
  }

  // Check combined string "Artist Title" or "Title Artist"
  const combinedForward = `${normArtist} ${normTitle}`;
  const combinedReverse = `${normTitle} ${normArtist}`;
  const forwardSim = calculateStringSimilarity(normGuess, combinedForward);
  const reverseSim = calculateStringSimilarity(normGuess, combinedReverse);
  const maxCombinedSim = Math.max(forwardSim, reverseSim);

  if (maxCombinedSim >= 0.80) {
    return { isCorrect: true, isPartial: false, similarity: maxCombinedSim };
  }

  // Check substring containment for longer titles (length >= 5)
  if (normTitle.length >= 5 && (normGuess.includes(normTitle) || normTitle.includes(normGuess))) {
    return { isCorrect: true, isPartial: false, similarity: 0.9 };
  }

  // Partial match check: user correctly entered the artist name
  const artistSimilarity = calculateStringSimilarity(normGuess, normArtist);
  const isArtistMatched =
    artistSimilarity >= 0.85 ||
    (normArtist.length >= 4 && normGuess.includes(normArtist));

  if (isArtistMatched) {
    return { isCorrect: false, isPartial: true, similarity: artistSimilarity };
  }

  return {
    isCorrect: false,
    isPartial: false,
    similarity: Math.max(titleSimilarity, maxCombinedSim)
  };
}
