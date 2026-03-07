/**
 * TypeScript interfaces for Marketing dashboard.
 * Frontend-safe DTOs for competitor management, brand voice, and content generation.
 *
 * @module types/marketing
 */

/** Competitor category for grouping/filtering */
export type CompetitorCategory =
  | "direct_competitor"
  | "indirect_competitor"
  | "industry_leader"
  | "aspirational"
  | "other";

/** Human-readable labels for competitor categories */
export const CATEGORY_LABELS: Record<CompetitorCategory, string> = {
  direct_competitor: "Direct Competitor",
  indirect_competitor: "Indirect Competitor",
  industry_leader: "Industry Leader",
  aspirational: "Aspirational",
  other: "Other",
};

/** Category badge color mapping (Tailwind classes) */
export const CATEGORY_BADGE_COLORS: Record<CompetitorCategory, string> = {
  direct_competitor: "bg-red-600",
  indirect_competitor: "bg-orange-600",
  industry_leader: "bg-blue-600",
  aspirational: "bg-purple-600",
  other: "bg-gray-600",
};

/** Engagement metrics summary for a competitor */
export interface CompetitorEngagement {
  avgLikes: number;
  avgReplies: number;
  avgRetweets: number;
  totalPostsScraped: number;
}

/** Frontend representation of a tracked competitor */
export interface Competitor {
  id: string;
  handle: string;
  displayName: string | null;
  followerCount: number | null;
  followingCount: number | null;
  category: CompetitorCategory;
  notes: string | null;
  engagement: CompetitorEngagement | null;
  lastScrapedAt: string | null;
  addedAt: string;
  avatarUrl: string | null;
}

/** Form data for adding a new competitor */
export interface AddCompetitorFormData {
  handle: string;
  category: CompetitorCategory;
  notes: string;
}

/**
 * Format a number for display (e.g., 1234 -> "1.2K", 1234567 -> "1.2M")
 */
