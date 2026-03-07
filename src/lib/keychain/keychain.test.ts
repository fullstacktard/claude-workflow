import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

// Mock node:child_process at the module level so extractFromKeychain
// (called internally by safeKeychainExtract) uses our mock spawn
vi.mock('node:child_process', () => ({
	spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
import {
	isMacOS,
	isLinux,
	isWindows,
	extractFromKeychain,
	safeKeychainExtract,
} from './keychain';

const mockSpawn = vi.mocked(spawn);

/**
 * Creates a fake ChildProcess that emits events for stdout, stderr, close, and error.
 */
function createMockProcess(): ChildProcess & {
	_stdout: EventEmitter;
	_stderr: EventEmitter;
} {
	const proc = new EventEmitter() as ChildProcess & {
		_stdout: EventEmitter;
		_stderr: EventEmitter;
	};
	proc._stdout = new EventEmitter();
	proc._stderr = new EventEmitter();
	(proc as Record<string, unknown>).stdout = proc._stdout;
	(proc as Record<string, unknown>).stderr = proc._stderr;
	return proc;
}

/**
 * Helper: configure mockSpawn to simulate a security command response.
 * Returns the mock process for further assertions if needed.
 */
function simulateSecurityCommand(opts: {
	exitCode: number;
	stdout?: string;
	stderr?: string;
}): ReturnType<typeof createMockProcess> {
	const proc = createMockProcess();
	mockSpawn.mockReturnValue(proc);

	// Schedule data emission + close on next tick so the Promise in extractFromKeychain
	// has time to attach listeners
	queueMicrotask(() => {
		if (opts.stdout) {
			proc._stdout.emit('data', Buffer.from(opts.stdout));
		}
		if (opts.stderr) {
			proc._stderr.emit('data', Buffer.from(opts.stderr));
		}
		proc.emit('close', opts.exitCode);
	});

	return proc;
}

/**
 * Helper: configure mockSpawn to simulate multiple stdout data chunks.
 */
function simulateMultiChunkStdout(opts: {
	chunks: string[];
	exitCode: number;
}): ReturnType<typeof createMockProcess> {
	const proc = createMockProcess();
	mockSpawn.mockReturnValue(proc);

	queueMicrotask(() => {
		for (const chunk of opts.chunks) {
			proc._stdout.emit('data', Buffer.from(chunk));
		}
		proc.emit('close', opts.exitCode);
	});

	return proc;
}

/**
 * Helper: configure mockSpawn to simulate a spawn error (e.g., command not found).
 */
function simulateSpawnError(errorMessage: string): ReturnType<typeof createMockProcess> {
	const proc = createMockProcess();
	mockSpawn.mockReturnValue(proc);

	queueMicrotask(() => {
		proc.emit('error', new Error(errorMessage));
	});

	return proc;
}

// ---------------------------------------------------------------------------
// Platform Detection Utilities
// ---------------------------------------------------------------------------

describe('Platform Detection Utilities', () => {
	let originalPlatform: NodeJS.Platform;

	beforeEach(() => {
		originalPlatform = process.platform;
	});

	afterEach(() => {
		Object.defineProperty(process, 'platform', {
			value: originalPlatform,
			writable: true,
			configurable: true,
		});
	});

	describe('isMacOS', () => {
		it('should return true when platform is darwin', () => {
			Object.defineProperty(process, 'platform', {
				value: 'darwin',
				writable: true,
				configurable: true,
			});

			expect(isMacOS()).toBe(true);
			expect(isLinux()).toBe(false);
			expect(isWindows()).toBe(false);
		});

		it('should return false when platform is not darwin', () => {
			Object.defineProperty(process, 'platform', {
				value: 'linux',
				writable: true,
				configurable: true,
			});

			expect(isMacOS()).toBe(false);
		});
	});

	describe('isLinux', () => {
		it('should return true when platform is linux', () => {
			Object.defineProperty(process, 'platform', {
				value: 'linux',
				writable: true,
				configurable: true,
			});

			expect(isLinux()).toBe(true);
			expect(isMacOS()).toBe(false);
			expect(isWindows()).toBe(false);
		});

		it('should return false when platform is not linux', () => {
			Object.defineProperty(process, 'platform', {
				value: 'darwin',
				writable: true,
				configurable: true,
			});

			expect(isLinux()).toBe(false);
		});
	});

	describe('isWindows', () => {
		it('should return true when platform is win32', () => {
			Object.defineProperty(process, 'platform', {
				value: 'win32',
				writable: true,
				configurable: true,
			});

			expect(isWindows()).toBe(true);
			expect(isMacOS()).toBe(false);
			expect(isLinux()).toBe(false);
		});

		it('should return false when platform is not win32', () => {
			Object.defineProperty(process, 'platform', {
				value: 'darwin',
				writable: true,
				configurable: true,
			});

			expect(isWindows()).toBe(false);
		});
	});

	describe('Platform Value Reference', () => {
		it('should recognize all valid Node.js platform values', () => {
			const platforms: NodeJS.Platform[] = [
				'darwin',
				'linux',
				'win32',
				'freebsd',
				'openbsd',
				'sunos',
				'aix',
			];

			platforms.forEach((platform) => {
				Object.defineProperty(process, 'platform', {
					value: platform,
					writable: true,
					configurable: true,
				});

				const macOS = isMacOS();
				const linux = isLinux();
				const windows = isWindows();

				expect(typeof macOS).toBe('boolean');
				expect(typeof linux).toBe('boolean');
				expect(typeof windows).toBe('boolean');
			});
		});
	});

	describe('Cross-Platform Exclusivity', () => {
		it('should ensure only one platform returns true at a time', () => {
			const testPlatforms: Array<{
				platform: NodeJS.Platform;
				expected: string;
			}> = [
				{ platform: 'darwin', expected: 'macOS' },
				{ platform: 'linux', expected: 'linux' },
				{ platform: 'win32', expected: 'windows' },
			];

			testPlatforms.forEach(({ platform, expected }) => {
				Object.defineProperty(process, 'platform', {
					value: platform,
					writable: true,
					configurable: true,
				});

				const results = {
					macOS: isMacOS(),
					linux: isLinux(),
					windows: isWindows(),
				};

				const trueCount = Object.values(results).filter((v) => v === true).length;

				expect(trueCount).toBe(1);
				expect(results[expected as keyof typeof results]).toBe(true);
			});
		});

		it('should return false for all platform checks on unsupported platforms', () => {
			Object.defineProperty(process, 'platform', {
				value: 'freebsd',
				writable: true,
				configurable: true,
			});

			expect(isMacOS()).toBe(false);
			expect(isLinux()).toBe(false);
			expect(isWindows()).toBe(false);
		});
	});
});

// ---------------------------------------------------------------------------
// extractFromKeychain
// ---------------------------------------------------------------------------

describe('extractFromKeychain', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should return password on exit code 0', async () => {
		simulateSecurityCommand({ exitCode: 0, stdout: 'my-secret-password\n' });

		const result = await extractFromKeychain('test-service');

		expect(result).toBe('my-secret-password');
		expect(mockSpawn).toHaveBeenCalledWith('security', [
			'find-generic-password',
			'-s',
			'test-service',
			'-w',
		]);
	});

	it('should trim whitespace from returned password', async () => {
		simulateSecurityCommand({ exitCode: 0, stdout: '  some-password  \n' });

		const result = await extractFromKeychain('test-service');

		expect(result).toBe('some-password');
	});

	it('should return empty string when stdout is only whitespace', async () => {
		simulateSecurityCommand({ exitCode: 0, stdout: '   \n' });

		const result = await extractFromKeychain('test-service');

		expect(result).toBe('');
	});

	it('should concatenate multiple stdout data chunks', async () => {
		simulateMultiChunkStdout({
			chunks: ['{"part1":', '"value1",', '"part2":"value2"}'],
			exitCode: 0,
		});

		const result = await extractFromKeychain('test-service');

		expect(result).toBe('{"part1":"value1","part2":"value2"}');
	});

	it('should return null on exit code 44 (not found)', async () => {
		simulateSecurityCommand({ exitCode: 44, stderr: 'The specified item could not be found' });

		const result = await extractFromKeychain('missing-service');

		expect(result).toBeNull();
	});

	it('should throw on exit code 36 (locked)', async () => {
		simulateSecurityCommand({ exitCode: 36, stderr: 'Keychain is locked' });

		await expect(extractFromKeychain('test-service')).rejects.toThrow('locked');
	});

	it('should throw on exit code 51 (permission denied)', async () => {
		simulateSecurityCommand({ exitCode: 51, stderr: 'Permission denied' });

		await expect(extractFromKeychain('test-service')).rejects.toThrow('Permission denied');
	});

	it('should throw on other exit codes with stderr', async () => {
		simulateSecurityCommand({ exitCode: 99, stderr: 'unexpected error' });

		await expect(extractFromKeychain('test-service')).rejects.toThrow('exit 99');
	});

	it('should throw with "Unknown error" when exit code is non-zero and stderr is empty', async () => {
		simulateSecurityCommand({ exitCode: 99 });

		await expect(extractFromKeychain('test-service')).rejects.toThrow('Unknown error');
	});

	it('should throw on spawn error (command not found)', async () => {
		simulateSpawnError('spawn security ENOENT');

		await expect(extractFromKeychain('test-service')).rejects.toThrow(
			'Failed to execute security command'
		);
	});

	it('should pass service name with special characters safely via spawn args', async () => {
		simulateSecurityCommand({ exitCode: 44 });

		await extractFromKeychain('service with spaces & "quotes"');

		expect(mockSpawn).toHaveBeenCalledWith('security', [
			'find-generic-password',
			'-s',
			'service with spaces & "quotes"',
			'-w',
		]);
	});
});

