// ===========================================================================
// LightTable rank + badge engine
//
// TWO systems:
//   RANKS  — one overall title per cook, climbed through a BLEND of recipes +
//            tips + upvotes. Early ranks are easy (recipe-count carries you);
//            upper ranks demand all three, so you can't buy your way to the top
//            with tips alone and zero upvotes.
//   BADGES — stackable specialty/achievement awards shown next to the name.
//
// Everything is computed from data we already load (recipes, tips, upvotes,
// categories, createdAt). All thresholds/names live here and are easy to tune.
// ===========================================================================

export interface CookStats {
  address: string;
  recipes: number;       // # recipes posted
  tips: number;          // total LCAI tipped to them
  upvotes: number;       // total upvotes across their recipes
  topRecipeUpvotes: number; // most upvotes on a single recipe
  tagCounts: Record<string, number>; // category -> count (lowercased tag includes)
  tipsGiven?: number;    // # times they tipped others (for the Generous badge)
  isPioneer?: boolean;   // among the first cooks
  heldNumberOne?: boolean; // has held #1 on the leaderboard
}

// ---- TIER COLORS (visual prestige scales with rank) ----
export type Tier = "dish" | "prep" | "line" | "station" | "sous" | "head" | "star";
export const TIER_STYLE: Record<Tier, { color: string; glow?: boolean; label: string }> = {
  dish:    { color: "#8a8f98", label: "Dish Pit" },        // grey — bottom
  prep:    { color: "#b08968", label: "Prep" },            // bronze
  line:    { color: "#c0c0c0", label: "Line" },            // silver
  station: { color: "#4ea1ff", label: "Station" },         // blue
  sous:    { color: "#a06bff", label: "Sous" },            // purple
  head:    { color: "#ffb020", label: "Head" },            // gold
  star:    { color: "#ff4fa3", glow: true, label: "Michelin" }, // pink glow — elite
};

// ---- THE 30-RANK LADDER ----
// Each rank: name, tier (for color), and the THREE thresholds you must ALL clear
// (minRecipes, minTips, minUpvotes). Early ranks: tips/upvotes ~0 so recipes
// carry you. Upper ranks: all three scale up hard. Tune freely.
export interface RankDef {
  level: number;
  name: string;
  tier: Tier;
  minRecipes: number;
  minTips: number;
  minUpvotes: number;
}

export const RANKS: RankDef[] = [
  // Early game — fast, recipe-count driven (newbies feel progress)
  { level: 1,  name: "Dishwasher",        tier: "dish",    minRecipes: 0,  minTips: 0,    minUpvotes: 0 },
  { level: 2,  name: "Pot Scrubber",      tier: "dish",    minRecipes: 1,  minTips: 0,    minUpvotes: 0 },
  { level: 3,  name: "Potato Peeler",     tier: "dish",    minRecipes: 2,  minTips: 0,    minUpvotes: 0 },
  { level: 4,  name: "Prep Hand",         tier: "prep",    minRecipes: 3,  minTips: 0,    minUpvotes: 1 },
  { level: 5,  name: "Commis III",        tier: "prep",    minRecipes: 4,  minTips: 0,    minUpvotes: 2 },
  { level: 6,  name: "Commis II",         tier: "prep",    minRecipes: 5,  minTips: 1,    minUpvotes: 3 },
  { level: 7,  name: "Commis I",          tier: "prep",    minRecipes: 6,  minTips: 2,    minUpvotes: 5 },
  // Mid game — the blend kicks in
  { level: 8,  name: "Line Cook",         tier: "line",    minRecipes: 7,  minTips: 5,    minUpvotes: 8 },
  { level: 9,  name: "Senior Line Cook",  tier: "line",    minRecipes: 9,  minTips: 10,   minUpvotes: 12 },
  { level: 10, name: "Garde Manger",      tier: "line",    minRecipes: 11, minTips: 18,   minUpvotes: 16 },
  { level: 11, name: "Entremetier",       tier: "line",    minRecipes: 13, minTips: 28,   minUpvotes: 22 },
  { level: 12, name: "Station Chef",      tier: "station", minRecipes: 15, minTips: 42,   minUpvotes: 30 },
  { level: 13, name: "Grillardin",        tier: "station", minRecipes: 18, minTips: 60,   minUpvotes: 40 },
  { level: 14, name: "Poissonnier",       tier: "station", minRecipes: 21, minTips: 85,   minUpvotes: 52 },
  { level: 15, name: "Rôtisseur",         tier: "station", minRecipes: 24, minTips: 115,  minUpvotes: 66 },
  { level: 16, name: "Saucier",           tier: "station", minRecipes: 28, minTips: 155,  minUpvotes: 82 },
  { level: 17, name: "Senior Saucier",    tier: "station", minRecipes: 32, minTips: 205,  minUpvotes: 100 },
  // Late game — leadership, demands real tips AND upvotes AND volume
  { level: 18, name: "Junior Sous Chef",  tier: "sous",    minRecipes: 37, minTips: 270,  minUpvotes: 125 },
  { level: 19, name: "Sous Chef",         tier: "sous",    minRecipes: 43, minTips: 350,  minUpvotes: 155 },
  { level: 20, name: "Senior Sous Chef",  tier: "sous",    minRecipes: 50, minTips: 450,  minUpvotes: 195 },
  { level: 21, name: "Executive Sous",    tier: "sous",    minRecipes: 58, minTips: 580,  minUpvotes: 245 },
  { level: 22, name: "Chef de Partie",    tier: "head",    minRecipes: 67, minTips: 740,  minUpvotes: 305 },
  { level: 23, name: "Chef de Cuisine",   tier: "head",    minRecipes: 77, minTips: 940,  minUpvotes: 380 },
  { level: 24, name: "Head Chef",         tier: "head",    minRecipes: 90, minTips: 1200, minUpvotes: 475 },
  { level: 25, name: "Executive Chef",    tier: "head",    minRecipes: 105,minTips: 1550, minUpvotes: 590 },
  { level: 26, name: "Master Chef",       tier: "head",    minRecipes: 125,minTips: 2000, minUpvotes: 730 },
  // Elite — Michelin stars (glow)
  { level: 27, name: "Rising Star Chef",  tier: "star",    minRecipes: 150,minTips: 2700, minUpvotes: 920 },
  { level: 28, name: "One-Star Chef",     tier: "star",    minRecipes: 180,minTips: 3700, minUpvotes: 1160 },
  { level: 29, name: "Two-Star Chef",     tier: "star",    minRecipes: 220,minTips: 5200, minUpvotes: 1480 },
  { level: 30, name: "Three-Star Michelin Chef", tier: "star", minRecipes: 270, minTips: 7500, minUpvotes: 1900 },
];

