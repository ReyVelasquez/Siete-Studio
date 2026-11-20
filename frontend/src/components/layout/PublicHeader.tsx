import React from "react";
import { Link } from "react-router-dom";
import { LayoutDashboard, Lock } from "lucide-react";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";

export const PublicHeader: React.FC = () => {
  const { user } = useAuth();

  return (
    <header className="sticky top-0 z-30 border-b border-line-subtle bg-surface-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/" aria-label="Inicio">
          <BrandLogo showTagline />
        </Link>

        <div className="flex items-center gap-2.5 sm:gap-3">
          <ThemeToggle />
          <Link
            to={user ? "/dashboard" : "/login"}
            className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface-card px-3.5 py-1.5 text-xs font-semibold text-ink-primary shadow-sm transition-colors hover:border-line-diecut hover:bg-surface-elevated"
          >
            {user ? (
              <>
                <LayoutDashboard className="h-3.5 w-3.5" />
                <span>Ir al Panel</span>
              </>
            ) : (
              <>
                <Lock className="h-3.5 w-3.5" />
                <span>Acceso Taller</span>
              </>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
};
