/**
 * Ed25519 public key for license JWT verification.
 *
 * This key is embedded in the npm package and used for offline JWT validation.
 * The corresponding private key is stored server-side and used to sign license JWTs.
 *
 * Key type: Ed25519 (EdDSA)
 * Format: SPKI PEM
 *
 * To generate a new keypair (one-time server setup):
 *   import { generateKeyPair, exportSPKI, exportPKCS8 } from 'jose';
 *   const { publicKey, privateKey } = await generateKeyPair('EdDSA', { extractable: true });
 *   console.log(await exportSPKI(publicKey));   // embed this here
 *   console.log(await exportPKCS8(privateKey));  // store this server-side ONLY
 */
export const LICENSE_PUBLIC_KEY_SPKI = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEADvYnfrl+/FQbzz3pg/kfk+y+2UrcliRxq7wMmuhxMhE=
-----END PUBLIC KEY-----`;

/**
 * JWT issuer identifier. Must match server-side signing configuration.
 */
export const LICENSE_ISSUER = "claude-workflow";

/**
 * JWT algorithm. Ed25519 uses the EdDSA identifier in JOSE.
 */
export const LICENSE_ALGORITHM = "EdDSA" as const;
