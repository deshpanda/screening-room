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
  {
    code: 'FS 405', year: 4, title: 'First features — the debut',
    desc: 'What a first film can announce. Five debuts where the voice arrived already whole — study what each director never had to learn.',
    assignment: 'Pick one debut and find the shot its director has been remaking ever since.',
    films: [
      ['12 Angry Men', '1957', 'Lumet’s debut — one room, twelve men, total command of geography'],
      ['Eraserhead', '1977', 'Lynch arrives fully formed — industrial dread as lullaby'],
      ['Badlands', '1973', 'Malick’s debut — murder narrated like a storybook'],
      ['Blood Simple', '1984', 'the Coens’ debut — noir mechanics, Texas heat'],
      ['Get Out', '2017', 'Peele’s debut — horror as social thesis, timed like comedy'],
    ],
  },
];

// ---------- THE GRADUATE SCHOOL — MFA I: craft studies ----------
SYLLABUS.push(
  {
    code: 'FS 501', year: 5, title: 'The image — cinematography',
    desc: 'Stop watching the story; watch the light. Where the camera sits, what the lens does, and how photography argues before anyone speaks.',
    assignment: 'In The Conformist, note which direction the light comes from in every political scene.',
    films: [
      ['The Conformist', '1970', 'Storaro — how light argues politics'],
      ['Barry Lyndon', '1975', 'candlelight and NASA lenses; painting as photography'],
      ['Roma', '2018', 'the 65mm memory — staging in depth, everything in focus'],
      ['The Tree of Life', '2011', 'natural light chasing grace notes'],
      ['Mirror', '1975', 'Tarkovsky — images as memory itself'],
    ],
  },
  {
    code: 'FS 502', year: 5, title: 'The cut — editing',
    desc: 'The only art unique to cinema. Rhythm, ellipsis, and structure — the film that exists only in the splice.',
    assignment: 'Raging Bull: pick one fight and map where the camera is allowed to be.',
    films: [
      ['Raging Bull', '1980', 'the fights — every cut a punch'],
      ['Whiplash', '2014', 'rhythm as violence; music cut like action'],
      ['All That Jazz', '1979', 'editing as autobiography — cut by the man dying in it'],
      ['Memento', '2000', 'structure as editing — the film only exists in the cut'],
      ['Sherlock Jr.', '1924', 'Keaton walks into the screen — montage as magic'],
    ],
  },
  {
    code: 'FS 503', year: 5, title: 'Sound & music',
    desc: 'Half the picture is invisible. Design, silence, and score — what the ear is told while the eye is busy.',
    assignment: 'Watch the last ten minutes of The Conversation with your eyes closed. Then rewatch.',
    films: [
      ['The Conversation', '1974', 'surveillance as sound design; the mix is the plot'],
      ['Blow Out', '1981', 'a movie about a sound man, built like one'],
      ['A Man Escaped', '1956', 'sound carries the escape; the image just waits'],
      ['No Country for Old Men', '2007', 'the score that isn’t there'],
      ['Sound of Metal', '2019', 'subjective sound — deafness mixed from the inside'],
    ],
  },
  {
    code: 'FS 504', year: 5, title: 'The screenplay',
    desc: 'Structure, dialogue, and the load a single scene can carry. Read these with your ears.',
    assignment: 'Network: pick the least famous speech and explain why it still had to be there.',
    films: [
      ['Network', '1976', 'Chayefsky — rhetoric as drama; every speech load-bearing'],
      ['Annie Hall', '1977', 'structure as confession'],
      ['Before Sunset', '2004', 'real-time dialogue with an iceberg underneath'],
      ['The Social Network', '2010', 'the deposition as engine'],
      ['Withnail & I', '1987', 'quotable is not the same as good — this is both'],
    ],
  },
  {
    code: 'FS 505', year: 5, title: 'Performance & directing actors',
    desc: 'What the camera does to acting, and what a director can ask of a human face at close range.',
    assignment: 'A Woman Under the Influence: find the moment Rowlands stops performing for the other characters.',
    films: [
      ['On the Waterfront', '1954', 'the Method arrives — the taxi scene'],
      ['A Woman Under the Influence', '1974', 'Cassavetes and Rowlands — acting past the edge of safety'],
      ['Scenes from a Marriage', '1974', 'two faces, six hours, no hiding'],
      ['The Master', '2012', 'two performances circling like animals'],
      ['Marriage Story', '2019', 'the argument scene — blocking as escalation'],
    ],
  },
  // ---------- MFA II: seminars & geographies ----------
  {
    code: 'FS 510', year: 6, title: 'German Expressionism & Weimar',
    desc: 'The set as psyche, the shadow as character. Everything noir and horror borrowed starts here.',
    assignment: 'Nosferatu: sketch the three most distorted frames. What is each distortion for?',
    films: [
      ['The Cabinet of Dr. Caligari', '1920', 'cinema discovers style — the painted mind'],
      ['Nosferatu', '1922', 'the shadow on the stairs; horror grammar, first edition'],
      ['The Last Laugh', '1924', 'Murnau unchains the camera — no intertitles needed'],
      ['Pandora’s Box', '1929', 'Louise Brooks — the modern face'],
      ['The Blue Angel', '1930', 'Dietrich; sound arrives in Weimar, cruelty intact'],
    ],
  },
  {
    code: 'FS 520', year: 6, title: 'Melodrama — the Sirk line',
    desc: 'The most underestimated register in cinema: feeling at full volume, critique smuggled in the décor.',
    assignment: 'All That Heaven Allows: inventory what the furniture says that the dialogue can’t.',
    films: [
      ['All That Heaven Allows', '1955', 'the widow and the gardener — critique dressed as kitsch'],
      ['Ali: Fear Eats the Soul', '1974', 'Fassbinder remakes Sirk with a migrant worker — sharper knife'],
      ['Brief Encounter', '1945', 'repression as romance; the train platform of the century'],
      ['Far From Heaven', '2002', 'Haynes closes the loop — pastiche with a pulse'],
      ['Mother India', '1957', 'the Indian melodrama at national-myth scale'],
    ],
  },
  {
    code: 'FS 530', year: 6, title: 'Latin American cinema',
    desc: 'From revolutionary Cuba to the new Mexican and Brazilian waves — politics, velocity and the road.',
    assignment: 'City of God: choose one edit that does sociology.',
    films: [
      ['City of God', '2002', 'kinetic editing in service of sociology'],
      ['Y Tu Mamá También', '2001', 'the road movie with a ghost narrator'],
      ['Memories of Underdevelopment', '1968', 'alienation inside a revolution'],
      ['Amores Perros', '2000', 'three stories, one crash — a national cinema announces itself'],
      ['Central Station', '1998', 'the humanist road — Brazil at eye level'],
    ],
  },
  {
    code: 'FS 540', year: 6, title: 'Africa & the Middle East',
    desc: 'The cinemas most syllabi skip: Sembène’s declaration, the Senegalese wave, Kiarostami’s questions, and insurgency shot like newsreel.',
    assignment: 'Taste of Cherry: decide what the ending does to everything before it. Change your mind once.',
    films: [
      ['Black Girl', '1966', 'Sembène — African cinema’s declaration of independence'],
      ['Touki Bouki', '1973', 'the Senegalese new wave — style to burn'],
      ['Taste of Cherry', '1997', 'a car, a question, an ending that hands you the film'],
      ['The Battle of Algiers', '1966', 'the insurgency manual, shot like newsreel'],
      ['Timbuktu', '2014', 'occupation rendered in irony and grace'],
    ],
  },
  {
    code: 'FS 550', year: 6, title: 'Women behind the camera',
    desc: 'Not a genre — a correction. Five directors, five entirely different answers to what a film is for.',
    assignment: 'Beau Travail: explain the final dance to someone who hasn’t seen the film. Fail. Watch it again.',
    films: [
      ['The Piano', '1993', 'Campion — desire scored for mud and keys'],
      ['Beau Travail', '1999', 'Denis — the body as text; that final dance'],
      ['Lost in Translation', '2003', 'Coppola — mood as narrative'],
      ['Vagabond', '1985', 'Varda — a death told backwards, without pity'],
      ['The Hurt Locker', '2008', 'Bigelow — tension engineered frame by frame'],
    ],
  },
  {
    code: 'FS 560', year: 6, title: 'Queer cinema',
    desc: 'The gaze, reciprocated. Desire, performance and community — from the ballroom floor to the painted portrait.',
    assignment: 'Portrait of a Lady on Fire: count who looks at whom, and when it becomes mutual.',
    films: [
      ['Moonlight', '2016', 'three panels, one man — the close-up as tenderness'],
      ['Portrait of a Lady on Fire', '2019', 'the gaze, reciprocated — painting as courtship'],
      ['Paris Is Burning', '1990', 'the ballroom documentary every syllabus owes'],
      ['Happy Together', '1997', 'Wong — love as exile'],
      ['Carol', '2015', 'glances across department stores — Haynes, sincere this time'],
    ],
  },
  {
    code: 'FS 570', year: 6, title: 'The avant-garde & the short film',
    desc: 'Cinema with the training wheels off: dream logic, collage, and sixteen-minute masterpieces. Where the medium tests itself.',
    assignment: 'Meshes of the Afternoon runs fourteen minutes. Watch it three times in a row — it’s designed for that.',
    films: [
      ['Un Chien Andalou', '1929', 'the eyeball — cinema’s dream logic, opening statement'],
      ['Meshes of the Afternoon', '1943', 'Deren — the American avant-garde begins at home'],
      ['Koyaanisqatsi', '1982', 'image and Glass — the wordless argument'],
      ['Daisies', '1966', 'Czech anarchy — collage, food fights, a censor’s nightmare'],
      ['World of Tomorrow', '2015', 'sixteen minutes of stick figures; more ideas than most features'],
    ],
  },
  {
    code: 'FS 580', year: 6, title: 'The Hitchcock seminar — suspense as form',
    desc: 'One director, one seminar. Suspense is information management: who knows what, and when. The bomb under the table, taught by its inventor.',
    assignment: 'Pick one scene and write down what the audience knows that the characters don’t. That gap is the engine.',
    films: [
      ['Rear Window', '1954', 'voyeurism as film-watching — the point-of-view essay'],
      ['Notorious', '1946', 'the crane shot to the key; suspense built from love and a wine cellar'],
      ['Shadow of a Doubt', '1943', 'his own favourite — evil at the family table'],
      ['Strangers on a Train', '1951', 'the transference plot; the tennis match and the carousel'],
      ['North by Northwest', '1959', 'pure cinema — set pieces strung on a MacGuffin'],
    ],
  },
);

