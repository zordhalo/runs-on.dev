// The pixel box every generated banner is rendered at, in one place.
//
// claim-banner.jsx and banner-card.jsx both draw at this size and both used
// to declare it themselves. Plain .js rather than .jsx so code with no
// business importing Satori components — lib/badge.js, and the tests — can
// read the dimensions without pulling a renderer in behind them.
export const BANNER_SIZE = { width: 1200, height: 630 };
