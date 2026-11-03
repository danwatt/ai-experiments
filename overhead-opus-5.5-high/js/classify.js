// Turning raw ADS-B fields into human categories: size class, operator kind, airline.

// ICAO airline designators -> name. Not exhaustive; unknown 3-letter callsign
// prefixes still group as their own "airline" in filters.
export const AIRLINES = {
  AAL: "American", AAY: "Allegiant", ACA: "Air Canada", AFR: "Air France", AMX: "Aeroméxico", ANA: "All Nippon",
  ASA: "Alaska", ASH: "Mesa", AVA: "Avianca", AWI: "Air Wisconsin", BAW: "British Airways", CCA: "Air China",
  CES: "China Eastern", CFG: "Condor", CHH: "Hainan", CMP: "Copa", CPA: "Cathay Pacific", CSN: "China Southern",
  DAL: "Delta", DLH: "Lufthansa", EDV: "Endeavor", EIN: "Aer Lingus", EJA: "NetJets", ENY: "Envoy", ETD: "Etihad",
  EVA: "EVA Air", FDX: "FedEx", FFT: "Frontier", FIN: "Finnair", GJS: "GoJet", GTI: "Atlas Air", HAL: "Hawaiian",
  IBE: "Iberia", ICE: "Icelandair", JAL: "Japan Airlines", JBU: "JetBlue", JIA: "PSA", JZA: "Jazz", KAL: "Korean Air",
  KLM: "KLM", LXJ: "Flexjet", MXY: "Breeze", NKS: "Spirit", PDT: "Piedmont", QFA: "Qantas", QTR: "Qatar",
  QXE: "Horizon", RPA: "Republic", SAS: "SAS", SCX: "Sun Country", SIA: "Singapore", SKW: "SkyWest", SWA: "Southwest",
  SWR: "Swiss", THY: "Turkish", UAE: "Emirates", UAL: "United", UPS: "UPS", VIR: "Virgin Atlantic", VOI: "Volaris",
  VIV: "Viva Aerobus", WJA: "WestJet", WSW: "Swoop", AJT: "Amerijet", ABX: "ABX Air", ATN: "Air Transport Intl",
  CKS: "Kalitta", CLX: "Cargolux", GEC: "Lufthansa Cargo", PAC: "Polar", SOO: "Southern Air", NCR: "National",
  MTN: "Mountain Air Cargo", FLE: "Flair", TAM: "LATAM Brasil", LAN: "LATAM", ARG: "Aerolíneas Argentinas",
  AZA: "ITA", EZY: "easyJet", RYR: "Ryanair", WZZ: "Wizz Air", VLG: "Vueling", TAP: "TAP", AUA: "Austrian",
  BEL: "Brussels", LOT: "LOT", ELY: "El Al", SVA: "Saudia", MSR: "EgyptAir", ETH: "Ethiopian", KQA: "Kenya",
  SAA: "South African", AIC: "Air India", PAL: "Philippine", THA: "Thai", MAS: "Malaysia", GIA: "Garuda",
  ANZ: "Air New Zealand", VOZ: "Virgin Australia", JST: "Jetstar", CAL: "China Airlines", AAR: "Asiana",
  TSC: "Air Transat", POE: "Porter", CXP: "Contour", SIL: "Silver", UCA: "CommuteAir", CPZ: "Compass",
  TVF: "Transavia", EXS: "Jet2", TOM: "TUI", NAX: "Norwegian", ENT: "Enter Air", XOJ: "XOJET", VJA: "VistaJet",
  TWY: "Solairus", JRE: "JetEdge", EJM: "Executive Jet Mgmt", GPD: "Tradewind", KAP: "Cape Air", BXH: "Bar XH",
  WEN: "WestJet Encore", JSX: "JSX", DJT: "La Compagnie", RCH: "USAF Air Mobility", CNV: "US Navy", PAT: "US Army",
  CGX: "US Coast Guard", CBP: "Customs & Border", EAL: "Eastern", WGN: "Western Global", SNC: "Air Cargo Carriers",
  FWK: "Flightworks", PCM: "Westair", MRA: "Martinaire", CFS: "Empire", AIP: "Alpine Air", GUN: "Grand Aire",
};

// Military / government prefixes that otherwise look like airlines.
const MIL_PREFIX = new Set(["RCH", "CNV", "PAT", "CGX", "RRR", "ASY", "GAF", "CFC", "IAM", "BAF", "NAVY", "VVLL"]);
const CARGO = new Set(["FDX", "UPS", "GTI", "CKS", "CLX", "GEC", "PAC", "SOO", "NCR", "MTN", "AJT", "ABX", "ATN",
  "WGN", "SNC", "MRA", "CFS", "AIP", "GUN", "FWK", "PCM"]);
