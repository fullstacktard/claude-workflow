import { spawn } from "node:child_process";

/**
 * Result type for keychain operations
 */
export interface KeychainResult {
	/** Whether the operation was successful */
	success: boolean;
	/** The extracted password if successful */
	data?: string;
	/** Error type if unsuccessful */
	error?: "not_found" | "locked" | "permission_denied" | "execution_failed";
	/** Human-readable error message */
	message?: string;
}

/**
 * Extract a password from macOS Keychain using the security command.
 *
 * **Security-critical implementation notes:**
 * - Uses `child_process.spawn` (NOT `exec`) to prevent command injection
 * - Arguments passed as array to spawn (never concatenated strings)
 * - Handles all security exit codes gracefully
 *
 * **Exit code handling:**
 * - `0`: Success - returns password string
 * - `44`: Item not found - returns null (not an error condition)
 * - `36`: Keychain locked - throws descriptive error requiring user authentication
 * - Other: Generic error with exit code and stderr
 *
 * @param serviceName - The keychain service name to search for (e.g., "Claude Code-credentials")
 * @returns Promise that resolves to the password string if found, or null if not found
 * @throws Error if keychain is locked or security command fails
 *
 * @example
 * ```typescript
 * // Extract Claude Code credentials
 * const password = await extractFromKeychain("Claude Code-credentials");
 * if (password) {
 *   console.log("Found credentials");
 * } else {
 *   console.log("No credentials stored in keychain");
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Handle keychain locked error
 * try {
 *   const password = await extractFromKeychain("my-service");
 * } catch (error) {
 *   if (error.message.includes("locked")) {
 *     console.error("Please unlock your keychain and try again");
 *   }
 * }
 * ```
 */
export async function extractFromKeychain(serviceName: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    // Use spawn for security (prevents command injection)
    // Arguments passed as array - NEVER concatenate user input into command string
    const proc = spawn("security", [
      "find-generic-password",
      "-s",
      serviceName,
      "-w" // Output password only (without metadata)
    ]);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      switch (code) {
      case 0: {
        // Success - return password (trimmed of any whitespace)
        resolve(stdout.trim());
      
        break;
      }
      case 44: {
        // Item not found - return null (this is NOT an error condition)
        // User may not have stored credentials in keychain yet
        resolve(null);
      
        break;
      }
      case 36: {
        // Keychain locked - user needs to authenticate
        // This requires manual intervention from the user
        reject(new Error("Keychain is locked. Please unlock your keychain and try again."));
      
        break;
      }
      case 51: {
        // Permission denied - user needs to grant access
        reject(new Error("Permission denied accessing keychain. Please grant access when prompted."));
      
        break;
      }
      default: {
        // Other error - include exit code and stderr for debugging
        const errorMsg = stderr.trim() || "Unknown error";
        reject(new Error(`security command failed (exit ${code}): ${errorMsg}`));
      }
      }
    });

    proc.on("error", (err) => {
      // Command not found or execution failed
      // This typically means security command is not available (non-macOS)
      reject(new Error(`Failed to execute security command: ${err.message}`));
    });
  });
}

/**
 * Check if the current platform is macOS.
 *
 * This is useful for conditionally enabling keychain functionality
 * since the macOS Keychain and `security` command are only available on macOS.
 *
 * @returns true if running on macOS (darwin), false otherwise
 *
 * @example
 * ```typescript
 * if (isMacOS()) {
 *   const password = await extractFromKeychain("my-service");
 * } else {
 *   console.log("Keychain only available on macOS");
 * }
 * ```
 */
export function isMacOS(): boolean {
  return process.platform === "darwin";
}

/**
 * Checks if the current platform is Linux.
 *
 * @returns {boolean} `true` if running on Linux, `false` otherwise
 *
 * @remarks
 * This function is provided for future Linux Secret Service integration.
 * Currently not used in credential extraction logic.
 *
 * @example
 * ```typescript
 * if (isLinux()) {
 *   // Future: Use Linux Secret Service (libsecret)
 *   const creds = await extractFromSecretService();
 * }
 * ```
 */
