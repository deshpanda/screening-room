// Recommendation core — the pure, testable part. TMDB's per-film
// recommendation lists (item-based collaborative filtering over its user
// base) are the candidate source; this module turns the owner's ratings into
// seed weights and aggregates candidates across seeds. All network work
// lives in tools/recs-build.mjs.

/** How much a rated film pushes recommendations. 5★ → 2.0 … 3.5★ → 0.5. */
export function seedWeight(rating) {
  return rating >= 3.5 ? rating - 3 : 0;
}

export const normTitle = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Merge per-seed recommendation lists into one ranked list.
 * recLists: [{ seed: {title, weight}, items: [{id, title, year, vote_average,
 *             vote_count, poster_path}] }]  (items in TMDB rank order)
 * exclude:  Set of TMDB ids AND normalized "title year" strings already seen.
 */
export function aggregate(recLists, { exclude = new Set(), excludeTitles = new Set(), minVotes = 200, limit = 14 } = {}) {
  const cand = new Map();
  for (const { seed, items } of recLists) {
    items.forEach((it, i) => {
      if (exclude.has(it.id) || exclude.has(`${normTitle(it.title)} ${it.year}`)) return;
      // same-title exclusion: no other adaptations/remakes of a watched film
      if (excludeTitles.has(normTitle(it.title))) return;
      const decay = 1 / (1 + i * 0.12);                       // TMDB's order matters
      // cubed so a 6.5 stops keeping company with an 8.2
      const quality = Math.pow((it.vote_average || 0) / 10, 3)
        * Math.min(1, Math.log10((it.vote_count || 0) + 1) / 3.5); // vote-count prior
      const add = seed.weight * decay * quality;
      const c = cand.get(it.id) || { ...it, score: 0, seenBy: 0, seeds: [] };
      c.score += add;
      c.seenBy++;
      if (!c.seeds.includes(seed.title)) c.seeds.push(seed.title);
      cand.set(it.id, c);
    });
  }
  return [...cand.values()]
    // junk floor: tiny-vote films survive only when several seeds agree
    .filter((c) => (c.vote_count || 0) >= minVotes || c.seenBy >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Jaccard-ish affinity between the user's top genres and a genre list. */
export function genreAffinity(userTopGenres, genres) {
  if (!genres.length || !userTopGenres.length) return 0.5;
  const hits = genres.filter((g) => userTopGenres.includes(g)).length;
  return 0.4 + 0.6 * (hits / genres.length);
}

// The canon — the bias the owner asked for. Directors whose unexplored
// filmographies outrank the algorithm's crowd-pleasers.
export const CANON_DIRECTORS = [
  'Stanley Kubrick', 'David Lynch', 'Sidney Lumet', 'Jean-Luc Godard',
  'Andrei Tarkovsky', 'Ingmar Bergman', 'Akira Kurosawa', 'Federico Fellini',
  'Michelangelo Antonioni', 'Robert Bresson', 'Yasujirō Ozu', 'Jean-Pierre Melville',
  'Billy Wilder', 'Alfred Hitchcock', 'Orson Welles', 'John Cassavetes',
  'Krzysztof Kieślowski', 'Agnès Varda', 'Satyajit Ray', 'Ritwik Ghatak',
  'Guru Dutt', 'Abbas Kiarostami', 'Wong Kar-wai', 'Edward Yang',
  'Hou Hsiao-hsien', 'Béla Tarr', 'Michael Haneke', 'Sergio Leone',
  'Terrence Malick', 'Paul Thomas Anderson', 'Joel Coen', 'Martin Scorsese',
  'Francis Ford Coppola', 'David Fincher', 'Denis Villeneuve', 'Bong Joon-ho',
  'Park Chan-wook', 'Luis Buñuel', 'Fritz Lang', 'Charlie Chaplin',
  'Buster Keaton', 'Mani Ratnam', 'Vishal Bhardwaj', 'Werner Herzog',
  'Wim Wenders', 'Roman Polanski', 'Elia Kazan', 'John Huston',
];

// The film-school syllabus — what serious programs screen, arranged as
// courses. Modeled on conservatory curricula and the critical canon; each
// film carries the one line a professor would say about why it's assigned.
export const SYLLABUS = [
  {
    code: 'FS 101', title: 'The grammar — silents & foundations',
    films: [
      ['Sunrise: A Song of Two Humans', '1927', 'pure visual storytelling — the camera untethered'],
      ['Battleship Potemkin', '1925', 'montage as argument; the Odessa steps built modern editing'],
      ['The General', '1926', 'action choreography and comic geometry, still unmatched'],
      ['The Passion of Joan of Arc', '1928', 'what a face in close-up can carry'],
      ['M', '1931', 'sound arrives — and is immediately used as dread'],
    ],
  },
  {
    code: 'FS 102', title: 'Classical Hollywood',
    films: [
      ['Citizen Kane', '1941', 'deep focus, structure, ego — the textbook that is also a film'],
      ['Casablanca', '1942', 'the studio system at maximum efficiency and feeling'],
      ['Sunset Boulevard', '1950', 'Hollywood autopsying itself, narrated by a corpse'],
      ['Singin’ in the Rain', '1952', 'form as joy; the industry laughing at its own sound panic'],
      ['Vertigo', '1958', 'obsession as camera movement — the canon’s dark heart'],
    ],
  },
  {
    code: 'FS 201', title: 'Neorealism & the New Wave',
    films: [
      ['Bicycle Thieves', '1948', 'non-actors, real streets — cinema leaves the studio'],
      ['Breathless', '1960', 'the jump cut as rebellion; rules broken on purpose'],
      ['The 400 Blows', '1959', 'the personal film — and that freeze-frame'],
      ['Cléo from 5 to 7', '1962', 'real time, a woman watched and watching'],
      ['La Dolce Vita', '1960', 'the episodic film; glamour as emptiness'],
    ],
  },
  {
    code: 'FS 202', title: 'The world masters',
    films: [
      ['Tokyo Story', '1953', 'stillness as devastation; the tatami shot'],
      ['Seven Samurai', '1954', 'ensemble, geography, weather — action with a soul'],
      ['Pather Panchali', '1955', 'a whole cinema born in one village'],
      ['Persona', '1966', 'the film that interrogates its own projector'],
      ['Andrei Rublev', '1966', 'faith, art and mud — the long take as prayer'],
    ],
  },
  {
    code: 'FS 301', title: 'New Hollywood',
    films: [
      ['The Godfather', '1972', 'lighting, patience, succession — commerce perfected into art'],
      ['Chinatown', '1974', 'the screenplay every program still assigns'],
      ['Taxi Driver', '1976', 'subjectivity — the city as a diseased mind'],
      ['Apocalypse Now', '1979', 'production as madness, sound design as war'],
      ['Days of Heaven', '1978', 'magic-hour light; images that replace dialogue'],
    ],
  },
  {
    code: 'FS 302', title: 'Modern world cinema',
    films: [
      ['In the Mood for Love', '2000', 'repetition, frames within frames, desire withheld'],
      ['Yi Yi', '2000', 'the family epic at eye level'],
      ['Close-Up', '1990', 'documentary and fiction dissolving into each other'],
      ['A Separation', '2011', 'moral complexity with no villain in the room'],
      ['Parasite', '2019', 'architecture as class; genre as trojan horse'],
    ],
  },
  {
    code: 'FS 401', title: 'Form studies — editing, time, sound',
    films: [
      ['Rashomon', '1950', 'point of view as epistemology'],
      ['2001: A Space Odyssey', '1968', 'the match cut across four million years'],
      ['Come and See', '1985', 'sound and face — cinema as testimony'],
      ['Mulholland Drive', '2001', 'dream logic held together by feeling, not plot'],
      ['There Will Be Blood', '2007', 'performance, score and landscape as one organism'],
    ],
  },
];

// TMDB's stable numeric genre ids (used by person-credit responses).
export const TMDB_GENRES = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance',
  878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
};
