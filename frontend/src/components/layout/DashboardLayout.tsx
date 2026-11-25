import React, { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BadgeCheck,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  KeyRound,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Scissors,
  Settings,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/useToast";

export const DashboardLayout: React.FC = () => {
  const { user, profile, logout } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement>(null);

  const isAdmin = profile?.role === "admin";

  // Cerrar popover de configuración al hacer clic fuera o pulsar Escape
  useEffect(() => {
    if (!settingsMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        settingsMenuRef.current &&
        !settingsMenuRef.current.contains(event.target as Node)
      ) {
        setSettingsMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [settingsMenuOpen]);

  // Lista principal de gestión en el sidebar (Perfil y Usuarios ahora van en Settings Popover)
  const managementItems = [
    { to: "/dashboard", label: "Resumen & Pendientes", icon: LayoutDashboard, end: true },
    { to: "/dashboard/orders", label: "Pedidos y Ventas", icon: ClipboardList, end: false },
    { to: "/dashboard/materials", label: "Catálogo Materiales", icon: Layers, end: false },
  ];

  const prepressItems = [
    {
      to: "/dashboard/image-enhancer",
      label: "Mejora de Imagen",
      icon: Sparkles,
      isActiveMatch: () => location.pathname === "/dashboard/image-enhancer",
    },
    {
      to: "/dashboard/die-cut",
      label: "Troquelado Vectorial",
      icon: Scissors,
      isActiveMatch: () =>
        location.pathname === "/dashboard/die-cut" &&
        !location.search.includes("modo=pliego"),
    },
  ];

  const handleLogout = async () => {
    await logout();
    pushToast({ title: "Sesión cerrada", variant: "info" });
    navigate("/login");
  };

  const displayName = profile?.display_name || user?.displayName || "Operador Taller";
  const userInitial = (displayName || user?.email || "A").slice(0, 1).toUpperCase();

  return (
    <div className="min-h-screen bg-surface-canvas bg-print-grid">
      {/* Desktop Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line-subtle bg-surface-card lg:flex">
        <div className="flex h-16 items-center border-b border-line-subtle px-5">
          <Link to="/dashboard">
            <BrandLogo showTagline />
          </Link>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3.5 py-5">
          <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-ink-muted">
            Gestión & Seguridad
          </p>
          {managementItems.map((item) => {
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

          <div className="pt-4">
            <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-ink-muted">
              Estudio de Preprensa
            </p>
            <div className="space-y-1">
              {prepressItems.map((item) => {
                const Icon = item.icon;
                const active = item.isActiveMatch();
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
                      active
                        ? "bg-accent text-accent-ink shadow-sm"
                        : "text-ink-secondary hover:bg-surface-elevated hover:text-ink-primary"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>

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
        </nav>

        <div ref={settingsMenuRef} className="relative border-t border-line-subtle p-4">
          {/* Popover menú de configuración (Settings) */}
          {settingsMenuOpen && (
            <div className="absolute bottom-[calc(100%+0.5rem)] left-3 right-3 z-40 animate-in fade-in zoom-in-95 duration-fast rounded-xl border border-line-strong bg-surface-card p-2 shadow-elevated">
              <div className="mb-1.5 flex items-center justify-between border-b border-line-subtle px-2.5 pb-2 pt-1">
                <span className="font-display text-[10px] font-extrabold uppercase tracking-widest text-ink-muted">
                  Configuración
                </span>
                <button
                  type="button"
                  onClick={() => setSettingsMenuOpen(false)}
                  className="rounded p-1 text-ink-muted hover:bg-surface-elevated hover:text-ink-primary"
                  aria-label="Cerrar menú"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>

              <div className="space-y-1">
                <Link
                  to="/dashboard/profile"
                  onClick={() => setSettingsMenuOpen(false)}
                  className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors ${
                    location.pathname === "/dashboard/profile"
                      ? "bg-accent text-accent-ink"
                      : "text-ink-secondary hover:bg-surface-elevated hover:text-ink-primary"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <KeyRound className="h-4 w-4 shrink-0 text-accent" />
                    <span>Mi Perfil y Seguridad</span>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 opacity-60" />
                </Link>

                {isAdmin && (
                  <Link
                    to="/dashboard/users"
                    onClick={() => setSettingsMenuOpen(false)}
                    className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors ${
                      location.pathname === "/dashboard/users"
                        ? "bg-accent text-accent-ink"
                        : "text-ink-secondary hover:bg-surface-elevated hover:text-ink-primary"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Users className="h-4 w-4 shrink-0 text-accent" />
                      <span>Gestión de Usuarios</span>
                    </div>
                    <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-accent">
                      Admin
                    </span>
                  </Link>
                )}
              </div>

              <div className="mt-2 flex items-center justify-between border-t border-line-subtle px-2.5 pt-2">
                <span className="text-[11px] font-medium text-ink-muted">Tema visual</span>
                <ThemeToggle />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <div className="sticker-badge flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-extrabold text-accent-ink">
                {userInitial}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <p className="truncate text-xs font-bold text-ink-primary">{displayName}</p>
                  {user?.emailVerified && (
                    <BadgeCheck
                      className="h-3.5 w-3.5 shrink-0 text-accent"
                      aria-label="Correo verificado"
                    />
                  )}
                </div>
                <p className="truncate text-[11px] text-ink-muted">{user?.email}</p>
                {profile && (
                  <span className="mt-0.5 inline-block rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-accent">
                    {profile.role_name}
                  </span>
                )}
              </div>
            </div>

            {/* Botón de Engranaje (Settings) junto al perfil */}
            <button
              type="button"
              onClick={() => setSettingsMenuOpen((prev) => !prev)}
              aria-label="Configuración de cuenta y sistema"
              aria-expanded={settingsMenuOpen}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all duration-fast ${
                settingsMenuOpen
                  ? "border-line-diecut bg-accent text-accent-ink shadow-xs"
                  : "border-line-subtle bg-surface-elevated text-ink-secondary hover:border-line-strong hover:text-ink-primary"
              }`}
            >
              <Settings className={`h-4 w-4 transition-transform duration-fast ${settingsMenuOpen ? "rotate-45" : ""}`} />
            </button>
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
            <span>Panel Interno Seguro · BD Relacional + Firebase Auth</span>
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
              <p className="px-2 pt-1 text-[10px] font-bold uppercase tracking-widest text-ink-muted">
                Gestión & Seguridad
              </p>
              {managementItems.map((item) => {
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

              <p className="px-2 pt-2 text-[10px] font-bold uppercase tracking-widest text-ink-muted">
                Configuración & Perfil
              </p>
              <NavLink
                to="/dashboard/profile"
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-semibold ${
                    isActive
                      ? "bg-accent text-accent-ink"
                      : "text-ink-secondary hover:bg-surface-elevated"
                  }`
                }
              >
                <KeyRound className="h-4 w-4" />
                <span>Mi Perfil y Seguridad</span>
              </NavLink>

              {isAdmin && (
                <NavLink
                  to="/dashboard/users"
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center justify-between rounded-md px-3 py-2 text-sm font-semibold ${
                      isActive
                        ? "bg-accent text-accent-ink"
                        : "text-ink-secondary hover:bg-surface-elevated"
                    }`
                  }
                >
                  <div className="flex items-center gap-2.5">
                    <Users className="h-4 w-4" />
                    <span>Gestión de Usuarios</span>
                  </div>
                  <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-accent">
                    Admin
                  </span>
                </NavLink>
              )}

              <p className="px-2 pt-2 text-[10px] font-bold uppercase tracking-widest text-ink-muted">
                Estudio de Preprensa
              </p>
              {prepressItems.map((item) => {
                const Icon = item.icon;
                const active = item.isActiveMatch();
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-semibold ${
                      active
                        ? "bg-accent text-accent-ink"
                        : "text-ink-secondary hover:bg-surface-elevated"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}

              <Link
                to="/"
                onClick={() => setMobileMenuOpen(false)}
                className="mt-1 flex items-center justify-between rounded-md border border-dashed border-line-strong px-3 py-2 text-xs font-semibold text-ink-secondary"
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