// The theory shelf — the arguments behind the screenings.
export const THEORY_SHELF = [
  ['What Is Cinema?', 'André Bazin', 'the ontology of the image; why realism matters'],
  ['Visual Pleasure and Narrative Cinema', 'Laura Mulvey', 'the male gaze, named — the most argued twelve pages in film theory'],
  ['Against Interpretation', 'Susan Sontag', '“in place of a hermeneutics we need an erotics of art”'],
  ['Negative Space', 'Manny Farber', 'termite art vs white elephant art; criticism as jazz'],
  ['A Certain Tendency of the French Cinema', 'François Truffaut', 'the essay that lit the New Wave’s fuse'],
  ['I Lost It at the Movies', 'Pauline Kael', 'criticism with a pulse — pick fights, take sides'],
  ['Signs and Meaning in the Cinema', 'Peter Wollen', 'auteur theory given rigor'],
  ['Transcendental Style in Film', 'Paul Schrader', 'Ozu, Bresson, Dreyer — the style that withholds'],
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

// Further screening — one alternate per course, for the hungry. Not counted
// toward credit; the professor's "if this week landed, also see…".
export const SYLLABUS_EXTRAS = {
  'FS 101': ['Safety Last!', '1923', 'Harold Lloyd on the clock face — comedy as vertigo'],
  'FS 102': ['His Girl Friday', '1940', 'dialogue at 240 words a minute'],
  'FS 103': ['Grizzly Man', '2005', 'Herzog arguing with his own footage'],
  'FS 104': ['Waltz with Bashir', '2008', 'the animated documentary — memory as war'],
  'FS 201': ['Umberto D.', '1952', 'De Sica at his most unsparing'],
  'FS 202': ['Late Spring', '1949', 'Ozu again — the smile that isn’t one'],
  'FS 210': ['Guide', '1965', 'Dev Anand — the anti-hero musical'],
  'FS 220': ['In a Lonely Place', '1950', 'noir where the darkness is the hero'],
  'FS 301': ['Five Easy Pieces', '1970', 'the chicken-salad scene; drift as drama'],
  'FS 302': ['Memories of Murder', '2003', 'the procedural that indicts the procedure'],
  'FS 310': ['Audition', '1999', 'the slow-burn bait-and-switch'],
  'FS 320': ['Johnny Guitar', '1954', 'the western in expressionist drag'],
  'FS 330': ['Children of Men', '2006', 'the long-take apocalypse'],
  'FS 401': ['The Red Shoes', '1948', 'Technicolor as delirium'],
  'FS 402': ['Sátántangó', '1994', 'seven hours; the full commitment'],
  'FS 403': ['Modern Times', '1936', 'Chaplin versus the machine'],
  'FS 404': ['Sullivan’s Travels', '1941', 'a comedy about why comedy matters'],
  'FS 405': ['Following', '1998', 'Nolan for six thousand pounds'],
  'FS 501': ['Hero', '2002', 'color as chapters'],
  'FS 502': ['The Limey', '1999', 'time shuffled like memory'],
  'FS 503': ['Berberian Sound Studio', '2012', 'a giallo made of sound alone'],
  'FS 504': ['Glengarry Glen Ross', '1992', 'Mamet — always be closing'],
  'FS 505': ['Opening Night', '1977', 'Cassavetes and Rowlands, round two'],
  'FS 510': ['Faust', '1926', 'Murnau’s effects opera'],
  'FS 520': ['Written on the Wind', '1956', 'Sirk cranked to eleven'],
  'FS 530': ['The Secret in Their Eyes', '2009', 'the stadium shot; genre with a wound'],
  'FS 540': ['The Color of Pomegranates', '1969', 'the tableau film — icons in motion'],
  'FS 550': ['Meek’s Cutoff', '2010', 'Reichardt — the western at walking pace'],
  'FS 560': ['My Own Private Idaho', '1991', 'River Phoenix; Shakespeare on the street'],
  'FS 570': ['The Heart of the World', '2000', 'Maddin — six minutes of pure mania'],
  'FS 580': ['Rope', '1948', 'the single-take experiment'],
};

// The seminar room — the working vocabulary of people who studied this,
// each term anchored to the syllabus film that teaches it best.
export const LEXICON = [
  ['mise-en-scène', 'everything placed before the camera — set, light, bodies, blocking; the frame as a composed world', 'The Conformist'],
  ['montage', 'meaning made by the collision of shots — 1+1=3', 'Battleship Potemkin'],
  ['the long take', 'a shot that refuses to end; duration as pressure', 'Werckmeister Harmonies'],
  ['deep focus', 'foreground and background sharp at once — the eye chooses, the film doesn’t', 'Citizen Kane'],
  ['match cut', 'two shots joined by shape or motion so time can leap invisibly', '2001: A Space Odyssey'],
  ['jump cut', 'a cut inside the same shot — time stutters on purpose', 'Breathless'],
  ['diegetic / non-diegetic', 'sound the characters can hear versus sound only you can', 'Blow Out'],
  ['sound bridge', 'audio from the next scene arriving before its image — or refusing to leave', 'Apocalypse Now'],
  ['leitmotif', 'a recurring musical phrase attached to a character or idea', 'M'],
  ['the 180-degree rule', 'the invisible line that keeps screen direction coherent — and what breaking it does', 'Casablanca'],
  ['shot / reverse shot', 'the grammar of conversation — who we watch while the other speaks', 'Before Sunset'],
  ['coverage', 'the master-plus-closeups system; a scene shot so it can be built in the edit', '12 Angry Men'],
  ['cross-cutting', 'alternating between simultaneous actions to build tension', 'Strangers on a Train'],
  ['elliptical editing', 'what the cut leaves out — the ellipsis carries the meaning', 'Jeanne Dielman, 23, quai du Commerce, 1080 Bruxelles'],
  ['MacGuffin', 'the thing everyone chases that doesn’t matter at all', 'North by Northwest'],
  ['chiaroscuro', 'hard light against hard dark — morality rendered as lighting', 'The Third Man'],
  ['blocking', 'the choreography of bodies in the frame; who moves, who is still, who is between', 'Marriage Story'],
  ['the POV shot', 'the camera as a character’s eyes — and you, complicit', 'Rear Window'],
  ['the tracking shot', 'the camera travels; space becomes narration', 'Touch of Evil'],
  ['magic hour', 'the minutes after sunset when light goes gold and films go broke shooting it', 'Days of Heaven'],
  ['frame within a frame', 'doorways, mirrors, corridors — composition that traps or distances', 'In the Mood for Love'],
  ['voiceover', 'narration over image — trust it at your peril', 'Sunset Boulevard'],
  ['aspect ratio', 'the shape of the frame is an argument, not a default', 'Meek’s Cutoff'],
  ['tableau', 'the static, composed image — painting that breathes', 'The Color of Pomegranates'],
  ['neorealism', 'real streets, non-actors, unresolved endings — the fiction of the actual', 'Bicycle Thieves'],
  ['genre revisionism', 'a genre turning on its own myths', 'Unforgiven'],
  ['slow cinema', 'duration past comfort — boredom, then whatever is on the other side of it', 'Sátántangó'],
  ['auteur', 'the director as the film’s author — a theory, not a fact; argue accordingly', '8½'],
  ['the gaze', 'who the camera looks for, and who it assumes is watching', 'Vertigo'],
  ['suspense vs. surprise', 'the bomb under the table: surprise is a bang, suspense is the fifteen minutes before it', 'Rear Window'],
];

// How to talk about a film — the questions the good grads actually ask.
export const METHOD = [
  'Start with form, not plot. The story is what happens; the film is how.',
  'Whose point of view owns each scene — and when does it quietly change hands?',
  'Every film teaches you how to watch it in its first ten minutes. Find the lesson.',
  'What is kept off-screen? What a film refuses to show is a decision, not an absence.',
  'Pick one cut and defend it: why here, why not two seconds later?',
  'Close your eyes for a minute. Whatever you still understand was designed.',
  'Ask what would be lost if a scene were removed. If the answer is nothing, ask why it exists.',
  'Compare within the director: what does this film keep doing that the last one did?',
  'Retire the word “pretentious.” Say what the film asked of you, and whether it earned it.',
];
