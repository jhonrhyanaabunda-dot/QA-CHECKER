// ───────────────────────────────────────────────────────────────────────────
// Google rating verification — pairs the displayed star rating with the review
// count and cross-checks against the live Google Business Profile when a Places
// API key is configured (GOOGLE_PLACES_API_KEY). Without a key it returns the
// displayed values flagged for manual confirmation, with clear guidance.
// ───────────────────────────────────────────────────────────────────────────

import { genId } from "../utils";
import { dealerVerifyUrl, googleReviewsUrl } from "../verifiers/sources";
import type { Dealership } from "./dealership";
import type { ExtractedContent, RatingCheck } from "./types";

export async function checkRatings(
  content: ExtractedContent,
  dealer?: Dealership,
): Promise<RatingCheck[]> {
  const text = content.text;

  const ratingMatch = text.match(/(\d(?:\.\d)?)\s*(?:\/\s*5|stars?|★|out of 5)/i);
  const reviewMatch = text.match(/([\d,]{2,})\+?\s*(?:google\s+)?reviews?/i);

  if (!ratingMatch && !reviewMatch) return [];

  const displayedRating = ratingMatch ? Number(ratingMatch[1]) : undefined;
  const displayedReviewCount = reviewMatch
    ? Number(reviewMatch[1].replace(/,/g, ""))
    : undefined;

  // Prefer verifying on the dealership's own site; fall back to a Google Maps
  // lookup of the dealership name (lands on their live Google profile/rating).
  const reviewsUrl = dealer?.domain
    ? dealerVerifyUrl(dealer, "reviews rating google")
    : googleReviewsUrl(dealer?.name || content.title);
  const live = await fetchLiveRating(content);

  if (live) {
    const ratingClose =
      displayedRating == null || Math.abs(displayedRating - live.rating) <= 0.1;
    const countClose =
      displayedReviewCount == null ||
      Math.abs(displayedReviewCount - live.reviews) / Math.max(live.reviews, 1) <= 0.1;
    const ok = ratingClose && countClose;
    return [
      {
        id: genId("rate"),
        displayedRating,
        displayedReviewCount,
        currentRating: live.rating,
        currentReviewCount: live.reviews,
        status: ok ? "pass" : "fail",
        source: "Google Business Profile (live)",
        sourceUrl: reviewsUrl,
        recommendation: ok
          ? undefined
          : `Update to ${live.rating}★ / ${live.reviews.toLocaleString()} reviews to match the live Google profile.`,
      },
    ];
  }

  // No live source — flag for manual review.
  return [
    {
      id: genId("rate"),
      displayedRating,
      displayedReviewCount,
      status: "warning",
      source: "Manual (set GOOGLE_PLACES_API_KEY for live cross-check)",
      sourceUrl: reviewsUrl,
      recommendation:
        "Confirm the rating and review count against the dealership's current Google Business Profile.",
    },
  ];
}

interface LiveRating {
  rating: number;
  reviews: number;
}

/** Query Google Places for the live rating, if a key + resolvable name exist. */
async function fetchLiveRating(
  content: ExtractedContent,
): Promise<LiveRating | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;
  // Best-effort dealership name = page title's leading segment.
  const name = content.title.split(/[|\-–—]/)[0].trim();
  if (!name) return null;
  try {
    const res = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "places.rating,places.userRatingCount,places.displayName",
        },
        body: JSON.stringify({ textQuery: name }),
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const place = data.places?.[0];
    if (!place?.rating) return null;
    return { rating: place.rating, reviews: place.userRatingCount ?? 0 };
  } catch {
    return null;
  }
}
