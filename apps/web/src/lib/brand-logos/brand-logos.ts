/**
 * Brand logos for subscriptions, matched from the name and provider the user typed. The logos
 * are bundled (simple-icons, CC0), so nothing about a subscription leaves the device to fetch
 * one. Some well-known brands are missing because simple-icons removes logos on request; those
 * fall back to the generic icon.
 */
import {
  si1password,
  siAirtel,
  siAnthropic,
  siApple,
  siApplearcade,
  siApplemusic,
  siApplepodcasts,
  siAppletv,
  siAudible,
  siBitwarden,
  siClaude,
  siCoursera,
  siCrunchyroll,
  siCursor,
  siDeezer,
  siDiscord,
  siDropbox,
  siDuolingo,
  siEvernote,
  siExpressvpn,
  siFigma,
  siGithub,
  siGithubcopilot,
  siGoogle,
  siGoogledrive,
  siGooglegemini,
  siGoogleplay,
  siGrammarly,
  siHbomax,
  siHeadspace,
  siIcloud,
  siJetbrains,
  siJio,
  siKagi,
  siLinear,
  siMedium,
  type SimpleIcon,
  siNetflix,
  siNordvpn,
  siNotion,
  siObsidian,
  siParamountplus,
  siPatreon,
  siPerplexity,
  siPlaystation,
  siProton,
  siProtonmail,
  siProtonvpn,
  siRaycast,
  siSetapp,
  siSoundcloud,
  siSpotify,
  siSteam,
  siStrava,
  siSubstack,
  siSurfshark,
  siSwiggy,
  siTelegram,
  siTidal,
  siTodoist,
  siTwitch,
  siUber,
  siUdemy,
  siVodafone,
  siX,
  siYoutube,
  siYoutubemusic,
  siZomato,
  siZoom,
} from "simple-icons";

export type BrandLogo = {
  title: string;
  /** SVG path data for a 24×24 view box. */
  path: string;
  /** The brand color, as `#RRGGBB`. */
  background: string;
  /** Black or white, whichever reads better on the brand color. */
  foreground: string;
};

/**
 * Each icon with the phrases that name it. A phrase matches whole words, in order, anywhere in
 * the name or provider; longer phrases are tried first, so "YouTube Music" wins over "YouTube".
 */
const BRANDS: [SimpleIcon, ...string[]][] = [
  [si1password, "1password", "1 password"],
  [siAirtel, "airtel"],
  [siAnthropic, "anthropic"],
  [siApple, "apple", "apple one"],
  [siApplearcade, "apple arcade"],
  [siApplemusic, "apple music"],
  [siApplepodcasts, "apple podcasts"],
  [siAppletv, "apple tv", "apple tv plus"],
  [siAudible, "audible"],
  [siBitwarden, "bitwarden"],
  [siClaude, "claude"],
  [siCoursera, "coursera"],
  [siCrunchyroll, "crunchyroll"],
  [siCursor, "cursor"],
  [siDeezer, "deezer"],
  [siDiscord, "discord", "discord nitro"],
  [siDropbox, "dropbox"],
  [siDuolingo, "duolingo"],
  [siEvernote, "evernote"],
  [siExpressvpn, "expressvpn", "express vpn"],
  [siFigma, "figma"],
  [siGithub, "github"],
  [siGithubcopilot, "github copilot"],
  [siGoogle, "google", "google one", "google workspace"],
  [siGoogledrive, "google drive"],
  [siGooglegemini, "gemini", "google gemini"],
  [siGoogleplay, "google play", "play pass"],
  [siGrammarly, "grammarly"],
  [siHbomax, "hbo", "hbo max"],
  [siHeadspace, "headspace"],
  [siIcloud, "icloud"],
  [siJetbrains, "jetbrains", "intellij"],
  [siJio, "jio", "jiofiber", "jio fiber", "jiocinema", "jio cinema"],
  [siKagi, "kagi"],
  [siLinear, "linear app"],
  [siMedium, "medium membership"],
  [siNetflix, "netflix"],
  [siNordvpn, "nordvpn", "nord vpn"],
  [siNotion, "notion"],
  [siObsidian, "obsidian"],
  [siParamountplus, "paramount"],
  [siPatreon, "patreon"],
  [siPerplexity, "perplexity"],
  [siPlaystation, "playstation", "ps plus"],
  [siProton, "proton", "proton unlimited"],
  [siProtonmail, "protonmail", "proton mail"],
  [siProtonvpn, "protonvpn", "proton vpn"],
  [siRaycast, "raycast"],
  [siSetapp, "setapp"],
  [siSoundcloud, "soundcloud"],
  [siSpotify, "spotify"],
  [siSteam, "steam"],
  [siStrava, "strava"],
  [siSubstack, "substack"],
  [siSurfshark, "surfshark"],
  [siSwiggy, "swiggy", "swiggy one"],
  [siTelegram, "telegram"],
  [siTidal, "tidal"],
  [siTodoist, "todoist"],
  [siTwitch, "twitch"],
  [siUber, "uber", "uber one"],
  [siUdemy, "udemy"],
  [siVodafone, "vodafone"],
  [siX, "x premium", "twitter"],
  [siYoutube, "youtube", "youtube premium"],
  [siYoutubemusic, "youtube music"],
  [siZomato, "zomato"],
  [siZoom, "zoom"],
];

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function containsPhrase(haystack: string[], phrase: string[]): boolean {
  for (let start = 0; start + phrase.length <= haystack.length; start++) {
    if (phrase.every((word, offset) => haystack[start + offset] === word)) return true;
  }
  return false;
}

/** Longest phrases first, so the most specific brand wins. */
const PHRASES = BRANDS.flatMap(([icon, ...phrases]) =>
  phrases.map((phrase) => ({ icon, words: words(phrase) })),
).sort((a, b) => b.words.length - a.words.length);

function channel(hex: string): number {
  const value = Number.parseInt(hex, 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Black or white, whichever has the higher WCAG contrast against `hex` (`RRGGBB`). */
export function readableOn(hex: string): "#000000" | "#FFFFFF" {
  const luminance =
    0.2126 * channel(hex.slice(0, 2)) +
    0.7152 * channel(hex.slice(2, 4)) +
    0.0722 * channel(hex.slice(4, 6));
  // Contrast with white is 1.05 / (L + 0.05), with black (L + 0.05) / 0.05.
  return (luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05) ? "#000000" : "#FFFFFF";
}

/** The logo for a subscription, from its name or provider, or `null` when none is known. */
export function brandLogo(...labels: (string | null | undefined)[]): BrandLogo | null {
  for (const label of labels) {
    if (!label) continue;
    const haystack = words(label);
    const match = PHRASES.find((phrase) => containsPhrase(haystack, phrase.words));
    if (match) {
      return {
        title: match.icon.title,
        path: match.icon.path,
        background: `#${match.icon.hex}`,
        foreground: readableOn(match.icon.hex),
      };
    }
  }
  return null;
}
