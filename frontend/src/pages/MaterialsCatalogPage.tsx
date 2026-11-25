import React, { useCallback, useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  Clock,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Scissors,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { pageTransitionVariants } from "@/config/animations";
import { THEME_CONFIG, formatCurrency } from "@/config/theme.config";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StickerCard } from "@/components/ui/StickerCard";
import { useToast } from "@/hooks/useToast";
import { materialSchema, type MaterialFormValues } from "@/schemas/material.schema";
import { materialsService } from "@/services/materials.service";
import type { MaterialItem } from "@/types/order";

export const MaterialsCatalogPage: React.FC = () => {
  const { pushToast } = useToast();
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MaterialItem | null>(null);
  const [deleting, setDeleting] = useState<MaterialItem | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<MaterialFormValues>({
    resolver: zodResolver(materialSchema),
    defaultValues: {
      name: "",
      description: "",
      requires_gloss_mode: false,
      base_unit_price: 0,
      is_active: true,
    },
  });

  const loadMaterials = useCallback(async () => {
    setLoading(true);
    try {
      const res = await materialsService.listAdminMaterials();
      setMaterials(res.items);
    } catch (err) {
      pushToast({
        title: "Error al cargar materiales",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    void loadMaterials();
  }, [loadMaterials]);

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    reset({
      name: "",
      description: "",
      requires_gloss_mode: false,
      base_unit_price: 1.5,
      is_active: true,
    });
    setModalOpen(true);
  };

  const openEdit = (item: MaterialItem) => {
    setEditing(item);
    setFormError(null);
    reset({
      name: item.name,
      description: item.description ?? "",
      requires_gloss_mode: item.requires_gloss_mode,
      base_unit_price: item.base_unit_price,
      is_active: item.is_active,
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: MaterialFormValues) => {
    setFormError(null);
    try {
      if (editing) {
        await materialsService.updateMaterial(editing.id, {
          name: values.name,
          description: values.description || null,
          requires_gloss_mode: values.requires_gloss_mode,
          base_unit_price: values.base_unit_price,
          is_active: values.is_active,
        });
        pushToast({
          title: `Material "${values.name}" actualizado`,
          variant: "success",
        });
      } else {
        await materialsService.createMaterial({
          name: values.name,
          description: values.description || null,
          requires_gloss_mode: values.requires_gloss_mode,
          base_unit_price: values.base_unit_price,
          is_active: values.is_active,
        });
        pushToast({
          title: `Material "${values.name}" creado`,
          description: "Guardado en la tabla relacional materials.",
          variant: "success",
        });
      }
      setModalOpen(false);
      void loadMaterials();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo guardar el material.";
      setFormError(msg);
      pushToast({ title: "Error de validación / integridad", description: msg, variant: "error" });
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await materialsService.deleteMaterial(deleting.id);
      pushToast({
        title: `Material "${deleting.name}" eliminado`,
        variant: "success",
      });
      setDeleting(null);
      void loadMaterials();
    } catch (err) {
      pushToast({
        title: "Integridad referencial protegida",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
      setDeleting(null);
    } finally {
      setDeletingBusy(false);
    }
  };

  return (
    <motion.div
      variants={pageTransitionVariants}
      initial="initial"
      animate="animate"
      className="space-y-6"
    >
      {/* Band 1: Command Header with Prominent Quick Actions */}
      <StickerCard padding="md" className="bg-print-grid overflow-hidden">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-diecut/75 bg-surface-card px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-accent shadow-xs">
                <Scissors className="h-3 w-3" aria-hidden="true" />
                Sustratos de Impresión · Catálogo
              </span>
              <span className="sticker-badge inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-diecut bg-accent-soft px-2.5 py-0.5 font-mono text-[11px] font-bold tabular-nums text-ink-primary">
                <Layers className="h-3 w-3 text-accent" aria-hidden="true" />
                {materials.length} material(es)
              </span>
            </div>

            <div>
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-primary sm:text-3xl">
                Catálogo de Materiales (CRUD Relacional)
              </h1>
              <p className="mt-1 text-xs text-ink-secondary sm:text-sm">
                Tabla normalizada{" "}
                <code className="rounded-xs bg-surface-elevated px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink-primary">
                  materials
                </code>{" "}
                con restricciones{" "}
                <code className="rounded-xs bg-surface-elevated px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink-primary">
                  UNIQUE
                </code>
                ,{" "}
                <code className="rounded-xs bg-surface-elevated px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink-primary">
                  CHECK
                </code>{" "}
                y{" "}
                <code className="rounded-xs bg-surface-elevated px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink-primary">
                  ON DELETE RESTRICT
                </code>
                .
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 lg:shrink-0">
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={openCreate}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              Nuevo Material
            </Button>

            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => void loadMaterials()}
              loading={loading}
              leftIcon={<RefreshCw className="h-4 w-4" />}
            >
              Refrescar
            </Button>

            <Link
              to="/dashboard/orders?only_pending=true"
              className="group inline-flex h-11 items-center gap-2 rounded-md border border-dashed border-line-diecut/80 bg-surface-card px-3.5 text-xs font-semibold text-ink-primary shadow-xs transition-all duration-fast ease-studio hover:-translate-y-px hover:border-line-diecut hover:bg-accent-soft/60 hover:shadow-sticker focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card"
            >
              <Clock className="h-4 w-4 text-accent" aria-hidden="true" />
              <span>Pendientes</span>
            </Link>
          </div>
        </div>
      </StickerCard>

      {/* Band 2: Referential Integrity Callout */}
      <StickerCard
        dieCut
        registrationMarks
        padding="sm"
        className="flex items-start gap-3 text-xs text-ink-secondary sm:items-center"
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"
        >
          <ShieldCheck className="h-4 w-4" />
        </span>
        <span>
          Los materiales que ya tienen pedidos asociados están protegidos por llave foránea (
          <code className="rounded-xs bg-surface-elevated px-1.5 py-0.5 font-mono font-semibold text-ink-primary">
            ON DELETE RESTRICT
          </code>
          ) para impedir registros huérfanos en producción.
        </span>
      </StickerCard>

      {/* Band 3: Featured Materials Table */}
      <StickerCard tone="featured" padding="none" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-line-subtle text-left text-xs">
            <thead className="border-b border-dashed border-line-subtle bg-surface-elevated/65 text-[11px] font-bold uppercase tracking-wider text-ink-secondary">
              <tr>
                <th className="px-4 py-3.5">Material</th>
                <th className="px-4 py-3.5">Regla Modalidad</th>
                <th className="px-4 py-3.5 text-right">Precio Base</th>
                <th className="px-4 py-3.5 text-right">Pedidos Relacionados</th>
                <th className="px-4 py-3.5">Estado</th>
                <th className="px-4 py-3.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-5">
                    <div className="space-y-2.5">
                      {[1, 2, 3].map((idx) => (
                        <div
                          key={idx}
                          className="h-12 animate-pulse rounded-md bg-surface-elevated/70"
                        />
                      ))}
                    </div>
                  </td>
                </tr>
              ) : materials.length === 0 ? (
                <tr>
                  <td colSpan={6} className="bg-print-grid px-4 py-12 text-center">
                    <div className="sticker-badge mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-line-diecut/70 bg-accent-soft text-accent">
                      <Layers className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <p className="mt-3 text-sm font-bold text-ink-primary">
                      No hay materiales registrados
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      Agrega sustratos como Vinilo Mate, Brillo o DTF UV para habilitar nuevos pedidos.
                    </p>
                    <div className="mt-4">
                      <Button
                        type="button"
                        size="sm"
                        onClick={openCreate}
                        leftIcon={<Plus className="h-3.5 w-3.5" />}
                      >
                        Nuevo Material
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : (
                materials.map((item) => (
                  <tr
                    key={item.id}
                    className={`group transition-colors duration-fast ease-studio hover:bg-surface-elevated/60 ${
                      !item.is_active ? "opacity-75" : ""
                    }`}
                  >
                    <td className="px-4 py-3.5">
                      <div className="flex items-start gap-3">
                        <span
                          aria-hidden="true"
                          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border ${
                            item.is_active
                              ? "border-dashed border-line-diecut/70 bg-accent-soft text-accent"
                              : "border-line-subtle bg-surface-elevated text-ink-muted"
                          }`}
                        >
                          <Layers className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-bold text-ink-primary transition-colors duration-fast ease-studio group-hover:text-accent">
                            {item.name}
                          </p>
                          {item.description && (
                            <p className="mt-0.5 max-w-md text-[11px] leading-relaxed text-ink-muted">
                              {item.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="whitespace-nowrap px-4 py-3.5">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-bold ${
                          item.requires_gloss_mode
                            ? "border-dashed border-line-diecut/70 bg-accent-soft text-accent"
                            : "border-line-subtle bg-surface-elevated text-ink-secondary"
                        }`}
                      >
                        {item.requires_gloss_mode ? "Requiere modalidad" : "Estándar"}
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-4 py-3.5 text-right font-mono font-bold tabular-nums text-ink-primary">
                      {formatCurrency(item.base_unit_price)}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3.5 text-right">
                      <span className="inline-flex rounded-full border border-line-subtle bg-surface-elevated px-2.5 py-0.5 font-mono text-[11px] font-bold tabular-nums text-accent">
                        {item.orders_count}
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-4 py-3.5">
                      <span
                        className={`sticker-badge inline-flex rounded-full border-[1.5px] px-2.5 py-0.5 font-mono text-[10px] font-bold ${
                          item.is_active
                            ? "border-accent bg-accent text-accent-ink"
                            : "border-dotted border-line-strong bg-surface-elevated text-ink-muted"
                        }`}
                      >
                        {item.is_active ? "Activo" : "Inactivo"}
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-4 py-3.5 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="dieCut"
                          onClick={() => openEdit(item)}
                          leftIcon={<Pencil className="h-3.5 w-3.5" />}
                        >
                          Editar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleting(item)}
                          aria-label="Eliminar material"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </StickerCard>

      {/* Create / Edit Material Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Editar Material: ${editing.name}` : "Crear Nuevo Material"}
        subtitle="Validado con Zod en frontend y Pydantic v2 + SQL CHECK/UNIQUE en backend."
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <Input
            label="Nombre del material *"
            placeholder="Ej. Vinilo Holográfico"
            error={errors.name?.message}
            {...register("name")}
          />

          <div className="space-y-1.5">
            <label
              htmlFor="mat-desc"
              className="block text-xs font-semibold uppercase tracking-wider text-ink-secondary"
            >
              Descripción
            </label>
            <textarea
              id="mat-desc"
              rows={3}
              aria-invalid={Boolean(errors.description)}
              placeholder="Características técnicas del sustrato..."
              className={`w-full rounded-md border bg-surface-card px-3.5 py-2.5 text-sm text-ink-primary shadow-xs placeholder:text-ink-muted transition-all duration-fast ease-studio focus:outline-none ${
                errors.description
                  ? "border-state-critical-bg ring-1 ring-state-critical-bg/35 focus:border-state-critical-bg focus:ring-2 focus:ring-state-critical-bg/30"
                  : "border-line-subtle hover:border-line-strong focus:border-line-diecut focus:ring-2 focus:ring-ring/25"
              }`}
              {...register("description")}
            />
            {errors.description && (
              <p
                role="alert"
                className="flex items-center gap-1.5 text-xs font-semibold text-ink-primary"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-state-critical-bg text-state-critical-ink"
                >
                  <AlertCircle className="h-3 w-3" />
                </span>
                <span>{errors.description.message}</span>
              </p>
            )}
          </div>

          <Input
            label={`Precio unitario base (${THEME_CONFIG.brand.currencySymbol}) *`}
            type="number"
            step="0.10"
            min="0"
            error={errors.base_unit_price?.message}
            {...register("base_unit_price")}
          />

          <div className="space-y-2.5 rounded-lg border border-line-subtle bg-surface-elevated/55 p-3.5 text-xs">
            <label className="flex cursor-pointer items-center gap-2.5 font-medium text-ink-primary">
              <input
                type="checkbox"
                className="h-4 w-4 rounded-xs border-line-strong accent-accent focus-visible:ring-2 focus-visible:ring-ring"
                {...register("requires_gloss_mode")}
              />
              <span>Exigir modalidad condicional (En rollo / Corte uno a uno)</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2.5 font-medium text-ink-primary">
              <input
                type="checkbox"
                className="h-4 w-4 rounded-xs border-line-strong accent-accent focus-visible:ring-2 focus-visible:ring-ring"
                {...register("is_active")}
              />
              <span>Material activo para nuevos pedidos</span>
            </label>
          </div>

          {formError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-state-critical-bg bg-state-critical-bg px-3.5 py-2.5 text-xs font-semibold text-state-critical-ink"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{formError}</span>
            </div>
          )}

          <div className="flex justify-end gap-2.5 border-t border-dashed border-line-subtle pt-4">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {editing ? "Guardar cambios" : "Crear material"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Confirmar Eliminación de Material"
        maxWidthClass="max-w-md"
      >
        <div className="space-y-4 text-xs leading-relaxed text-ink-secondary">
          <div className="flex items-start gap-3 rounded-lg border border-dashed border-state-critical-bg/70 bg-surface-elevated/60 p-3.5">
            <span
              aria-hidden="true"
              className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-state-critical-bg text-state-critical-ink"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
            </span>
            <p>
              ¿Deseas eliminar el material{" "}
              <strong className="text-ink-primary">{deleting?.name}</strong>?
              {deleting && deleting.orders_count > 0 ? (
                <>
                  {" "}
                  Actualmente tiene{" "}
                  <strong className="font-mono text-ink-primary">
                    {deleting.orders_count} pedido(s)
                  </strong>{" "}
                  vinculados; el servidor bloqueará la eliminación para preservar la integridad
                  referencial.
                </>
              ) : (
                " Esta acción eliminará el registro de la base de datos."
              )}
            </p>
          </div>
          <div className="flex justify-end gap-2.5 border-t border-dashed border-line-subtle pt-4">
            <Button type="button" variant="outline" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="inverted"
              loading={deletingBusy}
              onClick={handleConfirmDelete}
              leftIcon={<Trash2 className="h-4 w-4" />}
            >
              Eliminar material
            </Button>
          </div>
        </div>
      </Modal>
    </motion.div>
  );
};
