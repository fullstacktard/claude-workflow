/**
 * AdminAuthContext
 *
 * Stores the admin Bearer token in sessionStorage.
 * If no token is present, renders a login form (token input).
 * Provides the token to all admin API calls via context.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Lock, LogOut } from "lucide-react";

/* -- Constants ----------------------------------------------------------- */

const SESSION_KEY = "claude-workflow-admin-token";

/* -- Types --------------------------------------------------------------- */

interface AdminAuthContextValue {
  /** The current admin Bearer token */
  token: string;
  /** Clear the token and return to login screen */
  logout: () => void;
}

/* -- Context ------------------------------------------------------------- */

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

/**
 * Hook to access the admin auth context.
 * Must be used inside AdminAuthProvider.
 */
export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (ctx === null) {
    throw new Error("useAdminAuth must be used inside <AdminAuthProvider>");
  }
  return ctx;
}

/* -- Login Form ---------------------------------------------------------- */

function AdminLoginForm({
  onSubmit,
}: {
  onSubmit: (token: string) => void;
}): JSX.Element {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      setError("Token is required");
      return;
    }
    setError("");
    onSubmit(trimmed);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-800 bg-gray-900 p-6">
        {/* Header */}
        <div className="mb-6 flex items-center gap-2">
          <Lock size={18} className="text-red-400" aria-hidden="true" />
          <h1 className="font-mono text-lg font-semibold text-gray-100">
            Admin Panel
          </h1>
        </div>

        <p className="mb-4 font-mono text-xs text-gray-400">
          Enter your admin token to continue.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="admin-token"
              className="mb-1 block font-mono text-xs text-gray-400"
            >
              Admin Token
            </label>
            <input
              id="admin-token"
              type="password"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Enter CLAUDE_WORKFLOW_ADMIN_TOKEN"
              autoComplete="off"
              aria-describedby={error ? "token-error" : undefined}
              aria-invalid={error ? true : undefined}
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-sm text-gray-100 placeholder:text-gray-500 focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-400"
            />
            {error && (
              <p
                id="token-error"
                className="mt-1 font-mono text-xs text-red-400"
                role="alert"
              >
                {error}
              </p>
            )}
          </div>

          <button
            type="submit"
            className="w-full rounded-md bg-red-900/40 px-4 py-2 font-mono text-sm font-medium text-red-400 transition-colors hover:bg-red-900/60 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-gray-900"
          >
            Authenticate
          </button>
        </form>
      </div>
    </div>
  );
}

/* -- Provider ------------------------------------------------------------ */

/**
 * AdminAuthProvider wraps admin routes.
 * If no token exists in sessionStorage, shows the login form.
 * Once authenticated, provides the token via context.
 */
export function AdminAuthProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [token, setToken] = useState<string | null>(() => {
    return sessionStorage.getItem(SESSION_KEY);
  });

  const handleLogin = useCallback((newToken: string): void => {
    sessionStorage.setItem(SESSION_KEY, newToken);
    setToken(newToken);
  }, []);

  const handleLogout = useCallback((): void => {
    sessionStorage.removeItem(SESSION_KEY);
    setToken(null);
  }, []);

  const contextValue = useMemo<AdminAuthContextValue | null>(() => {
    if (token === null) return null;
    return { token, logout: handleLogout };
  }, [token, handleLogout]);

  // No token -- show login form
  if (token === null || contextValue === null) {
    return <AdminLoginForm onSubmit={handleLogin} />;
  }

  return (
    <AdminAuthContext.Provider value={contextValue}>
      {children}
    </AdminAuthContext.Provider>
  );
}

/**
 * AdminLogoutButton renders a small logout button for the sidebar.
 */
export function AdminLogoutButton(): JSX.Element {
  const { logout } = useAdminAuth();

  return (
    <button
      type="button"
      onClick={logout}
      className="flex items-center gap-2 rounded-md px-3 py-2 font-mono text-xs text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
      aria-label="Log out of admin panel"
    >
      <LogOut size={14} aria-hidden="true" />
      <span>Logout</span>
    </button>
  );
}
