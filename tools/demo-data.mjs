// Synthetic sample data so the dashboard can be built, previewed and verified
// end-to-end without anyone's real Letterboxd export. Deterministic (seeded).

import { filmKey } from '../lib/insights.js';

// A small canon with real metadata shapes (genre/director/runtime/decade).
const CANON = [
  ['Heat', '1995', 'Michael Mann', 170, ['Crime', 'Drama'], 'United States', 'en', 8.0, 60],
  ['Drive', '2011', 'Nicolas Winding Refn', 100, ['Crime', 'Drama'], 'United States', 'en', 7.6, 45],
  ['Blade Runner 2049', '2017', 'Denis Villeneuve', 164, ['Science Fiction', 'Drama'], 'United States', 'en', 7.5, 90],
  ['Sicario', '2015', 'Denis Villeneuve', 121, ['Crime', 'Thriller'], 'United States', 'en', 7.4, 55],
  ['Dune: Part Two', '2024', 'Denis Villeneuve', 167, ['Science Fiction', 'Adventure'], 'United States', 'en', 8.2, 190],
  ['The Godfather', '1972', 'Francis Ford Coppola', 175, ['Crime', 'Drama'], 'United States', 'en', 8.7, 120],
  ['Goodfellas', '1990', 'Martin Scorsese', 145, ['Crime', 'Drama'], 'United States', 'en', 8.5, 95],
  ['Taxi Driver', '1976', 'Martin Scorsese', 114, ['Crime', 'Drama'], 'United States', 'en', 8.2, 70],
  ['The Departed', '2006', 'Martin Scorsese', 151, ['Crime', 'Thriller'], 'United States', 'en', 8.2, 85],
  ['Killers of the Flower Moon', '2023', 'Martin Scorsese', 206, ['Crime', 'Drama', 'History'], 'United States', 'en', 7.5, 75],
  ['Oldboy', '2003', 'Park Chan-wook', 120, ['Thriller', 'Mystery'], 'South Korea', 'ko', 8.3, 65],
  ['Parasite', '2019', 'Bong Joon-ho', 133, ['Thriller', 'Drama', 'Comedy'], 'South Korea', 'ko', 8.5, 110],
  ['Memories of Murder', '2003', 'Bong Joon-ho', 131, ['Crime', 'Thriller'], 'South Korea', 'ko', 8.1, 40],
  ['Seven Samurai', '1954', 'Akira Kurosawa', 207, ['Action', 'Drama'], 'Japan', 'ja', 8.5, 35],
  ['Yojimbo', '1961', 'Akira Kurosawa', 110, ['Action', 'Drama'], 'Japan', 'ja', 8.1, 20],
  ['Stalker', '1979', 'Andrei Tarkovsky', 162, ['Science Fiction', 'Drama'], 'Soviet Union', 'ru', 8.1, 6],
  ['Come and See', '1985', 'Elem Klimov', 142, ['War', 'Drama'], 'Soviet Union', 'ru', 8.3, 8],
  ['No Country for Old Men', '2007', 'Joel Coen', 122, ['Crime', 'Thriller'], 'United States', 'en', 8.0, 70],
  ['The Big Lebowski', '1998', 'Joel Coen', 117, ['Comedy', 'Crime'], 'United States', 'en', 8.0, 60],
  ['There Will Be Blood', '2007', 'Paul Thomas Anderson', 158, ['Drama'], 'United States', 'en', 8.1, 50],
  ['The Master', '2012', 'Paul Thomas Anderson', 138, ['Drama'], 'United States', 'en', 7.1, 25],
  ['Whiplash', '2014', 'Damien Chazelle', 107, ['Drama', 'Music'], 'United States', 'en', 8.4, 100],
  ['Interstellar', '2014', 'Christopher Nolan', 169, ['Science Fiction', 'Drama'], 'United States', 'en', 8.4, 160],
  ['Oppenheimer', '2023', 'Christopher Nolan', 181, ['Drama', 'History'], 'United States', 'en', 8.1, 150],
  ['The Dark Knight', '2008', 'Christopher Nolan', 152, ['Action', 'Crime'], 'United States', 'en', 8.5, 140],
  ['Mad Max: Fury Road', '2015', 'George Miller', 121, ['Action', 'Science Fiction'], 'Australia', 'en', 7.6, 95],
  ['In the Mood for Love', '2000', 'Wong Kar-wai', 99, ['Drama', 'Romance'], 'Hong Kong', 'cn', 8.1, 30],
  ['Chungking Express', '1994', 'Wong Kar-wai', 102, ['Drama', 'Romance'], 'Hong Kong', 'cn', 8.0, 25],
  ['Ran', '1985', 'Akira Kurosawa', 160, ['Drama', 'War'], 'Japan', 'ja', 8.2, 22],
  ['Apocalypse Now', '1979', 'Francis Ford Coppola', 147, ['War', 'Drama'], 'United States', 'en', 8.3, 65],
  ['Andhadhun', '2018', 'Sriram Raghavan', 139, ['Thriller', 'Comedy'], 'India', 'hi', 7.8, 18],
  ['Gangs of Wasseypur', '2012', 'Anurag Kashyap', 321, ['Crime', 'Drama'], 'India', 'hi', 8.0, 15],
  ['Tumbbad', '2018', 'Rahi Anil Barve', 104, ['Horror', 'Fantasy'], 'India', 'hi', 7.5, 12],
  ['3 Idiots', '2009', 'Rajkumar Hirani', 170, ['Comedy', 'Drama'], 'India', 'hi', 8.0, 35],
  ['Paths of Glory', '1957', 'Stanley Kubrick', 88, ['War', 'Drama'], 'United States', 'en', 8.2, 28],
  ['2001: A Space Odyssey', '1968', 'Stanley Kubrick', 149, ['Science Fiction'], 'United States', 'en', 8.1, 55],
  ['The Shining', '1980', 'Stanley Kubrick', 146, ['Horror'], 'United States', 'en', 8.2, 90],
  ['Alien', '1979', 'Ridley Scott', 117, ['Horror', 'Science Fiction'], 'United States', 'en', 8.1, 85],
  ['The Thing', '1982', 'John Carpenter', 109, ['Horror', 'Science Fiction'], 'United States', 'en', 8.1, 60],
  ['Anatomy of a Fall', '2023', 'Justine Triet', 151, ['Drama', 'Mystery'], 'France', 'fr', 7.7, 45],
];

