"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export type ContributionMapPoint = {
  id: string;
  title: string;
  organization: string;
  locationLabel: string;
  latitude: number;
  longitude: number;
  summary: string;
  contributorType: string;
  contributionCount: number;
  detailsList: string[];
};

// ---------------------------------------------------------------------------
// Baseline B4: no fabricated data.
//
// Upstream had a hardcoded cluster list: five hand-written institutions with
// invented counts and project names. When Gemini failed, it returned them to the
// page AND wrote them into StatsCache, so invented clusters looked like analysed
// DB data. That violates the repo's own data rule (pnpm check script + docs/data-governance.md).
// Now a failure shows an error / empty state instead.
//
// A database that already ran the old code may still hold those invented clusters in
// StatsCache. We recognise them by their fixed IDs and treat the cache as empty.
// ---------------------------------------------------------------------------
const LEGACY_PLACEHOLDER_IDS = new Set(["kmutt_fibo", "chula_robo", "vistec_brain", "cmu_robotics", "ct_asia"]);
const CACHE_KEY = "map_contribution_clusters";

function isLegacyPlaceholderCache(clusters: ContributionMapPoint[]) {
  return clusters.length > 0 && clusters.every((c) => LEGACY_PLACEHOLDER_IDS.has(c.id));
}

/** Keep only well-formed clusters with coordinates roughly inside Thailand. */
function sanitizeClusters(raw: unknown): ContributionMapPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is ContributionMapPoint =>
    !!c &&
    typeof c.id === "string" &&
    typeof c.title === "string" &&
    typeof c.latitude === "number" && c.latitude >= 5 && c.latitude <= 21 &&
    typeof c.longitude === "number" && c.longitude >= 97 && c.longitude <= 106 &&
    Array.isArray(c.detailsList)
  );
}

