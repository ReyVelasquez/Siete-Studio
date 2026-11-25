import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, LayoutDashboard, Lock } from "lucide-react";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";

export const PublicHeader: React.FC = () => {
  const { user } = useAuth();

  return (
    <header className="sticky top-0 z-30 border-b border-line-subtle bg-surface-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link
          to="/"
          aria-label="Inicio"
          className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas"
        >
          <BrandLogo showTagline />
        </Link>

        <div className="flex items-center gap-2.5 sm:gap-3">
          <ThemeToggle />
          <Link
            to={user ? "/dashboard" : "/login"}
            className="group inline-flex h-9 items-center gap-2 rounded-full border border-line-strong bg-surface-card px-3.5 text-xs font-semibold text-ink-primary shadow-xs transition-all duration-fast ease-studio hover:-translate-y-px hover:border-line-diecut hover:bg-accent-soft/60 hover:shadow-sticker focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas active:scale-[0.98]"
          >
            {user ? (
              <>
                <LayoutDashboard className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                <span>Ir al Panel</span>
                <ArrowRight
                  className="h-3 w-3 text-ink-muted transition-transform duration-fast ease-studio group-hover:translate-x-0.5 group-hover:text-accent"
                  aria-hidden="true"
                />
              </>
            ) : (
              <>
                <Lock className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                <span>Acceso Taller</span>
              </>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
};