// Compute a cook's rank: the HIGHEST rank where they clear all three thresholds.
export function computeRank(s: CookStats): RankDef {
  let current = RANKS[0];
  for (const r of RANKS) {
    if (s.recipes >= r.minRecipes && s.tips >= r.minTips && s.upvotes >= r.minUpvotes) {
      current = r;
    } else {
      break; // ranks are ordered; first one you can't clear stops the climb
    }
  }
  return current;
}

// What's needed for the NEXT rank (for the progress display). null at max.
export function nextRank(s: CookStats): RankDef | null {
  const cur = computeRank(s);
  return RANKS.find((r) => r.level === cur.level + 1) || null;
}

// ---- BADGES (stackable) ----
// Specialty badges use the REAL culinary name where it's recognizable/cool,
// plain English where the brigade term would just confuse. Achievement badges
// reward milestones. Each has an emoji, a name, and an `earned` test.
export interface BadgeDef {
  id: string;
  emoji: string;
  icon: string;   // Tabler icon class (ti ti-*) — crisp, themeable medallion glyph
  color: string;  // medallion accent color
  tier: "bronze" | "silver" | "gold"; // metal frame — gold = most prestigious
  name: string;
  desc: string;
  earned: (s: CookStats) => boolean;
}

// How many recipes in a category to earn its specialty badge (tunable).
const SPECIALTY_THRESHOLD = 3;
function tagCount(s: CookStats, key: string): number {
  // tags are stored as a comma list; we counted by lowercased includes upstream
  return s.tagCounts[key] || 0;
}

