/**
 * XAccountDetail Component
 *
 * Displays account metadata in organized sections:
 * - Account identity (handle, email, state badge, creation date)
 * - Cookie status (auth_token, ct0 presence, freshness indicator)
 * - Proxy configuration (host:port, country)
 * - Warming progress bar (when account is in warming state)
 *
 * State badge colors follow the convention:
 * - warming: amber
 * - active: green
 * - suspended: red
 * - profile_setup: blue
 *
 * @module components/x-accounts/XAccountDetail
 */

import { Key, Globe, Flame, CircleCheck, Ban, UserCog, Plus, Mail, Phone, Lock } from "lucide-react";
import type { DashboardXAccount, XAccountState } from "../../types/x-accounts";

/** Props for the XAccountDetail component */
interface XAccountDetailProps {
  /** The account to display */
  account: DashboardXAccount;
}

/** Background + text color classes for each account state badge */
const STATE_BADGE_CLASSES: Record<XAccountState, string> = {
  created: "bg-gray-600 text-white",
  email_verified: "bg-cyan-600 text-white",
  phone_verified: "bg-cyan-700 text-white",
  profile_setup: "bg-blue-600 text-white",
  warming: "bg-amber-600 text-white",
  active: "bg-green-600 text-white",
  suspended: "bg-red-600 text-white",
  locked: "bg-orange-600 text-white",
};

/** Icon component for each account state */
const STATE_ICONS: Record<XAccountState, typeof Flame> = {
  created: Plus,
  email_verified: Mail,
  phone_verified: Phone,
  profile_setup: UserCog,
  warming: Flame,
  active: CircleCheck,
  suspended: Ban,
  locked: Lock,
};

/**
 * Derives a cookie freshness label and color from the account DTO.
 * - "Missing" (red) if no auth_token or ct0
 * - "Stale" (yellow) if last harvest was >24 hours ago
 * - "Fresh" (green) otherwise
 */
function getCookieStatus(account: DashboardXAccount): { label: string; color: string } {
  if (!account.has_cookies) {
    return { label: "Missing", color: "text-red-400" };
  }
  if (account.cookie_harvested_at) {
    const harvestedAt = new Date(account.cookie_harvested_at).getTime();
    const hoursSinceHarvest = (Date.now() - harvestedAt) / (1000 * 60 * 60);
    if (hoursSinceHarvest > 24) {
      return { label: "Stale", color: "text-yellow-400" };
    }
  }
  return { label: "Fresh", color: "text-green-400" };
}

/**
 * XAccountDetail renders the full detail view for a selected X account.
 */
export function XAccountDetail({ account }: XAccountDetailProps): JSX.Element {
  const cookieStatus = getCookieStatus(account);
  const StateIcon = STATE_ICONS[account.state];

  return (
    <div className="p-4 space-y-4 text-sm">
      {/* Account Identity */}
      <section className="space-y-2">
        <h3 className="text-xs text-gray-500 uppercase tracking-wide">Account</h3>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-gray-500">Handle</span>
            <p className="text-white font-medium">@{account.handle}</p>
          </div>
          <div>
            <span className="text-gray-500">Email</span>
            <p className="text-gray-300 truncate">{account.email || "N/A"}</p>
          </div>
          <div>
            <span className="text-gray-500">State</span>
            <p className="mt-0.5">
              <span
                className={`inline-flex items-center gap-1 text-xs px-1.5 py-px rounded-full ${STATE_BADGE_CLASSES[account.state]}`}
              >
                <StateIcon className="w-3 h-3" />
                {account.state}
              </span>
            </p>
          </div>
          <div>
            <span className="text-gray-500">Created</span>
            <p className="text-gray-300">
              {new Date(account.created_at).toLocaleDateString()}
            </p>
          </div>
        </div>
      </section>

      {/* Cookie Status */}
      <section className="space-y-2">
        <h3 className="text-xs text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
          <Key className="w-3 h-3" />
          Cookies
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-gray-500">Cookies</span>
            <p className={account.has_cookies ? "text-green-400" : "text-red-400"}>
              {account.has_cookies ? "Present" : "Missing"}
            </p>
          </div>
          <div>
            <span className="text-gray-500">OAuth Tokens</span>
            <p className={account.has_oauth_tokens ? "text-green-400" : "text-red-400"}>
              {account.has_oauth_tokens ? "Present" : "Missing"}
            </p>
          </div>
          <div className="col-span-2">
            <span className="text-gray-500">Status</span>
            <p className={cookieStatus.color}>{cookieStatus.label}</p>
          </div>
        </div>
      </section>

      {/* Proxy Info */}
      <section className="space-y-2">
        <h3 className="text-xs text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
          <Globe className="w-3 h-3" />
          Proxy
        </h3>
        {account.has_proxy ? (
          <div>
            <span className="text-gray-500">Protocol</span>
            <p className="text-gray-300">{account.proxy_protocol ?? "N/A"}</p>
          </div>
        ) : (
          <p className="text-gray-500">No proxy configured</p>
        )}
      </section>

      {/* Warming Progress */}
      {account.state === "warming" && account.warming !== null && (
        <section className="space-y-2">
          <h3 className="text-xs text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
            <Flame className="w-3 h-3 text-amber-400" />
            Warming Progress
          </h3>
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-gray-400">
                Day {account.warming.day} &middot; {account.warming.actions_today} actions today
              </span>
              <span className="text-gray-500">
                Started {new Date(account.warming.started_at).toLocaleDateString()}
              </span>
            </div>
            <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full transition-all"
                style={{ width: `${Math.min(account.warming.day * 5, 100)}%` }}
              />
            </div>
          </div>
        </section>
      )}

      {/* Additional Info */}
      <section className="space-y-2">
        <h3 className="text-xs text-gray-500 uppercase tracking-wide">Info</h3>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-gray-500">Creation Method</span>
            <p className="text-gray-300">{account.creation_method ?? "Unknown"}</p>
          </div>
          <div>
            <span className="text-gray-500">Has Phone</span>
            <p className={account.has_phone ? "text-green-400" : "text-gray-500"}>
              {account.has_phone ? "Yes" : "No"}
            </p>
          </div>
          {account.notes && (
            <div className="col-span-2">
              <span className="text-gray-500">Notes</span>
              <p className="text-gray-300 text-xs mt-0.5">{account.notes}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
