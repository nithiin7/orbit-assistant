import { type Option } from "@/utils/common";

export type Continent = "AF" | "AN" | "AS" | "EU" | "NA" | "OC" | "SA";

export type Country = {
  /** ISO 3166-1 alpha-2, upper case: what the API stores. */
  code: string;
  /** ISO 3166-1 numeric, zero-padded: how the bundled world map names its shapes. */
  numeric: string;
  continent: Continent;
  /** One of the 193 UN members or 2 observer states; otherwise a territory or region. */
  sovereign: boolean;
};

/** UN members and observer states: the "countries of the world" a traveller counts against. */
export const SOVEREIGN_COUNT = 195;

export const CONTINENT_LABELS: Readonly<Record<Continent, string>> = {
  AF: "Africa",
  AN: "Antarctica",
  AS: "Asia",
  EU: "Europe",
  NA: "North America",
  OC: "Oceania",
  SA: "South America",
};

export const CONTINENTS: readonly Continent[] = ["AF", "AN", "AS", "EU", "NA", "OC", "SA"];

/**
 * Every assigned ISO 3166-1 code, the same list the API accepts: alpha-2, numeric, continent,
 * and `*` for territories and other regions. Continents follow the usual convention for
 * travellers (Russia in Europe, Türkiye in Asia, Central America and the Caribbean in North
 * America).
 */
const DATA = `
AD020EU AE784AS AF004AS AG028NA AI660NA* AL008EU AM051AS AO024AF AQ010AN* AR032SA AS016OC* AT040EU
AU036OC AW533NA* AX248EU* AZ031AS BA070EU BB052NA BD050AS BE056EU BF854AF BG100EU BH048AS BI108AF
BJ204AF BL652NA* BM060NA* BN096AS BO068SA BQ535NA* BR076SA BS044NA BT064AS BV074AN* BW072AF BY112EU
BZ084NA CA124NA CC166AS* CD180AF CF140AF CG178AF CH756EU CI384AF CK184OC* CL152SA CM120AF CN156AS
CO170SA CR188NA CU192NA CV132AF CW531NA* CX162AS* CY196EU CZ203EU DE276EU DJ262AF DK208EU DM212NA
DO214NA DZ012AF EC218SA EE233EU EG818AF EH732AF* ER232AF ES724EU ET231AF FI246EU FJ242OC FK238SA*
FM583OC FO234EU* FR250EU GA266AF GB826EU GD308NA GE268AS GF254SA* GG831EU* GH288AF GI292EU* GL304NA*
GM270AF GN324AF GP312NA* GQ226AF GR300EU GS239AN* GT320NA GU316OC* GW624AF GY328SA HK344AS* HM334AN*
HN340NA HR191EU HT332NA HU348EU ID360AS IE372EU IL376AS IM833EU* IN356AS IO086AS* IQ368AS IR364AS
IS352EU IT380EU JE832EU* JM388NA JO400AS JP392AS KE404AF KG417AS KH116AS KI296OC KM174AF KN659NA
KP408AS KR410AS KW414AS KY136NA* KZ398AS LA418AS LB422AS LC662NA LI438EU LK144AS LR430AF LS426AF
LT440EU LU442EU LV428EU LY434AF MA504AF MC492EU MD498EU ME499EU MF663NA* MG450AF MH584OC MK807EU
ML466AF MM104AS MN496AS MO446AS* MP580OC* MQ474NA* MR478AF MS500NA* MT470EU MU480AF MV462AS MW454AF
MX484NA MY458AS MZ508AF NA516AF NC540OC* NE562AF NF574OC* NG566AF NI558NA NL528EU NO578EU NP524AS
NR520OC NU570OC* NZ554OC OM512AS PA591NA PE604SA PF258OC* PG598OC PH608AS PK586AS PL616EU PM666NA*
PN612OC* PR630NA* PS275AS PT620EU PW585OC PY600SA QA634AS RE638AF* RO642EU RS688EU RU643EU RW646AF
SA682AS SB090OC SC690AF SD729AF SE752EU SG702AS SH654AF* SI705EU SJ744EU* SK703EU SL694AF SM674EU
SN686AF SO706AF SR740SA SS728AF ST678AF SV222NA SX534NA* SY760AS SZ748AF TC796NA* TD148AF TF260AN*
TG768AF TH764AS TJ762AS TK772OC* TL626AS TM795AS TN788AF TO776OC TR792AS TT780NA TV798OC TW158AS*
TZ834AF UA804EU UG800AF UM581OC* US840NA UY858SA UZ860AS VA336EU VC670NA VE862SA VG092NA* VI850NA*
VN704AS VU548OC WF876OC* WS882OC YE887AS YT175AF* ZA710AF ZM894AF ZW716AF`;

export const COUNTRIES: ReadonlyMap<string, Country> = new Map(
  DATA.split(/\s+/)
    .filter(Boolean)
    .map((entry): [string, Country] => {
      const code = entry.slice(0, 2);
      return [
        code,
        {
          code,
          numeric: entry.slice(2, 5),
          continent: entry.slice(5, 7) as Continent,
          sovereign: !entry.endsWith("*"),
        },
      ];
    }),
);

/** The alpha-2 code for each numeric code the world map uses. */
export const CODE_BY_NUMERIC: ReadonlyMap<string, string> = new Map(
  [...COUNTRIES.values()].map((country) => [country.numeric, country.code]),
);

const names = new Intl.DisplayNames(["en"], { type: "region", fallback: "code" });

/** The country's English name, such as "Japan" for `JP`. */
export function countryName(code: string): string {
  try {
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

/** The continent a country counts toward, if the code is known. */
export function continentOf(code: string): Continent | null {
  return COUNTRIES.get(code)?.continent ?? null;
}

/** Every country and territory by name, for a country picker. */
export const COUNTRY_OPTIONS: readonly Option<string>[] = [...COUNTRIES.keys()]
  .map((code) => ({ value: code, label: countryName(code) }))
  .sort((a, b) => a.label.localeCompare(b.label));
