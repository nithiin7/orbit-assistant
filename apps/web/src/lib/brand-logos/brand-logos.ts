/**
 * Brand logos for subscriptions and vehicles, matched from the names the user typed. The logos
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
  siAudi,
  siAudible,
  siBitwarden,
  siBmw,
  siCitroen,
  siClaude,
  siCoursera,
  siCrunchyroll,
  siCursor,
  siDeezer,
  siDiscord,
  siDropbox,
  siDucati,
  siDuolingo,
  siEvernote,
  siExpressvpn,
  siFigma,
  siFord,
  siGithub,
  siGithubcopilot,
  siGoogle,
  siGoogledrive,
  siGooglegemini,
  siGoogleplay,
  siGrammarly,
  siHbomax,
  siHeadspace,
  siHonda,
  siHyundai,
  siIcloud,
  siJeep,
  siJetbrains,
  siJio,
  siKagi,
  siKia,
  siKtm,
  siLinear,
  siMahindra,
  siMedium,
  siMg,
  type SimpleIcon,
  siNetflix,
  siNissan,
  siNordvpn,
  siNotion,
  siObsidian,
  siParamountplus,
  siPatreon,
  siPerplexity,
  siPlaystation,
  siPorsche,
  siProton,
  siProtonmail,
  siProtonvpn,
  siRaycast,
  siRenault,
  siSetapp,
  siSkoda,
  siSoundcloud,
  siSpotify,
  siSteam,
  siStrava,
  siSubstack,
  siSurfshark,
  siSuzuki,
  siSwiggy,
  siTata,
  siTelegram,
  siTesla,
  siTidal,
  siTodoist,
  siToyota,
  siTwitch,
  siUber,
  siUdemy,
  siVodafone,
  siVolkswagen,
  siVolvo,
  siX,
  siYamahamotorcorporation,
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

/**
 * Car and motorcycle makers. Matched only for vehicles, so a short name like "MG" or "Kia" can't
 * turn up in a subscription. Some makers (Maruti's own mark, Mercedes, Royal Enfield, Bajaj,
 * TVS, Hero) aren't in simple-icons; Maruti uses Suzuki's mark, the rest the generic icon.
 */
const VEHICLE_BRANDS: [SimpleIcon, ...string[]][] = [
  [siAudi, "audi"],
  [siBmw, "bmw"],
  [siCitroen, "citroen"],
  [siDucati, "ducati"],
  [siFord, "ford"],
  [siHonda, "honda", "activa"],
  [siHyundai, "hyundai", "creta", "i20", "verna"],
  [siJeep, "jeep"],
  [siKia, "kia", "seltos", "sonet"],
  [siKtm, "ktm"],
  [siMahindra, "mahindra", "thar", "xuv700", "scorpio"],
  [siMg, "mg", "mg motor"],
  [siNissan, "nissan"],
  [siPorsche, "porsche"],
  [siRenault, "renault"],
  [siSkoda, "skoda"],
  [siSuzuki, "suzuki", "maruti", "maruti suzuki", "swift", "baleno", "brezza"],
  [siTata, "tata", "nexon", "punch", "harrier"],
  [siTesla, "tesla"],
  [siToyota, "toyota", "innova", "fortuner"],
  [siVolkswagen, "volkswagen", "vw"],
  [siVolvo, "volvo"],
  [siYamahamotorcorporation, "yamaha"],
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

type Phrase = { icon: SimpleIcon; words: string[] };

/** Longest phrases first, so the most specific brand wins. */
function phrasesOf(brands: [SimpleIcon, ...string[]][]): Phrase[] {
  return brands
    .flatMap(([icon, ...phrases]) => phrases.map((phrase) => ({ icon, words: words(phrase) })))
    .sort((a, b) => b.words.length - a.words.length);
}

const SUBSCRIPTION_PHRASES = phrasesOf(BRANDS);
const VEHICLE_PHRASES = phrasesOf(VEHICLE_BRANDS);

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

function match(phrases: Phrase[], labels: (string | null | undefined)[]): BrandLogo | null {
  for (const label of labels) {
    if (!label) continue;
    const haystack = words(label);
    const found = phrases.find((phrase) => containsPhrase(haystack, phrase.words));
    if (found) {
      return {
        title: found.icon.title,
        path: found.icon.path,
        background: `#${found.icon.hex}`,
        foreground: readableOn(found.icon.hex),
      };
    }
  }
  return null;
}

/** The logo for a subscription, from its name or provider, or `null` when none is known. */
export function brandLogo(...labels: (string | null | undefined)[]): BrandLogo | null {
  return match(SUBSCRIPTION_PHRASES, labels);
}

/** The maker's logo for a vehicle, from its name, or `null` when none is known. */
export function vehicleLogo(...labels: (string | null | undefined)[]): BrandLogo | null {
  return match(VEHICLE_PHRASES, labels);
}