export function isLinux(): boolean {
  return process.platform === "linux";
}

/**
 * Checks if the current platform is Windows.
 *
 * @returns {boolean} `true` if running on Windows (win32), `false` otherwise
 *
 * @remarks
 * This function is provided for future Windows Credential Manager integration.
 * Currently not used in credential extraction logic.
 *
 * @example
 * ```typescript
 * if (isWindows()) {
 *   // Future: Use Windows Credential Manager (node-credentialstore-win32)
 *   const creds = await extractFromCredentialManager();
 * }
 * ```
 */
export function isWindows(): boolean {
  return process.platform === "win32";
}

/**
 * Safe Keychain extraction with comprehensive error handling.
 *
 * Wraps `extractFromKeychain()` to provide structured error categorization
 * for all possible security command exit codes. Returns a `KeychainResult`
 * object instead of throwing errors, enabling graceful fallback logic.
 *
 * **Error categorization:**
 * - `not_found` - Keychain item doesn't exist (exit 44)
 * - `locked` - Keychain is locked, user needs to authenticate (exit 36)
 * - `permission_denied` - Access denied, user needs to grant access (exit 51)
 * - `execution_failed` - Other errors (invalid JSON, command failed, etc.)
 *
 * **Security guarantees:**
 * - No credentials are leaked into error messages
 * - JSON validation prevents malformed data crashes
 * - Actionable error messages for user troubleshooting
 *
 * @param serviceName - macOS Keychain service name (e.g., "Claude Code-credentials")
 * @returns KeychainResult with success status and categorized errors
 *
 * @example Success case
 * ```typescript
 * const result = await safeKeychainExtract('Claude Code-credentials');
 * if (result.success) {
 *   const credentials = JSON.parse(result.data!);
 *   // Use credentials...
 * }
 * ```
 *
 * @example Error handling
 * ```typescript
 * const result = await safeKeychainExtract('Claude Code-credentials');
 * if (!result.success) {
 *   switch (result.error) {
 *     case 'locked':
 *       console.log('Keychain is locked. Please unlock your Mac keychain.');
 *       break;
 *     case 'not_found':
 *       console.log('Falling back to file-based credentials...');
 *       break;
 *     case 'permission_denied':
 *       console.log('Grant access in Keychain Access app');
 *       break;
 *     default:
 *       console.error('Unexpected error:', result.message);
 *   }
 * }
 * ```
 *
 * @see {@link extractFromKeychain} for the underlying extraction logic
 * @see {@link KeychainResult} for the result structure
 */
export async function safeKeychainExtract(serviceName: string): Promise<KeychainResult> {
  try {
    const password = await extractFromKeychain(serviceName);

    // extractFromKeychain returns null for exit code 44 (not found)
    if (password === null) {
      return {
        success: false,
        error: "not_found",
        message: `No keychain item found for service: ${serviceName}`
      };
    }

    // Validate that we got valid JSON (prevents malformed data crashes)
    // The keychain should store credentials as JSON, so if parsing fails,
    // the data is corrupted or in an unexpected format
    try {
      JSON.parse(password);
      return { success: true, data: password };
    } catch {
      return {
        success: false,
        error: "execution_failed",
        message: "Keychain returned invalid JSON data"
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    // Exit code 36: Keychain locked
    // User needs to authenticate to unlock the keychain
    // "User interaction is not allowed" occurs when security runs non-interactively
    if (message.includes("locked") || message.includes("User interaction is not allowed")) {
      return {
        success: false,
        error: "locked",
        message:
					"Keychain is locked. Unlock with: security unlock-keychain ~/Library/Keychains/login.keychain-db"
      };
    }

    // Exit code 51: Permission denied
    // User needs to grant access via Keychain Access app
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes("permission") || lowerMessage.includes("passphrase")) {
      return {
        success: false,
        error: "permission_denied",
        message: "Access denied to keychain item. Grant access in Keychain Access app."
      };
    }

    // All other errors (including command execution failures)
    // Return the original error message for debugging
    return {
      success: false,
      error: "execution_failed",
      message
    };
  }
}