// NOT exported on purpose: every export of a "use server" file is a public HTTP
// endpoint. This one calls a paid API and writes the cache, so it is reachable
// only through reanalyzeClustersWithGemini() below, which checks ADMIN first.
async function analyzeClustersWithGemini(): Promise<ContributionMapPoint[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "mock_key" || apiKey.trim() === "") {
    throw new Error("GEMINI_API_KEY environment variable is not set or is invalid.");
  }

  // 1. Fetch contributions, robot models, and owned inventory
  const [contributions, robots, inventory] = await Promise.all([
    prisma.contribution.findMany({
      select: {
        id: true,
        title: true,
        description: true,
        organization: true,
        contributorName: true,
        contributionType: true
      }
    }),
    prisma.robotModel.findMany({
      select: {
        id: true,
        canonicalName: true,
        description: true,
        developerOrg: true,
        countryOfOrigin: true
      }
    }),
    // Privacy: private inventory (custodian, location, repair notes) must not be
    // sent to a third-party API. Only records marked public are analysed.
    prisma.ownedInventory.findMany({
      where: { visibility: "public" },
      select: {
        id: true,
        displayName: true,
        ownerOrg: true,
        custodian: true,
        locationLabel: true,
        notes: true
      }
    })
  ]);

  // 2. Prepare the payload for Gemini
  const payload = {
    contributions: contributions.map(c => ({
      type: "contribution",
      id: c.id,
      title: c.title,
      description: c.description,
      org: c.organization || c.contributorName,
      contribType: c.contributionType
    })),
    robots: robots.map(r => ({
      type: "robot_model",
      id: r.id,
      name: r.canonicalName,
      desc: r.description,
      org: r.developerOrg,
      country: r.countryOfOrigin
    })),
    inventory: inventory.map(i => ({
      type: "owned_inventory",
      id: i.id,
      name: i.displayName,
      org: i.ownerOrg || i.custodian,
      location: i.locationLabel,
      notes: i.notes
    }))
  };

  const prompt = `
You are an expert GIS and robotics analyst mapping the humanoid and social robotics ecosystem in Thailand.
Below is the database dump of contributions, robot models, and owned inventory from the Thailand Humanoid Atlas:

${JSON.stringify(payload, null, 2)}

Please read through all records and group/cluster them by geographical location of their development, research, or deployment within Thailand. 
Identify the key institutions, labs, or organizations (e.g. universities like Chulalongkorn, KMUTT, VISTEC, Chiang Mai University, or companies like CT Asia Robotics) responsible for these contributions.

For each cluster/location:
1. Provide a unique ID.
2. Set 'title' to the institution or entity name (e.g. "Chulalongkorn University Robotics Lab").
3. Set 'organization' to the organization name.
4. Set 'locationLabel' to the city and region in Thailand (e.g., "Bangkok, Thailand" or "Rayong, Thailand").
5. Geocode the location and set 'latitude' and 'longitude' to its coordinates in Thailand (use precise coordinates for the campus/facility if known, otherwise default to city coordinates).
6. Set 'summary' to a concise 1-2 sentence description summarizing what humanoid robotics contributions came from this location based on the database data (e.g. what robots they own, what papers/repos they contributed, etc.).
7. Set 'contributorType' to one of: "University", "Enterprise", "Government", "Community".
8. Set 'contributionCount' to the count of connected database records.
9. Set 'detailsList' to a list of titles/names of the specific contributions/robots/inventory connected to this location.

Return the response as a JSON object matching the requested schema.
`;

  // Key goes in a header, not the URL query string (URLs end up in logs).
  // Model is configurable because gemini-1.5-flash has likely been retired.
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            clusters: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  id: { type: "STRING" },
                  title: { type: "STRING" },
                  organization: { type: "STRING" },
                  locationLabel: { type: "STRING" },
                  latitude: { type: "NUMBER" },
                  longitude: { type: "NUMBER" },
                  summary: { type: "STRING" },
                  contributorType: { type: "STRING" },
                  contributionCount: { type: "NUMBER" },
                  detailsList: {
                    type: "ARRAY",
                    items: { type: "STRING" }
                  }
                },
                required: ["id", "title", "organization", "locationLabel", "latitude", "longitude", "summary", "contributorType", "contributionCount", "detailsList"]
              }
            }
          },
          required: ["clusters"]
        }
      }
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API returned error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textResponse) {
    throw new Error("Empty response from Gemini API");
  }

  const parsed = JSON.parse(textResponse);
  const clusters = sanitizeClusters(parsed.clusters);
  if (!clusters.length) {
    throw new Error("Gemini returned no valid clusters; cache left unchanged.");
  }
  
  // Save to StatsCache
  await prisma.statsCache.upsert({
    where: { key: CACHE_KEY },
    update: {
      valueJson: clusters as any,
      updatedAt: new Date()
    },
    create: {
      key: CACHE_KEY,
      valueJson: clusters as any
    }
  });

  return clusters;
}

export type ClusterLoadResult = {
  clusters: ContributionMapPoint[];
  status: "ok" | "empty" | "stale_placeholder_ignored" | "db_error";
};

/**
 * Read clusters from cache only. Page renders no longer call Gemini, because an
 * anonymous visitor should not trigger a paid API call on every empty-cache load.
 * Analysis runs only through the admin-only reanalyze action below.
 */
export async function fetchContributionClusters(): Promise<ClusterLoadResult> {
  try {
    const cached = await prisma.statsCache.findUnique({ where: { key: CACHE_KEY } });
    const clusters = sanitizeClusters(cached?.valueJson);
    if (isLegacyPlaceholderCache(clusters)) return { clusters: [], status: "stale_placeholder_ignored" };
    return { clusters, status: clusters.length ? "ok" : "empty" };
  } catch (e) {
    console.error("Cache fetch failed:", e);
    return { clusters: [], status: "db_error" };
  }
}

export async function reanalyzeClustersWithGemini() {
  // B1/B4: triggers a paid external API and writes to the DB -> admin only.
  await requireRole("ADMIN");

  let failed = false;
  try {
    await analyzeClustersWithGemini();
  } catch (e) {
    // B4: on failure we write NOTHING. The previous (real) cache stays as is.
    console.error("Gemini cluster analysis failed; cache not modified:", e);
    failed = true;
  }
  revalidatePath("/map");
  if (failed) redirect("/map?error=analysis_failed");
}
