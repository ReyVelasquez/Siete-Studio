import React, { useCallback, useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { Layers, Pencil, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-primary">
            Catálogo de Materiales (CRUD Relacional)
          </h1>
          <p className="mt-0.5 text-xs text-ink-muted">
            Tabla normalizada <code className="font-mono">materials</code> con restricciones{" "}
            <code className="font-mono">UNIQUE</code>, <code className="font-mono">CHECK</code> y{" "}
            <code className="font-mono">ON DELETE RESTRICT</code>.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadMaterials()}
            loading={loading}
            leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
          >
            Refrescar
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={openCreate}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            Nuevo Material
          </Button>
        </div>
      </div>

      <StickerCard padding="sm" className="flex items-center gap-2.5 text-xs text-ink-secondary">
        <ShieldCheck className="h-4 w-4 shrink-0 text-accent" />
        <span>
          Los materiales que ya tienen pedidos asociados están protegidos por llave foránea (
          <code className="font-mono">ON DELETE RESTRICT</code>) para impedir registros huérfanos.
        </span>
      </StickerCard>

      <div className="overflow-hidden rounded-sticker border border-line-subtle bg-surface-card shadow-card">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-line-subtle text-left text-xs">
            <thead className="bg-surface-elevated/80 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
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
                  <td colSpan={6} className="px-4 py-10 text-center text-ink-muted">
                    Cargando catálogo...
                  </td>
                </tr>
              ) : materials.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-ink-muted">
                    <Layers className="mx-auto mb-2 h-6 w-6 opacity-60" />
                    No hay materiales registrados.
                  </td>
                </tr>
              ) : (
                materials.map((item) => (
                  <tr key={item.id} className="hover:bg-surface-elevated/50">
                    <td className="px-4 py-3.5">
                      <p className="font-bold text-ink-primary">{item.name}</p>
                      {item.description && (
                        <p className="mt-0.5 max-w-md text-[11px] text-ink-muted">
                          {item.description}
                        </p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 font-mono text-[11px] text-ink-secondary">
                      {item.requires_gloss_mode ? "Requiere modalidad" : "Estándar"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right font-mono font-bold text-ink-primary">
                      {formatCurrency(item.base_unit_price)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right font-mono font-bold text-accent">
                      {item.orders_count}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-bold ${
                          item.is_active
                            ? "border-accent bg-accent-soft text-accent"
                            : "border-line-strong bg-surface-elevated text-ink-muted"
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
                          variant="secondary"
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
      </div>

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
              placeholder="Características técnicas del sustrato..."
              className="w-full rounded-md border border-line-subtle bg-surface-card px-3.5 py-2.5 text-sm text-ink-primary placeholder:text-ink-muted focus:border-line-diecut focus:outline-none"
              {...register("description")}
            />
            {errors.description && (
              <p className="text-xs font-semibold text-brand-800 dark:text-brand-200">
                • {errors.description.message}
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

          <div className="space-y-2 rounded-lg bg-surface-elevated/70 p-3.5 text-xs">
            <label className="flex items-center gap-2 font-medium text-ink-primary">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-line-strong"
                {...register("requires_gloss_mode")}
              />
              Exigir modalidad condicional (En rollo / Corte uno a uno)
            </label>
            <label className="flex items-center gap-2 font-medium text-ink-primary">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-line-strong"
                {...register("is_active")}
              />
              Material activo para nuevos pedidos
            </label>
          </div>

          {formError && (
            <div
              role="alert"
              className="rounded-lg border border-brand-800 bg-brand-950 px-3.5 py-2.5 text-xs font-medium text-brand-50 dark:border-brand-300 dark:bg-brand-900"
            >
              {formError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
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
          <p>
            ¿Deseas eliminar el material <strong className="text-ink-primary">{deleting?.name}</strong>?
            {deleting && deleting.orders_count > 0 ? (
              <>
                {" "}
                Actualmente tiene{" "}
                <strong className="font-mono text-ink-primary">
                  {deleting.orders_count} pedido(s)
                </strong>{" "}
                vinculados; el servidor bloqueará la eliminación para preservar la integridad referencial.
              </>
            ) : (
              " Esta acción eliminará el registro de la base de datos."
            )}
          </p>
          <div className="flex justify-end gap-2">
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
