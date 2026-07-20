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

// The film-school degree — a four-year program modeled on conservatory
// curricula and the critical canon. Each course carries what it teaches and
// an assignment; each film, the line a professor would say about it.
export const SYLLABUS = [
  // ---------- YEAR ONE — foundations ----------
  {
    code: 'FS 101', year: 1, title: 'The grammar — silents & foundations',
    desc: 'Where the language was invented: framing, montage, the close-up, and finally sound. Everything after is dialect.',
    assignment: 'Watch the Odessa Steps sequence twice; the second time, count the cuts.',
    films: [
      ['Sunrise: A Song of Two Humans', '1927', 'pure visual storytelling — the camera untethered'],
      ['Battleship Potemkin', '1925', 'montage as argument; the Odessa steps built modern editing'],
      ['The General', '1926', 'action choreography and comic geometry, still unmatched'],
      ['The Passion of Joan of Arc', '1928', 'what a face in close-up can carry'],
      ['M', '1931', 'sound arrives — and is immediately used as dread'],
    ],
  },
  {
    code: 'FS 102', year: 1, title: 'Classical Hollywood',
    desc: 'The studio system as a machine for storytelling: coverage, continuity, stars, and the invisible style that still runs everything you stream.',
    assignment: 'In Kane, find every cut that jumps years without a title card.',
    films: [
      ['Citizen Kane', '1941', 'deep focus, structure, ego — the textbook that is also a film'],
      ['Casablanca', '1942', 'the studio system at maximum efficiency and feeling'],
      ['Sunset Boulevard', '1950', 'Hollywood autopsying itself, narrated by a corpse'],
      ['Singin’ in the Rain', '1952', 'form as joy; the industry laughing at its own sound panic'],
      ['Vertigo', '1958', 'obsession as camera movement — the canon’s dark heart'],
    ],
  },
  {
    code: 'FS 103', year: 1, title: 'The documentary claim',
    desc: 'What does it mean to point a camera at the real? Truth, staging, memory and the essay film — nonfiction as a form, not a genre.',
    assignment: 'After The Thin Blue Line, write down what the re-enactments made you believe, and when.',
    films: [
      ['Man with a Movie Camera', '1929', 'the city symphony — editing as pure exhilaration'],
      ['Night and Fog', '1956', 'thirty-two minutes; the heaviest film ever made'],
      ['Sans Soleil', '1983', 'the essay film — memory wearing a travelogue’s clothes'],
      ['The Thin Blue Line', '1988', 'a documentary that overturned a conviction — and invented a style'],
      ['Hoop Dreams', '1994', 'five years, two families — structure found, not written'],
    ],
  },
  {
    code: 'FS 104', year: 1, title: 'The animated image',
    desc: 'Animation is not a genre for children; it is cinema freed from physics. Watch what becomes possible when every frame is authored.',
    assignment: 'In Spirited Away, track how weight is animated — food, water, a train.',
    films: [
      ['Spirited Away', '2001', 'world-building with the logic of dreams and the rules of folklore'],
      ['Grave of the Fireflies', '1988', 'the proof animation can hold the unbearable'],
      ['Akira', '1988', 'scale, motion and detail that live action still cannot buy'],
      ['Persepolis', '2007', 'a memoir in ink — style as voice'],
      ['Fantastic Mr. Fox', '2009', 'stop-motion as personality; texture you can feel'],
    ],
  },
  // ---------- YEAR TWO — movements ----------
  {
    code: 'FS 201', year: 2, title: 'Neorealism & the New Wave',
    desc: 'Cinema leaves the studio, then breaks its own rules on purpose. Non-actors, real streets, jump cuts — the invention of the personal film.',
    assignment: 'Count the jump cuts in the first ten minutes of Breathless. Decide which ones you felt.',
    films: [
      ['Bicycle Thieves', '1948', 'non-actors, real streets — cinema leaves the studio'],
      ['Breathless', '1960', 'the jump cut as rebellion; rules broken on purpose'],
      ['The 400 Blows', '1959', 'the personal film — and that freeze-frame'],
      ['Cléo from 5 to 7', '1962', 'real time, a woman watched and watching'],
      ['La Dolce Vita', '1960', 'the episodic film; glamour as emptiness'],
    ],
  },
  {
    code: 'FS 202', year: 2, title: 'The world masters',
    desc: 'Four national cinemas at their peaks. Watch for how differently a story can breathe — the tatami shot, the weather, the ensemble, the icon.',
    assignment: 'In Tokyo Story, note every time the camera moves. It will not take long.',
    films: [
      ['Tokyo Story', '1953', 'stillness as devastation; the tatami shot'],
      ['Seven Samurai', '1954', 'ensemble, geography, weather — action with a soul'],
      ['The Rules of the Game', '1939', 'the deep-focus ensemble — everyone lying in the same frame'],
      ['Persona', '1966', 'the film that interrogates its own projector'],
      ['Andrei Rublev', '1966', 'faith, art and mud — the long take as prayer'],
    ],
  },
  {
    code: 'FS 210', year: 2, title: 'Indian cinema — the parallel canon',
    desc: 'Ray’s humanism, Ghatak’s wounds, Guru Dutt’s shadows, and the masala epic — a full national cinema that most syllabi skip. Not this one.',
    assignment: 'Watch Pyaasa’s songs as scenes: what does each one do that dialogue couldn’t?',
    films: [
      ['Pather Panchali', '1955', 'a whole cinema born in one village'],
      ['Pyaasa', '1957', 'song as soliloquy; light as heartbreak'],
      ['The Cloud-Capped Star', '1960', 'Ghatak — melodrama sharpened into a scream'],
      ['Charulata', '1964', 'Ray’s chamber piece; a marriage in glances'],
      ['Sholay', '1975', 'the masala epic — genre synthesis on the widest possible screen'],
    ],
  },
  {
    code: 'FS 220', year: 2, title: 'Film noir',
    desc: 'Shadows, fatalism and voiceover: the American style built from German expressionism and post-war dread. Study the lighting before the plot.',
    assignment: 'In Double Indemnity, note when you first know it ends badly — the film tells you immediately. Why does it still work?',
    films: [
      ['Double Indemnity', '1944', 'the template — desire, insurance, and a voice from the grave'],
      ['Out of the Past', '1947', 'the past as gravity; nobody escapes the flashback'],
      ['The Third Man', '1949', 'tilted frames, a zither, and the best entrance in cinema'],
      ['Touch of Evil', '1958', 'the opening crane shot every film school screens'],
      ['Sweet Smell of Success', '1957', 'dialogue as switchblade; the city at night'],
    ],
  },
  // ---------- YEAR THREE — genre & form ----------
  {
    code: 'FS 301', year: 3, title: 'New Hollywood',
    desc: 'The auteurs take the keys to the studio. Moral ambiguity, location shooting, and endings that refuse to comfort.',
    assignment: 'Chinatown: mark the moment Gittes stops being ahead of the audience.',
    films: [
      ['The Godfather', '1972', 'lighting, patience, succession — commerce perfected into art'],
      ['Chinatown', '1974', 'the screenplay every program still assigns'],
      ['Taxi Driver', '1976', 'subjectivity — the city as a diseased mind'],
      ['Apocalypse Now', '1979', 'production as madness, sound design as war'],
      ['Days of Heaven', '1978', 'magic-hour light; images that replace dialogue'],
    ],
  },
  {
    code: 'FS 302', year: 3, title: 'Modern world cinema',
    desc: 'The last thirty years of the art house: withheld desire, dissolving fact and fiction, and class warfare staged as architecture.',
    assignment: 'In the Mood for Love: count the different appearances of the same corridor.',
    films: [
      ['In the Mood for Love', '2000', 'repetition, frames within frames, desire withheld'],
      ['Yi Yi', '2000', 'the family epic at eye level'],
      ['Close-Up', '1990', 'documentary and fiction dissolving into each other'],
      ['A Separation', '2011', 'moral complexity with no villain in the room'],
      ['Parasite', '2019', 'architecture as class; genre as trojan horse'],
    ],
  },
  {
    code: 'FS 310', year: 3, title: 'Horror & the body',
    desc: 'The genre where form is felt physically. Suspense vs. shock, implication vs. display — and why the scariest cut is the one you don’t see.',
    assignment: 'Psycho’s shower scene: list what you never actually see.',
    films: [
      ['Psycho', '1960', 'the rules of suspense broken over the audience’s head'],
      ['Rosemary’s Baby', '1968', 'dread as domesticity; the horror of being disbelieved'],
      ['The Texas Chain Saw Massacre', '1974', 'texture and sound — almost bloodless, entirely unbearable'],
      ['The Shining', '1980', 'geometry as menace; the Steadicam as ghost'],
      ['Don’t Look Now', '1973', 'grief edited into premonition'],
    ],
  },
  {
    code: 'FS 320', year: 3, title: 'The Western',
    desc: 'America arguing with its own myth. Landscape as morality, and fifty years of the genre revising itself.',
    assignment: 'The Searchers: decide whether the last doorway shot forgives Ethan. Defend it.',
    films: [
      ['The Searchers', '1956', 'the myth and its rot in the same frame'],
      ['High Noon', '1952', 'real time as moral pressure'],
      ['Once Upon a Time in the West', '1968', 'the genre slowed to opera'],
      ['McCabe & Mrs. Miller', '1971', 'the anti-western — mud, snow and Leonard Cohen'],
      ['Unforgiven', '1992', 'the genre’s own eulogy, delivered by its icon'],
    ],
  },
  {
    code: 'FS 330', year: 3, title: 'Science fiction & the future',
    desc: 'Ideas wearing production design. The genre that lets cinema think out loud about time, machines and what counts as human.',
    assignment: 'La Jetée is twenty-eight minutes of still images. Note the one moment that moves.',
    films: [
      ['Metropolis', '1927', 'the city of the future, built once and borrowed forever'],
      ['La Jetée', '1962', 'a film of photographs that out-moves most movies'],
      ['Solaris', '1972', 'science fiction as grief — the ocean that answers back'],
      ['Alien', '1979', 'industrial space; horror engineered like a machine'],
      ['Blade Runner', '1982', 'atmosphere as argument — what a world can say'],
    ],
  },
  // ---------- YEAR FOUR — advanced studies ----------
  {
    code: 'FS 401', year: 4, title: 'Form studies — editing, time, sound',
    desc: 'The capstone in technique: point of view, the cut across millennia, sound as testimony, and dream logic that holds.',
    assignment: 'Rashomon: write the fourth version of events nobody tells.',
    films: [
      ['Rashomon', '1950', 'point of view as epistemology'],
      ['2001: A Space Odyssey', '1968', 'the match cut across four million years'],
      ['Come and See', '1985', 'sound and face — cinema as testimony'],
      ['Mulholland Drive', '2001', 'dream logic held together by feeling, not plot'],
      ['There Will Be Blood', '2007', 'performance, score and landscape as one organism'],
    ],
  },
  {
    code: 'FS 402', year: 4, title: 'Slow cinema & the long take',
    desc: 'Duration as a tool. What happens to attention when the cut refuses to come — boredom, then something on the far side of it.',
    assignment: 'Jeanne Dielman: notice the exact moment routine becomes suspense.',
    films: [
      ['Jeanne Dielman, 23, quai du Commerce, 1080 Bruxelles', '1975', 'three days of routine — then the greatest ellipsis in cinema'],
      ['Playtime', '1967', 'the frame so wide you choose your own film'],
      ['Stalker', '1979', 'the long take as pilgrimage'],
      ['Werckmeister Harmonies', '2000', 'thirty-nine shots; a whale and a riot'],
      ['A Brighter Summer Day', '1991', 'four hours earned — history at the scale of a schoolyard'],
    ],
  },
  {
    code: 'FS 403', year: 4, title: 'Comedy as precision',
    desc: 'The hardest form taught last. Timing, framing and escalation — comedy is editing you can hear the audience grade.',
    assignment: 'Some Like It Hot: clock the last line. Nothing after it — that’s the lesson.',
    films: [
      ['Duck Soup', '1933', 'anarchy with perfect timing; the mirror scene'],
      ['Some Like It Hot', '1959', 'structure so tight the jokes feel inevitable'],
      ['Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb', '1964', 'the end of the world, played straight'],
      ['Monty Python and the Holy Grail', '1975', 'budget as running gag; parody with scholarship'],
      ['Toni Erdmann', '2016', 'the modern comedy of embarrassment, held one beat too long — on purpose'],
    ],
  },
  {
    code: 'FS 404', year: 4, title: 'The thesis — cinema about cinema',
    desc: 'Graduation: films that turn the camera on the act of making films. If the medium can examine itself, so can you.',
    assignment: '8½: separate the scenes that happen from the ones Guido imagines. Give up. That’s the point.',
    films: [
      ['8½', '1963', 'the artist’s block as carnival — the self-portrait every director steals from'],
      ['Day for Night', '1973', 'the set as family; the trouble as the movie'],
      ['Cinema Paradiso', '1988', 'projection as memory; the kiss reel'],
      ['Barton Fink', '1991', 'the writer’s room as inferno'],
      ['Adaptation.', '2002', 'the screenplay eating itself and surviving'],
    ],
  },
];

// The reading shelf — the books the good programs actually assign.
export const READING_SHELF = [
  ['Film Art: An Introduction', 'Bordwell & Thompson', 'the textbook — how every shot works and why'],
  ['In the Blink of an Eye', 'Walter Murch', 'editing explained by the man who cut Apocalypse Now'],
  ['Sculpting in Time', 'Andrei Tarkovsky', 'a master explaining what cinema is for'],
  ['Making Movies', 'Sidney Lumet', 'the most practical book a working director ever wrote'],
  ['Notes on the Cinematograph', 'Robert Bresson', 'aphorisms — the strictest taste ever printed'],
  ['Hitchcock/Truffaut', 'François Truffaut', 'the interview that became scripture'],
  ['On Directing Film', 'David Mamet', 'where to put the camera, argued like a fistfight'],
  ['Pictures at a Revolution', 'Mark Harris', 'five films of 1967 — the old industry dying in real time'],
];

// TMDB's stable numeric genre ids (used by person-credit responses).
export const TMDB_GENRES = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance',
  878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
};