const BIZJET = new Set(["EJA", "LXJ", "XOJ", "VJA", "TWY", "JRE", "EJM"]);

// When the emitter category is missing (OpenSky often), fall back to the type designator.
const HEAVY_TYPES = /^(A30|A31|A33|A34|A35|A38|A3ST|B74|B76|B77|B78|MD11|DC10|C5|C17|IL76|AN12|AN22|AN124|KC10|KC46|E3|E4)/;
const LARGE_TYPES = /^(A19|A20|A21|A22|A32|B71|B72|B73|B75|B37|B38|B39|BCS|CRJ|E1[3-9]|E2|E7|MD8|MD9|DC9|F70|F100|AT[4-7]|DH8|SB20|SF34|C130|C30J|BA46|RJ)/;
const HELI_TYPES = /^(EC|AS3|AS5|AS6|B06|B407|B412|B429|B47|R22|R44|R66|H60|UH|AH|CH|S76|S92|A109|A119|A139|A169|EH10|MD5|MD6|H125|H130|H135|H145|H160|BK17)/;
const LIGHT_TYPES = /^(C1[5-9]\d|C2[01]\d|C72|C82|PA\d|P28|P32|P46|SR2|DA4|DA2|BE3[3-6]|BE2|M20|RV|AA5|TBM|PC12|GLAS|COL)/;

export const SIZE_CLASSES = [
  { id: "light", label: "Light", hint: "GA props, gliders, ultralights (<15.5k lb)" },
  { id: "small", label: "Small", hint: "Business jets, turboprops (15.5–75k lb)" },
  { id: "large", label: "Large", hint: "Narrow-bodies, regional jets (75–300k lb)" },
  { id: "heavy", label: "Heavy", hint: "Wide-bodies (>300k lb)" },
  { id: "fast", label: "High-perf", hint: "Military fast jets" },
  { id: "rotor", label: "Rotorcraft", hint: "Helicopters" },
  { id: "other", label: "Other", hint: "Balloons, drones, ground vehicles, unknown" },
];

export function sizeClass(a) {
  switch (a.cat) {
    case "A1": case "B1": case "B4": return "light";
    case "A2": return "small";
    case "A3": case "A4": return "large";
    case "A5": return "heavy";
    case "A6": return "fast";
    case "A7": return "rotor";
  }
  const t = a.type || "";
  if (t) {
    if (HEAVY_TYPES.test(t)) return "heavy";
    if (HELI_TYPES.test(t)) return "rotor";
    if (LARGE_TYPES.test(t)) return "large";
    if (LIGHT_TYPES.test(t)) return "light";
  }
  return "other";
}

export const OPERATOR_KINDS = [
  { id: "airline", label: "Airline" },
  { id: "cargo", label: "Cargo" },
  { id: "bizjet", label: "Charter / fractional" },
  { id: "ga", label: "Private / GA" },
  { id: "mil", label: "Military / gov" },
  { id: "unknown", label: "No callsign" },
];

/** Callsign "AAL2372" -> "AAL"; tail-number callsigns -> null. */
export function airlineCode(a) {
  const f = a.flight;
  if (!f) return null;
  const m = /^([A-Z]{3})\d[0-9A-Z]*$/.exec(f);
  if (!m) return null;
  if (a.reg && f.replace("-", "") === a.reg.replace("-", "")) return null;
  return m[1];
}

export function operatorKind(a) {
  const code = airlineCode(a);
  if (a.mil || (code && MIL_PREFIX.has(code))) return "mil";
  if (!a.flight) return "unknown";
  if (code) {
    if (CARGO.has(code)) return "cargo";
    if (BIZJET.has(code)) return "bizjet";
    return "airline";
  }
  return "ga";
}

export function airlineName(code) {
  return code ? AIRLINES[code] || code : null;
}

export function sizeLabel(id) {
  return SIZE_CLASSES.find((s) => s.id === id)?.label || id;
}

export function operatorLabel(id) {
  return OPERATOR_KINDS.find((s) => s.id === id)?.label || id;
}

/** Pre-compute derived fields once per update. */
export function classify(a) {
  a.size = sizeClass(a);
  a.airline = airlineCode(a);
  a.kind = operatorKind(a);
  return a;
}
