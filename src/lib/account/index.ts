/**
 * Account management module
 *
 * Provides multi-account OAuth credential management with support for:
 * - Account CRUD operations
 * - Credential syncing to ~/.claude/.credentials.json
 * - Migration from legacy ~/.ccproxy/ paths
 */

export {
  AccountManager,
  setCustomHomeDir,
  type AddAccountOptions,
  type UpdateAccountOptions,
} from "./account-manager.js";

export {
  CredentialSyncService,
  setCustomHomeDir as setCredentialSyncHomeDir,
  type ClaudeCredentialsFile,
  type SyncResult,
} from "./credential-sync.js";

export type {
  Account,
  AccountMetadata,
  AccountsFile,
  AccountManagerEvents,
  OAuthToken,
} from "./types/account.js";