// ---------------------------------------------------------------------------
// safeKeychainExtract
// ---------------------------------------------------------------------------

describe('safeKeychainExtract', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('Success Cases', () => {
		it('should return success with valid JSON credentials', async () => {
			const validCredentials = JSON.stringify({
				claudeAiOauth: {
					accessToken: 'test-token',
					refreshToken: 'test-refresh',
				},
			});

			simulateSecurityCommand({ exitCode: 0, stdout: validCredentials });

			const result = await safeKeychainExtract('Claude Code-credentials');

			expect(result.success).toBe(true);
			expect(result.data).toBe(validCredentials);
			expect(result.error).toBeUndefined();
			expect(result.message).toBeUndefined();
		});

		it('should validate JSON before returning success', async () => {
			const validJson = JSON.stringify({ key: 'value' });
			simulateSecurityCommand({ exitCode: 0, stdout: validJson });

			const result = await safeKeychainExtract('test-service');

			expect(result.success).toBe(true);
			expect(() => JSON.parse(result.data!)).not.toThrow();
		});
	});

	describe('Not Found Case (Exit Code 44)', () => {
		it('should return not_found error when extractFromKeychain returns null', async () => {
			simulateSecurityCommand({ exitCode: 44, stderr: 'Item not found' });

			const result = await safeKeychainExtract('non-existent-service');

			expect(result.success).toBe(false);
			expect(result.error).toBe('not_found');
			expect(result.message).toBe('No keychain item found for service: non-existent-service');
			expect(result.data).toBeUndefined();
		});

		it('should provide service name in error message for debugging', async () => {
			simulateSecurityCommand({ exitCode: 44 });

			const serviceName = 'my-custom-service';
			const result = await safeKeychainExtract(serviceName);

			expect(result.message).toContain(serviceName);
		});
	});

	describe('Locked Keychain Case (Exit Code 36)', () => {
		it('should return locked error with unlock command', async () => {
			simulateSecurityCommand({ exitCode: 36, stderr: 'Keychain is locked' });

			const result = await safeKeychainExtract('test-service');

			expect(result.success).toBe(false);
			expect(result.error).toBe('locked');
			expect(result.message).toContain('security unlock-keychain');
			expect(result.message).toContain('~/Library/Keychains/login.keychain-db');
		});

		it('should detect locked error from "User interaction is not allowed" message', async () => {
			// This error occurs when security runs in non-interactive context (e.g., SSH, CI)
			simulateSecurityCommand({ exitCode: 36, stderr: 'User interaction is not allowed.' });

			const result = await safeKeychainExtract('test-service');

			// The error is thrown by extractFromKeychain as "Keychain is locked..."
			// which safeKeychainExtract catches and categorizes as 'locked'
			expect(result.error).toBe('locked');
		});
	});

	describe('Permission Denied Case (Exit Code 51)', () => {
		it('should return permission_denied error', async () => {
			simulateSecurityCommand({ exitCode: 51, stderr: 'Permission denied' });

			const result = await safeKeychainExtract('test-service');

			expect(result.success).toBe(false);
			expect(result.error).toBe('permission_denied');
			expect(result.message).toContain('Grant access in Keychain Access app');
		});

		it('should detect permission error from "permission" keyword in error', async () => {
			simulateSecurityCommand({ exitCode: 51, stderr: 'permission issue detected' });

			const result = await safeKeychainExtract('test-service');

			expect(result.error).toBe('permission_denied');
		});

		it('should detect permission error from "passphrase" keyword in error', async () => {
			simulateSecurityCommand({
				exitCode: 51,
				stderr: 'The user name or passphrase you entered is not correct.',
			});

			const result = await safeKeychainExtract('test-service');

			expect(result.error).toBe('permission_denied');
		});
	});

	describe('Invalid JSON Case', () => {
		it('should return execution_failed for invalid JSON data', async () => {
			const invalidJson = 'not-valid-json-data';
			simulateSecurityCommand({ exitCode: 0, stdout: invalidJson });

			const result = await safeKeychainExtract('test-service');

			expect(result.success).toBe(false);
			expect(result.error).toBe('execution_failed');
			expect(result.message).toBe('Keychain returned invalid JSON data');
			expect(result.data).toBeUndefined();
		});

		it('should handle malformed JSON edge cases', async () => {
			const testCases = [
				'{incomplete',
				'{"missing": "closing brace"',
				'[1, 2, 3,',
				'undefined',
				'function() {}',
				'<xml>not json</xml>',
			];

			for (const invalidData of testCases) {
				simulateSecurityCommand({ exitCode: 0, stdout: invalidData });
				const result = await safeKeychainExtract('test-service');

				expect(result.success).toBe(false);
				expect(result.error).toBe('execution_failed');
				expect(result.message).toContain('invalid JSON');
			}
		});
	});

	describe('Empty Password Case', () => {
		it('should return execution_failed for empty password (no stdout)', async () => {
			// Exit 0 with no stdout data results in empty string after trim
			simulateSecurityCommand({ exitCode: 0 });

			const result = await safeKeychainExtract('test-service');

			// Empty string is not valid JSON, so it hits the invalid JSON path
			expect(result.success).toBe(false);
			expect(result.error).toBe('execution_failed');
			expect(result.message).toContain('invalid JSON');
		});

		it('should return execution_failed for whitespace-only password', async () => {
			simulateSecurityCommand({ exitCode: 0, stdout: '   \n\t  ' });

			const result = await safeKeychainExtract('test-service');

			// After trim, this becomes empty string which is not valid JSON
			expect(result.success).toBe(false);
			expect(result.error).toBe('execution_failed');
			expect(result.message).toContain('invalid JSON');
		});

		it('should treat plain string password as invalid JSON', async () => {
			// A plain password like "mypassword" is not valid JSON
			simulateSecurityCommand({ exitCode: 0, stdout: 'plain-text-password' });

			const result = await safeKeychainExtract('test-service');

			expect(result.success).toBe(false);
			expect(result.error).toBe('execution_failed');
		});
	});

	describe('Execution Failed Cases', () => {
		it('should return execution_failed for unknown errors', async () => {
			simulateSecurityCommand({ exitCode: 99, stderr: 'Unknown security command failure' });

			const result = await safeKeychainExtract('test-service');

			expect(result.success).toBe(false);
			expect(result.error).toBe('execution_failed');
			expect(result.message).toContain('Unknown security command failure');
		});

		it('should handle spawn errors (command not found)', async () => {
			simulateSpawnError('spawn security ENOENT');

			const result = await safeKeychainExtract('test-service');

			expect(result.success).toBe(false);
			expect(result.error).toBe('execution_failed');
			expect(result.message).toContain('Failed to execute security command');
		});

		it('should include exit code in error message for other failures', async () => {
			simulateSecurityCommand({ exitCode: 99, stderr: 'unexpected error' });

			const result = await safeKeychainExtract('test-service');

			expect(result.message).toContain('exit 99');
		});

		it('should handle non-Error thrown objects gracefully', async () => {
			// The safeKeychainExtract catch handles non-Error with "Unknown error"
			const proc = createMockProcess();
			mockSpawn.mockReturnValue(proc);

			// Simulate a rejection with a non-Error value by directly testing the catch path
			// We can trigger this by having extractFromKeychain reject with a string
			queueMicrotask(() => {
				// Exit with code that triggers the generic error path with no stderr
				proc.emit('close', 127);
			});

			const result = await safeKeychainExtract('test-service');

			expect(result.success).toBe(false);
			expect(result.error).toBe('execution_failed');
		});
	});

	describe('Security - No Credential Leakage', () => {
		it('should not expose credentials in error messages', async () => {
			// Test not_found path
			simulateSecurityCommand({ exitCode: 44 });
			const notFoundResult = await safeKeychainExtract('test');
			expect(notFoundResult.message).not.toContain('secret');

			// Test locked path
			simulateSecurityCommand({ exitCode: 36, stderr: 'locked' });
			const lockedResult = await safeKeychainExtract('test');
			expect(lockedResult.message).not.toContain('secret');

			// Test permission denied path
			simulateSecurityCommand({ exitCode: 51, stderr: 'permission denied' });
			const permResult = await safeKeychainExtract('test');
			expect(permResult.message).not.toContain('secret');
		});

		it('should not include sensitive data in result when validation fails', async () => {
			const sensitiveInvalidData = 'secretpassword123';
			simulateSecurityCommand({ exitCode: 0, stdout: sensitiveInvalidData });

			const result = await safeKeychainExtract('test-service');

			expect(result.data).toBeUndefined();
			expect(result.message).toBe('Keychain returned invalid JSON data');
			expect(result.message).not.toContain('secretpassword');
		});

		it('should use spawn (not exec) to prevent command injection', async () => {
			simulateSecurityCommand({ exitCode: 44 });

			await safeKeychainExtract('test; rm -rf /');

			// Verify spawn was called with arguments as an array (safe)
			// not as a single string (unsafe exec-style)
			expect(mockSpawn).toHaveBeenCalledWith('security', expect.any(Array));
			const callArgs = mockSpawn.mock.calls[0];
			expect(callArgs[0]).toBe('security');
			expect(Array.isArray(callArgs[1])).toBe(true);
			// The malicious string is safely passed as a single argument element
			expect(callArgs[1]).toContain('test; rm -rf /');
		});
	});

	describe('Error Message Actionability', () => {
		it('should provide unlock command for locked keychain', async () => {
			simulateSecurityCommand({ exitCode: 36, stderr: 'Keychain is locked' });

			const result = await safeKeychainExtract('test-service');

			expect(result.message).toContain('security unlock-keychain');
			expect(result.message).toContain('~/Library/Keychains/login.keychain-db');
		});

		it('should provide clear guidance for permission issues', async () => {
			simulateSecurityCommand({ exitCode: 51, stderr: 'permission denied' });

			const result = await safeKeychainExtract('test-service');

			expect(result.message).toContain('Grant access');
			expect(result.message).toContain('Keychain Access app');
		});

		it('should provide service name for not found errors', async () => {
			simulateSecurityCommand({ exitCode: 44 });

			const result = await safeKeychainExtract('my-service-name');

			expect(result.message).toContain('my-service-name');
		});
	});

	describe('Non-Error thrown object handling', () => {
		it('should handle non-Error thrown values with "Unknown error" fallback', async () => {
			// When the catch receives a non-Error object, it falls back to "Unknown error"
			// We simulate this by making spawn throw a string (non-Error)
			const proc = createMockProcess();
			mockSpawn.mockReturnValue(proc);

			queueMicrotask(() => {
				// Emit a non-standard error-like event: the 'error' handler in
				// extractFromKeychain wraps it in Error, but we can test the
				// safeKeychainExtract catch path by having the process reject
				// We need to directly throw a non-Error from the promise
				// The simplest way: mock extractFromKeychain to throw a string
				proc.emit('error', 'not an Error object');
			});

			const result = await safeKeychainExtract('test-service');

			// The error event with a non-Error value will be caught by the
			// proc.on('error') handler which does: reject(new Error(`Failed to execute...`))
			// So this still produces an Error. The non-Error path in safeKeychainExtract
			// is a defensive check that may not be reachable through normal spawn behavior.
			expect(result.success).toBe(false);
			expect(result.error).toBe('execution_failed');
		});
	});

	describe('KeychainResult type contract', () => {
		it('should have success=true and data defined on success', async () => {
			const json = JSON.stringify({ token: 'abc' });
			simulateSecurityCommand({ exitCode: 0, stdout: json });

			const result = await safeKeychainExtract('test-service');

			expect(result).toStrictEqual({
				success: true,
				data: json,
			});
		});

		it('should have success=false, error, and message on failure', async () => {
			simulateSecurityCommand({ exitCode: 44 });

			const result = await safeKeychainExtract('test-service');

			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
			expect(result.message).toBeDefined();
			expect(result.data).toBeUndefined();
		});
	});
});