// Deterministic PRNG so the demo vault is reproducible.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function demoData() {
  const rnd = mulberry32(35);
  const diary = [];
  const start = Date.parse('2024-01-05T12:00:00Z');
  const days = 920; // ~2.5 years ending mid-2026
  const seen = new Set();

  for (let d = 0; d < days; d++) {
    // ~40% of days have at least one watch; weekends busier.
    const date = new Date(start + d * 86400000);
    const isWeekend = [0, 6].includes(date.getUTCDay());
    const p = isWeekend ? 0.55 : 0.32;
    let n = rnd() < p ? 1 : 0;
    if (n && rnd() < (isWeekend ? 0.3 : 0.12)) n = 2;
    for (let i = 0; i < n; i++) {
      const film = CANON[Math.floor(rnd() * CANON.length)];
      const key = filmKey(film[0], film[1]);
      const rewatch = seen.has(key);
      seen.add(key);
      // ratings skewed high, halves only
      const rating = Math.min(5, Math.max(2, Math.round((3 + rnd() * 2.2) * 2) / 2));
      diary.push({
        name: film[0], year: film[1], rating,
        watchedDate: date.toISOString().slice(0, 10),
        rewatch,
      });
    }
  }

  const latestRating = new Map();
  for (const d of diary) latestRating.set(filmKey(d.name, d.year), d.rating);
  const ratings = [...latestRating.entries()].map(([k, rating]) => {
    const [name, year] = k.split('|');
    return { name, year, rating };
  });
  const watched = [...seen].map((k) => {
    const [name, year] = k.split('|');
    return { name, year };
  });
  const films = {};
  for (const [name, year, director, runtime, genres, country, language, tmdbRating, popularity] of CANON) {
    films[filmKey(name, year)] = {
      genres, runtime, director, cast: [], countries: [country], language, tmdbRating, popularity,
    };
  }
  return { diary, watched, ratings, films, watchlistCount: 87, displayName: 'Demo' };
}
