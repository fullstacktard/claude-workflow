# Keychain Module

Cross-platform credential handling utilities for claude-workflow.

## Modules

- `keychain.ts` - Core extraction logic using macOS `security` command
- `keychain-cache.ts` - Performance optimization with TTL-based in-memory cache

## Platform Detection

Use these functions to conditionally execute platform-specific code:

```typescript
import { isMacOS, isLinux, isWindows } from './keychain';

if (isMacOS()) {
  // macOS-specific code
}
```

## Supported Platforms

| Function | Platform | `process.platform` | Status |
|----------|----------|-------------------|---------|
| `isMacOS()` | macOS | `darwin` | Implemented |
| `isLinux()` | Linux | `linux` | Placeholder |
| `isWindows()` | Windows | `win32` | Placeholder |

## macOS Keychain Integration

The module includes `extractFromKeychain()` for reading passwords from macOS Keychain:

```typescript
import { extractFromKeychain, isMacOS } from './keychain';

if (isMacOS()) {
  const password = await extractFromKeychain("Claude Code-credentials");
  if (password) {
    console.log("Found credentials in keychain");
  } else {
    console.log("No credentials stored in keychain");
  }
}
```

### Error Handling

The `extractFromKeychain()` function handles various error conditions:

- **Exit code 0**: Success - returns password string
- **Exit code 44**: Item not found - returns `null` (not an error)
- **Exit code 36**: Keychain locked - throws error requiring user authentication
- **Exit code 51**: Permission denied - throws error requiring user to grant access
- **Other codes**: Generic error with exit code and stderr

### Security Notes

The implementation uses `child_process.spawn` (not `exec`) to prevent command injection. Arguments are passed as an array to ensure user input is never concatenated into command strings.

## Keychain Cache

`KeychainCache` provides an in-memory TTL cache to reduce CPU overhead from spawning `security` processes repeatedly. The cache is used by `AccountManager.detectAndReadCredentials()`.

### Usage

```typescript
import { KeychainCache } from './keychain-cache';

const cache = new KeychainCache();

// First call spawns the security process
const credentials = await cache.get('Claude Code-credentials');

// Second call within 60s returns cached value (no process spawn)
const cached = await cache.get('Claude Code-credentials');

// Invalidate when credentials are known to have changed
cache.invalidate('Claude Code-credentials');

// Clear all cached entries
cache.clear();
```

### Cache Management

```typescript
// Check if a fresh entry exists
cache.has('Claude Code-credentials'); // true/false

// Get cache statistics
cache.getStats(); // { size: 1, entries: ['Claude Code-credentials'] }

// Custom TTL (default: 60 seconds)
const fastCache = new KeychainCache({ ttlMs: 30_000 });
```

### Performance

- Cache hit: < 1ms (in-memory Map lookup)
- Cache miss: ~50-100ms (spawns `security` process)
- Reduces process spawns by ~95% with 60-second polling interval
- Memory footprint: ~600-2100 bytes per cached credential

## Testing

```bash
# Run all keychain tests
npm test -- keychain

# Run cache tests specifically
npm test -- keychain-cache.test.ts
```

Test files:
- `keychain.test.ts` - Core extraction and platform detection tests
- `__tests__/keychain-cache.test.ts` - Cache behavior, TTL, invalidation, performance tests
- `__tests__/keychain.test.ts` - Additional extraction tests

## Future Work

- [ ] Implement Linux Secret Service integration
- [ ] Implement Windows Credential Manager integration
- [ ] Add credential writing functions (currently read-only)
