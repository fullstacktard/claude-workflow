/**
 * Navigation Component
 * Header navigation for dashboard pages with mobile hamburger menu
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";

interface NavLinkProps {
  to: string;
  label: string;
  isActive: boolean;
  onClick?: () => void;
  className?: string;
}

function NavLink({ to, label, isActive, onClick, className = "" }: NavLinkProps): JSX.Element {
  const navLinkBase = "px-3 py-2 text-gray-400 hover:text-red-400 transition-colors";
  const navLinkActive = "text-red-400 border-b-2 border-red-400";

  return (
    <Link
      to={to}
      onClick={onClick}
      className={`${navLinkBase} ${isActive ? navLinkActive : ""} ${className}`}
    >
      {label}
    </Link>
  );
}

interface MobileMenuOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

function MobileMenuOverlay({ isOpen, onClose, children }: MobileMenuOverlayProps): JSX.Element | null {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 md:hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Menu panel */}
      <div className="fixed top-0 right-0 h-full w-64 bg-gray-900 border-l border-red-800 animate-slide-in-right">
        <div className="flex items-center justify-between h-14 px-4 border-b border-red-800">
          <span className="text-red-400 font-semibold">Menu</span>
          <button
            onClick={onClose}
            className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-400 hover:text-red-400 transition-colors"
            aria-label="Close menu"
          >
            <X size={24} />
          </button>
        </div>
        <nav className="flex flex-col p-4 gap-2" role="navigation" aria-label="Mobile navigation">
          {children}
        </nav>
      </div>
    </div>,
    document.body
  );
}

/**
 * Navigation component with mobile hamburger menu
 */
export function Navigation(): JSX.Element {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  const navLinks = [
    { to: "/", label: "Home" },
    { to: "/claude-proxy/config", label: "Claude Proxy Config" },
    { to: "/visualization", label: "3D Visualization" },
    { to: "/content-calendar", label: "Calendar" },
  ];

  return (
    <nav className="bg-gray-900 border-b border-red-800">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          <Link
            to="/"
            className="text-red-400 font-semibold text-lg"
          >
            Dashboard
          </Link>

          {/* Desktop nav links */}
          <div className="hidden md:flex ml-8 gap-4">
            {navLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                label={link.label}
                isActive={location.pathname === link.to}
              />
            ))}
          </div>

          {/* Mobile hamburger button */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="md:hidden p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-400 hover:text-red-400 transition-colors"
            aria-label="Open menu"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-menu"
          >
            <Menu size={24} />
          </button>
        </div>
      </div>

      {/* Mobile menu overlay */}
      <MobileMenuOverlay isOpen={mobileMenuOpen} onClose={closeMobileMenu}>
        {navLinks.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            label={link.label}
            isActive={location.pathname === link.to}
            onClick={closeMobileMenu}
            className="min-h-[44px] flex items-center"
          />
        ))}
      </MobileMenuOverlay>
    </nav>
  );
}
