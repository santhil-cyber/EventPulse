export function classifyIncident(description: string, priority?: string | null): {
  incidentType: "medical" | "fire" | "security" | "stampede" | "infrastructure" | "other";
  severity: "critical" | "high" | "medium" | "low";
  detectedLanguage: "en" | "hi" | "es";
} {
  const lower = description.normalize("NFKC").toLowerCase();

  // Multi-lingual vocabulary dictionaries
  const medicalRegex = /\b(bleed|hurt|injur|unconscious|faint|cardiac|heart|medical|paramedic|chok|breath|seizure|pain|sick|allergic|collapsed|ambulance|chot|behosh|khoon|dard|bimar|saans|daura|herido|herida|inconsciente|sangre|sangrado|dolor|medico|ambulancia|asfixia|ataque)\b/;
  const fireRegex = /\b(fire|smoke|flame|burn|explosion|heat|extinguisher|burning|hot|aag|dhuan|jala|dhamaka|shola|fuego|humo|llamas|incendio|quemado|quemadura)\b/;
  const stampedeRegex = /\b(stampede|crush|pushing|push|trampl|surge|overcrowd|crowd|packed|panic|rushing|suffocat|bhagdad|bheed|dhakka|dabav|phasna|estampida|multitud|aglomeracion|aplastamiento|avalancha|empujones|panico)\b/;
  const securityRegex = /\b(fight|weapon|theft|stolen|knife|gun|assault|security|brawl|intruder|thief|violence|harassment|attack|threat|ladai|hathiyar|chori|chaku|bandook|maarpeet|danga|hamla|pelea|arma|cuchillo|pistola|robo|ladron|asalto|ataque|disturbio)\b/;
  const infraRegex = /\b(collaps|barricade|broken|leak|flood|power|blackout|structure|fall|blocked|barrier|damage|malfunction|exit|gate|railing|toota|girna|girgaya|darar|bijli|andhera|colapso|derrumbe|roto|fuga|apagon|apagón|danado|caida)\b/;

  let incidentType: "medical" | "fire" | "security" | "stampede" | "infrastructure" | "other" = "other";
  if (fireRegex.test(lower)) {
    incidentType = "fire";
  } else if (stampedeRegex.test(lower)) {
    incidentType = "stampede";
  } else if (medicalRegex.test(lower)) {
    incidentType = "medical";
  } else if (securityRegex.test(lower)) {
    incidentType = "security";
  } else if (infraRegex.test(lower)) {
    incidentType = "infrastructure";
  }

  // Language detection heuristic
  let detectedLanguage: "en" | "hi" | "es" = "en";
  if (/\b(chot|behosh|khoon|dard|aag|dhuan|bhagdad|bheed|dhakka|ladai|hathiyar|toota|bijli|madad|bhai)\b/.test(lower)) {
    detectedLanguage = "hi";
  } else if (/\b(herido|inconsciente|fuego|humo|estampida|multitud|pelea|arma|roto|ayuda|por favor|urgente)\b/.test(lower)) {
    detectedLanguage = "es";
  }

  let severity: "critical" | "high" | "medium" | "low" = "medium";
  if (
    priority === "critical" ||
    /\b(unconscious|explosion|massive|stampede|casualt|urgent help|critical|can't breathe|not breathing|cardiac|behosh|dhamaka|bhagdad|saans band|inconsciente|sin respirar|emergencia grave)\b/.test(lower)
  ) {
    severity = "critical";
  } else if (
    priority === "high" ||
    /\b(fire|blocked|pushing|injur|broken|weapon|bleeding|severe|chot|khoon|hathiyar|aag|fuego|herido|sangre|arma)\b/.test(lower)
  ) {
    severity = "high";
  } else if (priority === "low" || /\b(minor|small|slow|lost|noise|thoda|chota|pequeno|pequeño)\b/.test(lower)) {
    severity = "low";
  }

  if (/[\u0900-\u097f]/u.test(lower)) {
    detectedLanguage = "hi";
    if (/आग|धुआँ|धुआं|विस्फोट/u.test(lower)) incidentType = "fire";
    else if (/भगदड़|भीड़|धक्का/u.test(lower)) incidentType = "stampede";
    else if (/बेहोश|खून|चोट|सांस|साँस/u.test(lower)) incidentType = "medical";
    if (/बेहोश|भगदड़|विस्फोट|सांस नहीं|साँस नहीं/u.test(lower)) severity = "critical";
    else if (/आग|खून|चोट/u.test(lower) && severity !== "critical") severity = "high";
  }
  return { incidentType, severity, detectedLanguage };
}