export function formatMetricCount(count: number | null): string {
  if (count === null || count === undefined) return "--";
  if (count < 1000) return count.toString();
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

/**
 * Format an ISO timestamp to a relative time string.
 */
export function formatRelativeTime(isoDate: string | null): string {
  if (!isoDate) return "Never";
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  if (Number.isNaN(then) || diffMs < 0) return "just now";

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;

  const diffMonth = Math.floor(diffDay / 30);
  return `${diffMonth}mo ago`;
}

// ==================== Brand Voice Types ====================

export type EmojiPolicy = "none" | "minimal" | "moderate" | "liberal";
export type HashtagStrategy = "none" | "relevant" | "trending";

/** Human-readable labels for emoji policies */
export const EMOJI_POLICY_LABELS: Record<EmojiPolicy, string> = {
  none: "No Emojis",
  minimal: "Minimal",
  moderate: "Moderate",
  liberal: "Liberal",
};

/** Human-readable labels for hashtag strategies */
export const HASHTAG_STRATEGY_LABELS: Record<HashtagStrategy, string> = {
  none: "No Hashtags",
  relevant: "Relevant Only",
  trending: "Trending",
};

export interface FewShotExample {
  platform: string;
  topic: string;
  content: string;
}

/** Full brand voice configuration */
export interface BrandVoice {
  id: string;
  name: string;
  description: string;
  tone: string[];
  personality_traits: string[];
  system_prompt_template: string;
  few_shot_examples: FewShotExample[];
  constitutional_rules: string[];
  vocabulary_whitelist: string[];
  banned_words: string[];
  emoji_policy: EmojiPolicy;
  hashtag_strategy: HashtagStrategy;
  platform_overrides: Record<string, Partial<BrandVoice>>;
  created_at: string;
  updated_at: string;
}

/** Summary view returned by list endpoint (excludes large fields) */
export type BrandVoiceSummary = Omit<
  BrandVoice,
  "few_shot_examples" | "system_prompt_template"
>;

/** Form data for creating/updating a brand voice */
export interface BrandVoiceFormData {
  name: string;
  description: string;
  tone: string[];
  personality_traits: string[];
  system_prompt_template: string;
  few_shot_examples: FewShotExample[];
  constitutional_rules: string[];
  vocabulary_whitelist: string[];
  banned_words: string[];
  emoji_policy: EmojiPolicy;
  hashtag_strategy: HashtagStrategy;
  platform_overrides: Record<string, Partial<BrandVoice>>;
}

/** Default empty form data for creating a new brand voice */
export function createEmptyBrandVoiceFormData(): BrandVoiceFormData {
  return {
    name: "",
    description: "",
    tone: [],
    personality_traits: [],
    system_prompt_template: "",
    few_shot_examples: [],
    constitutional_rules: [],
    vocabulary_whitelist: [],
    banned_words: [],
    emoji_policy: "none",
    hashtag_strategy: "none",
    platform_overrides: {},
  };
}

/** Convert a full BrandVoice to form data for editing */
export function brandVoiceToFormData(voice: BrandVoice): BrandVoiceFormData {
  return {
    name: voice.name,
    description: voice.description,
    tone: [...voice.tone],
    personality_traits: [...voice.personality_traits],
    system_prompt_template: voice.system_prompt_template,
    few_shot_examples: voice.few_shot_examples.map((e) => ({ ...e })),
    constitutional_rules: [...voice.constitutional_rules],
    vocabulary_whitelist: [...voice.vocabulary_whitelist],
    banned_words: [...voice.banned_words],
    emoji_policy: voice.emoji_policy,
    hashtag_strategy: voice.hashtag_strategy,
    platform_overrides: JSON.parse(JSON.stringify(voice.platform_overrides)),
  };
}

// ==================== Content Generation Types ====================

/** Supported content platforms (matches MCP tool enum values) */
export type ContentPlatform = "twitter" | "linkedin" | "email";

/** Platform display labels */
export const PLATFORM_LABELS: Record<ContentPlatform, string> = {
  twitter: "X / Twitter",
  linkedin: "LinkedIn",
  email: "Email",
};

/** Platform character limits -- null means no limit */
export const PLATFORM_CHAR_LIMITS: Record<ContentPlatform, number | null> = {
  twitter: 280,
  linkedin: 3000,
  email: null,
};

/** Request payload for content generation (maps to marketing_generate_content MCP tool) */
export interface ContentGenerationRequest {
  topic: string;
  platform: ContentPlatform;
  brand_voice_id: string;
  key_message?: string;
  competitor_context?: string[];
  tone_override?: string;
}

/** Generated content item returned from the API */
export interface GeneratedContent {
  id: string;
  text: string;
  platform: ContentPlatform;
  subject?: string;
  brand_voice_id: string;
  generated_at: string;
  variation_label?: string;
}

/** Request payload for content refinement (maps to marketing_refine_content MCP tool) */
export interface RefinementRequest {
  content: string;
  platform: ContentPlatform;
  brand_voice_id: string;
  instructions: string;
}

// ==================== LinkedIn Integration Types ====================

/** Token validity status for a LinkedIn OAuth connection */
export type LinkedInTokenStatus = "valid" | "expiring_soon" | "expired" | "no_token";

/** LinkedIn account profile returned by the status API */
export interface LinkedInAccount {
  id: string;
  name: string;
  email: string;
  picture: string | null;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  scopes: string[];
  connectedAt: string;
}

/** LinkedIn connection state returned by GET /api/marketing/linkedin/status */
export interface LinkedInConnection {
  connected: boolean;
  account: LinkedInAccount | null;
  tokenStatus: LinkedInTokenStatus;
}

/** Token status indicator colors (Tailwind classes) */
export const TOKEN_STATUS_COLORS: Record<LinkedInTokenStatus, string> = {
  valid: "bg-green-500",
  expiring_soon: "bg-yellow-500",
  expired: "bg-red-500",
  no_token: "bg-gray-500",
};

/** Token status human-readable labels */
export const TOKEN_STATUS_LABELS: Record<LinkedInTokenStatus, string> = {
  valid: "Connected",
  expiring_soon: "Token expiring soon",
  expired: "Token expired - reconnect required",
  no_token: "Not connected",
};

// ==================== Email Campaign Types ====================

/** Campaign lifecycle status */
export type EmailCampaignStatus = "draft" | "sending" | "sent" | "scheduled";

/** Delivery metrics for a completed email campaign */
export interface EmailCampaignMetrics {
  total_sent: number;
  delivered: number;
  delivered_pct: number;
  opened: number;
  opened_pct: number;
  clicked: number;
  clicked_pct: number;
  bounced: number;
  bounced_pct: number;
}

/** Full email campaign DTO returned by the campaigns API */
export interface EmailCampaign {
  id: string;
  name: string;
  from: string;
  subject: string;
  previewText: string;
  html: string;
  segmentId: string;
  segmentName: string;
  status: EmailCampaignStatus;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
  metrics: EmailCampaignMetrics | null;
}

/** Audience/segment returned by the audiences API */
export interface EmailAudience {
  id: string;
  name: string;
  contactCount: number;
}

/** Email template summary returned by the templates API */
export interface EmailTemplate {
  id: string;
  name: string;
  description: string;
  thumbnailUrl: string | null;
  html: string;
}

/** Status badge styling config for campaign list */
export const CAMPAIGN_STATUS_STYLES: Record<
  EmailCampaignStatus,
  { bg: string; text: string; label: string }
> = {
  draft: { bg: "bg-gray-600", text: "text-gray-300", label: "Draft" },
  sending: { bg: "bg-blue-600 animate-pulse", text: "text-blue-300", label: "Sending" },
  sent: { bg: "bg-green-600", text: "text-green-300", label: "Sent" },
  scheduled: { bg: "bg-yellow-600", text: "text-yellow-300", label: "Scheduled" },
};
