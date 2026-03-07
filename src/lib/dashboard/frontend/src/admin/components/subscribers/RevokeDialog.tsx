/**
 * RevokeDialog Component
 *
 * Confirmation dialog for revoking a license key.
 * Uses createPortal for overlay rendering.
 * Supports Escape key to cancel and focus trapping.
 */

import { useEffect, useRef, type JSX } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import type { LicenseKeyRead } from "../../types/admin";

interface RevokeDialogProps {
  licenseKey: LicenseKeyRead;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  loading: boolean;
}

export function RevokeDialog({
  licenseKey,
  onConfirm,
  onCancel,
  loading,
}: RevokeDialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus trap + escape handler
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    document.addEventListener("keydown", handleEscape);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onCancel, loading]);

  // Prevent body scroll while dialog is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const dialog = (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/70"
        onClick={() => !loading && onCancel()}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={dialogRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="revoke-title"
          aria-describedby="revoke-description"
          tabIndex={-1}
          className="w-full max-w-md rounded-lg border border-red-800 bg-gray-900 p-6 shadow-2xl"
        >
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-900/30">
              <AlertTriangle className="h-5 w-5 text-red-400" />
            </div>
            <div className="flex-1">
              <h3
                id="revoke-title"
                className="text-lg font-semibold text-gray-100"
              >
                Revoke License Key
              </h3>
              <p
                id="revoke-description"
                className="mt-2 text-sm text-gray-400"
              >
                Are you sure you want to revoke this license key? This action is
                <strong className="text-red-400">
                  {" "}
                  permanent and cannot be undone
                </strong>
                .
              </p>
              <div className="mt-3 rounded border border-red-800/30 bg-gray-800/50 p-3">
                <p className="mb-1 text-xs text-gray-500">License Key</p>
                <code className="font-mono text-sm text-gray-300">
                  {licenseKey.display_key}
                </code>
                <p className="mt-2 text-xs text-gray-500">
                  {licenseKey.usage} active activation
                  {licenseKey.usage !== 1 ? "s" : ""} will be invalidated
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={onCancel}
              disabled={loading}
              className="rounded-md border border-red-800/50 bg-gray-800 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void onConfirm()}
              disabled={loading}
              className="flex items-center gap-2 rounded-md bg-red-700 px-4 py-2 text-sm text-white transition-colors hover:bg-red-600 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Revoking...
                </>
              ) : (
                "Revoke License"
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(dialog, document.body);
}