export const BADGES: BadgeDef[] = [
  // Specialty — silver frames (earned by focused cooking in a category)
  { id: "patissier",   emoji: "🍰", icon: "ti ti-cake",            color: "#ff7eb6", tier: "silver", name: "Pâtissier",       desc: `${SPECIALTY_THRESHOLD}+ dessert recipes`,    earned: (s) => tagCount(s, "dessert") >= SPECIALTY_THRESHOLD },
  { id: "saucier",     emoji: "🥘", icon: "ti ti-soup",            color: "#e8804a", tier: "silver", name: "Saucier",          desc: `${SPECIALTY_THRESHOLD}+ dinner recipes`,     earned: (s) => tagCount(s, "dinner") >= SPECIALTY_THRESHOLD },
  { id: "gardemanger", emoji: "🥗", icon: "ti ti-salad",           color: "#5fc97a", tier: "silver", name: "Garde Manger (Salads)", desc: `${SPECIALTY_THRESHOLD}+ salad/veg recipes`, earned: (s) => tagCount(s, "vegetarian") + tagCount(s, "vegan") >= SPECIALTY_THRESHOLD },
  { id: "grillmaster", emoji: "🍖", icon: "ti ti-flame",           color: "#e2533b", tier: "silver", name: "Grill Master",     desc: `${SPECIALTY_THRESHOLD}+ dinner recipes`,     earned: (s) => tagCount(s, "lunch") + tagCount(s, "dinner") >= SPECIALTY_THRESHOLD + 2 },
  { id: "breakfast",   emoji: "🍳", icon: "ti ti-egg-fried",       color: "#f2b134", tier: "silver", name: "Breakfast Champ",  desc: `${SPECIALTY_THRESHOLD}+ breakfast recipes`,  earned: (s) => tagCount(s, "breakfast") >= SPECIALTY_THRESHOLD },
  { id: "mixologist",  emoji: "🍸", icon: "ti ti-glass-cocktail",  color: "#4ec5d4", tier: "silver", name: "Mixologist",       desc: `${SPECIALTY_THRESHOLD}+ drink recipes`,      earned: (s) => tagCount(s, "drinks") >= SPECIALTY_THRESHOLD },
  { id: "plantbased",  emoji: "🥬", icon: "ti ti-plant-2",         color: "#5ab552", tier: "silver", name: "Plant-Based Pro",  desc: `${SPECIALTY_THRESHOLD}+ vegan recipes`,      earned: (s) => tagCount(s, "vegan") >= SPECIALTY_THRESHOLD },
  { id: "snackmaster", emoji: "🍿", icon: "ti ti-cookie",          color: "#d9a441", tier: "silver", name: "Snack Master",     desc: `${SPECIALTY_THRESHOLD}+ snack recipes`,      earned: (s) => tagCount(s, "snacks") >= SPECIALTY_THRESHOLD },
  // Achievement — bronze (entry) → gold (prestige)
  { id: "prolific",    emoji: "📚", icon: "ti ti-books",           color: "#a07cff", tier: "bronze", name: "Prolific",         desc: "Posted 10+ recipes",               earned: (s) => s.recipes >= 10 },
  { id: "generous",    emoji: "🤝", icon: "ti ti-heart-handshake", color: "#ff8fa3", tier: "bronze", name: "Generous",         desc: "Tipped other cooks 5+ times",      earned: (s) => (s.tipsGiven || 0) >= 5 },
  { id: "crowdfav",    emoji: "💎", icon: "ti ti-diamond",         color: "#6aa9ff", tier: "silver", name: "Crowd Favorite",   desc: "A recipe with 10+ upvotes",        earned: (s) => s.topRecipeUpvotes >= 10 },
  { id: "welltipped",  emoji: "💰", icon: "ti ti-coin",            color: "#f2c14e", tier: "gold",   name: "Well-Tipped",      desc: "Earned 100+ LCAI in tips",         earned: (s) => s.tips >= 100 },
  { id: "trendsetter", emoji: "🌟", icon: "ti ti-star",            color: "#ffd24a", tier: "gold",   name: "Trendsetter",      desc: "Held #1 on the leaderboard",       earned: (s) => !!s.heldNumberOne },
  { id: "pioneer",     emoji: "🏆", icon: "ti ti-trophy",          color: "#ffb020", tier: "gold",   name: "Pioneer",          desc: "One of LightTable's first cooks",  earned: (s) => !!s.isPioneer },
];

export function earnedBadges(s: CookStats): BadgeDef[] {
  return BADGES.filter((b) => b.earned(s));
}

// ---- OWNER OVERRIDES ----
// The owner can force a rank level, grant badges, or revoke badges. These
// helpers apply an override on top of the computed result.
export interface Override {
  rankLevel?: number;
  grant?: string[];
  revoke?: string[];
}

export function rankFor(s: CookStats, ov?: Override): RankDef {
  if (ov && typeof ov.rankLevel === "number") {
    const forced = RANKS.find((r) => r.level === ov.rankLevel);
    if (forced) return forced;
  }
  return computeRank(s);
}

export function badgesFor(s: CookStats, ov?: Override): BadgeDef[] {
  let ids = new Set(earnedBadges(s).map((b) => b.id));
  if (ov?.grant) ov.grant.forEach((id) => ids.add(id));
  if (ov?.revoke) ov.revoke.forEach((id) => ids.delete(id));
  return BADGES.filter((b) => ids.has(b.id));
}

export function badgeById(id: string): BadgeDef | undefined {
  return BADGES.find((b) => b.id === id);
}
