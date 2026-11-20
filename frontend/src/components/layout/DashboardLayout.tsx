import React, { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  ClipboardList,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Menu,
  Sparkles,
  X,
} from "lucide-react";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/useToast";

const navItems = [
  { to: "/dashboard", label: "Resumen & Pendientes", icon: LayoutDashboard, end: true },
  { to: "/dashboard/orders", label: "Pedidos y Ventas", icon: ClipboardList, end: false },
];

export const DashboardLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    pushToast({ title: "Sesión cerrada", variant: "info" });
    navigate("/login");
  };

  const userInitial = (user?.displayName || user?.email || "A").slice(0, 1).toUpperCase();

  return (
    <div className="min-h-screen bg-surface-canvas bg-print-grid">
      {/* Desktop Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line-subtle bg-surface-card lg:flex">
        <div className="flex h-16 items-center border-b border-line-subtle px-5">
          <Link to="/dashboard">
            <BrandLogo showTagline />
          </Link>
        </div>

        <nav className="flex-1 space-y-1.5 px-3.5 py-5">
          <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-ink-muted">
            Operación Fase 1
          </p>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
                    isActive
                      ? "bg-accent text-accent-ink shadow-sm"
                      : "text-ink-secondary hover:bg-surface-elevated hover:text-ink-primary"
                  }`
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}

          <div className="pt-5">
            <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-widest text-ink-muted">
              Portal Clientes
            </p>
            <Link
              to="/"
              className="flex items-center justify-between rounded-lg border border-dashed border-line-strong px-3 py-2.5 text-xs font-semibold text-ink-secondary transition-colors hover:border-line-diecut hover:text-ink-primary"
            >
              <span>Ver Portal Público</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="pt-5">
            <div className="rounded-lg border border-dashed border-line-diecut/60 bg-surface-elevated/70 p-3.5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-ink-primary">
                <Sparkles className="h-3.5 w-3.5 text-accent" />
                <span>Fase 2 Preparada</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                Arquitectura lista para OpenCV, troquelado IA y distribución automática en pliego.
              </p>
            </div>
          </div>
        </nav>

        <div className="border-t border-line-subtle p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-700 text-xs font-bold text-white dark:bg-brand-400 dark:text-brand-950">
              {userInitial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold text-ink-primary">
                {user?.displayName || "Operador Taller"}
              </p>
              <p className="truncate text-[11px] text-ink-muted">{user?.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-line-subtle bg-surface-elevated px-3 py-2 text-xs font-semibold text-ink-secondary transition-colors hover:border-line-strong hover:text-ink-primary"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-line-subtle bg-surface-canvas/90 px-4 backdrop-blur-md sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 lg:hidden">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Abrir menú"
              className="rounded-md border border-line-subtle bg-surface-card p-2 text-ink-primary"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <BrandLogo compact />
          </div>

          <div className="hidden items-center gap-2 text-xs font-medium text-ink-muted lg:flex">
            <span className="inline-block h-2 w-2 rounded-full bg-accent" />
            <span>Panel Interno Seguro · JWT Verificado</span>
          </div>

          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 rounded-full border border-line-subtle bg-surface-card px-3 py-1.5 text-xs font-semibold text-ink-secondary hover:text-ink-primary lg:hidden"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Salir</span>
            </button>
          </div>
        </header>

        {/* Mobile Drawer Nav */}
        {mobileMenuOpen && (
          <div className="border-b border-line-subtle bg-surface-card px-4 py-3 lg:hidden">
            <nav className="flex flex-col gap-1.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-semibold ${
                        isActive
                          ? "bg-accent text-accent-ink"
                          : "text-ink-secondary hover:bg-surface-elevated"
                      }`
                    }
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
              <Link
                to="/"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center justify-between rounded-md border border-dashed border-line-strong px-3 py-2 text-xs font-semibold text-ink-secondary"
              >
                <span>Ir al Portal Público</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </nav>
          </div>
        )}

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
