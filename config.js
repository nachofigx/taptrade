// Where the game looks for the odds published by the tuner. The first valid file wins; the last entry is the copy that ships with the site.
// The VPS publishes to the `odds-data` branch (deploy/publish.sh); raw.githubusercontent.com serves it with CORS and a ~5 min cache.
export const ODDS_URLS = [
  'https://raw.githubusercontent.com/nachofigx/taptrade/odds-data/odds.json',
  'odds.json',
];
export const ODDS_STALE_HOURS = 36;   // the profile warns when the newest market data behind the odds is older than this
