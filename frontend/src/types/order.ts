export type StickerMaterial =
  | "Vinilo Brillo"
  | "Vinilo Mate"
  | "Transparente"
  | "DTF UV"
  | "Hojas Adhesivas";

export type VinylGlossMode = "En rollo" | "Corte uno a uno";

export type StickerShape = "Circular" | "Rectangular" | "Cuadrado" | "En su forma";

export type StickerSizeMode = "both" | "height_only" | "width_only";

export type OrderStatus =
  | "Pendiente"
  | "En Diseño"
  | "En Impresión"
  | "Troquelado"
  | "Listo"
  | "Entregado"
  | "Cancelado";

export type PaymentMethod =
  | "Pendiente"
  | "Efectivo"
  | "Transferencia"
  | "QR"
  | "Tarjeta"
  | "Mixto";

export type PrepressStatus =
  | "pendiente"
  | "mejorado"
  | "troquelado"
  | "listo_pliego"
  | "pending"
  | "in_progress"
  | "enhanced"
  | "die_cut_ready"
  | "print_ready"
  | "Pendiente"
  | "En Proceso"
  | "Mejorado"
  | "Troquelado"
  | "Listo";

export type DpiPreflightStatus = "ok" | "warning" | "critical";

export type ArtworkVersion = "original" | "enhanced";

export type PreflightDpiLevel = "optimal" | "warning" | "critical";

export interface PreflightDpiTelemetry {
  effectiveDpi: number;
  effectiveDpiX: number;
  effectiveDpiY: number;
  sourceDpi: number;
  requestedWidthCm: number;
  requestedHeightCm: number;
  outputWidthPx: number;
  outputHeightPx: number;
  level: PreflightDpiLevel;
  recommendedUpscale: 1 | 2 | 4;
  isProjected: boolean;
}

export type BatchEnhanceItemStatus = "pending" | "processing" | "done" | "error";

export interface BatchEnhanceItemProgress {
  itemId: string;
  position: number;
  material: string;
  sizeDisplay: string;
  status: BatchEnhanceItemStatus;
  error?: string;
  processingTimeMs?: number;
}

export interface BatchEnhanceProgress {
  running: boolean;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  currentItemId: string | null;
  currentPosition: number | null;
  cancelled: boolean;
  items: BatchEnhanceItemProgress[];
}

export interface OrderImageInfo {
  storage_path: string;
  safe_filename: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
}

export interface OrderDesignItemResponse {
  id: string;
  position: number;
  material: string;
  vinyl_gloss_mode: VinylGlossMode | null;
  shape: StickerShape;
  diameter_cm: number | null;
  size_mode?: StickerSizeMode | null;
  height_cm?: number | null;
  width_cm?: number | null;
  dimensions: string | null;
  size_display: string;
  quantity: number;
  image: OrderImageInfo;
  /** Backend persisted non-destructive prepress & die-cut fields per design item. */
  enhanced_storage_path?: string | null;
  die_cut_anchors_json?: string | null;
  die_cut_eps_path?: string | null;
  prepress_status?: PrepressStatus;
  enhanced_image?: OrderImageInfo | null;
  original_image?: OrderImageInfo | null;
  has_enhanced_image?: boolean;
  prepress_dpi?: number | null;
  prepress_updated_at?: string | null;
}

export interface PublicOrderConfirmation {
  id: string;
  order_number: string;
  referral_name: string;
  phone: string;
  received_at: string;
  delivery_datetime: string;
  status: OrderStatus;
  items?: OrderDesignItemResponse[];
  items_count?: number;
  total_quantity?: number;
  material: StickerMaterial | string;
  vinyl_gloss_mode: VinylGlossMode | null;
  shape: StickerShape;
  diameter_cm: number | null;
  size_mode?: StickerSizeMode | null;
  height_cm?: number | null;
  width_cm?: number | null;
  dimensions: string | null;
  size_display: string;
  quantity: number;
  message: string;
}

export interface OrderStatusHistoryItem {
  id: number;
  previous_status: string | null;
  new_status: string;
  changed_by: string | null;
  comment: string | null;
  changed_at: string;
}

export interface OrderPaymentItem {
  id: number;
  amount: number;
  payment_method: string;
  recorded_by: string | null;
  reference: string | null;
  recorded_at: string;
}

export interface OrderItem {
  id: string;
  order_number: string;
  referral_name: string;
  phone: string;
  items?: OrderDesignItemResponse[];
  items_count?: number;
  total_quantity?: number;
  material: string;
  vinyl_gloss_mode: VinylGlossMode | null;
  shape: StickerShape;
  diameter_cm: number | null;
  size_mode?: StickerSizeMode | null;
  height_cm?: number | null;
  width_cm?: number | null;
  dimensions: string | null;
  size_display: string;
  quantity: number;
  image: OrderImageInfo;
  received_at: string;
  delivery_datetime: string;
  status: OrderStatus;
  total_price: number;
  advance_payment: number;
  pending_balance: number;
  payment_method: PaymentMethod;
  notes: string | null;
  source: string;
  updated_at: string | null;
  updated_by: string | null;
  status_history?: OrderStatusHistoryItem[];
  payments?: OrderPaymentItem[];
}

export type UserRoleCode = "admin" | "operador" | "cliente";

export interface UserProfile {
  id: number;
  firebase_uid: string;
  email: string;
  display_name: string;
  role: UserRoleCode;
  role_name: string;
  email_verified: boolean;
  is_active: boolean;
  auth_provider: string;
  created_at: string;
  updated_at: string;
}

export interface UserListResponse {
  items: UserProfile[];
  total: number;
}

export interface AdminRestorePasswordResponse {
  user_id: number;
  email: string;
  mode: "temporary_password" | "reset_link";
  message: string;
  reset_link: string | null;
}

export interface MaterialItem {
  id: number;
  name: string;
  description: string | null;
  requires_gloss_mode: boolean;
  base_unit_price: number;
  is_active: boolean;
  orders_count: number;
  created_at: string;
  updated_at: string;
}

export interface MaterialListResponse {
  items: MaterialItem[];
  total: number;
}

export interface OrderListResponse {
  items: OrderItem[];
  total: number;
}

export interface DashboardSummary {
  pending_orders_count: number;
  in_production_count: number;
  today_deliveries_count: number;
  overdue_deliveries_count: number;
  today_sales_total: number;
  today_collected_total: number;
  month_sales_total: number;
  month_collected_total: number;
  month_pending_balance: number;
  status_breakdown: Record<string, number>;
  upcoming_deliveries: OrderItem[];
}

export interface OrderSalesUpdatePayload {
  total_price?: number;
  advance_payment?: number;
  payment_method?: PaymentMethod;
  status?: OrderStatus;
  notes?: string | null;
  delivery_datetime?: string;
}

export interface Phase2ModuleCapability {
  id: string;
  name: string;
  status: string;
  stack: string[];
  description: string;
  endpoint: string;
}

export interface ImageProcessingCapabilities {
  phase: string;
  opencv_installed: boolean;
  numpy_installed: boolean;
  pillow_installed?: boolean;
  rembg_installed: boolean;
  modules: Phase2ModuleCapability[];
}

export type EnhanceOutputFormat = "png_rgb" | "tiff_cmyk" | "jpeg_cmyk";

export type BgRemovalMode = "smart_subject" | "auto_color" | "grabcut";
export type DieCutShapeMode = "en_su_forma" | "circular" | "poligono_regular";
export type DieCutCutContourTone = "magenta" | "cyan";
export type DieCutDirection = "outside" | "inside";
export type DieCutBorderMode = "none" | "base_color" | "white" | "custom";
export type DieCutBorderCutPosition = "inside_base" | "outside_base";
export type DieCutFitMode = "contain_proportional" | "exact_stretch";

export interface EnhanceAdjustments {
  target_dpi: number;
  upscale_factor: number;
  denoise_strength: number;
  sharpen_strength: number;
  auto_contrast: boolean;
  remove_background: boolean;
  bg_mode: BgRemovalMode;
  bg_tolerance: number;
  bg_feather: number;
  brightness: number;
  contrast: number;
  saturation: number;
  gamma: number;
  cyan: number;
  magenta: number;
  yellow: number;
  black: number;
  ink_limit_percent: number;
}

export interface CmykStats {
  avg_cyan: number;
  avg_magenta: number;
  avg_yellow: number;
  avg_black: number;
  max_tac_percent: number;
  tac_warning: boolean;
}

export interface EnhanceImageResult {
  source_label: string;
  item_id?: number | string | null;
  preview_data_url: string;
  white_ink_mask_data_url?: string | null;
  original_width: number;
  original_height: number;
  output_width: number;
  output_height: number;
  target_dpi: number;
  physical_width_cm: number;
  physical_height_cm: number;
  effective_dpi?: number | null;
  dpi_status?: DpiPreflightStatus | null;
  cmyk_stats: CmykStats;
  processing_time_ms: number;
  has_transparency: boolean;
  background_removed: boolean;
}

export interface BezierAnchor {
  x: number;
  y: number;
  in_x: number;
  in_y: number;
  out_x: number;
  out_y: number;
  smooth: boolean;
}

export interface DetectEdgesParams {
  mode: DieCutShapeMode;
  cut_direction: DieCutDirection;
  dpi: number;
  bleed_mm: number;
  white_border_mm: number;
  corner_roundness: number;
  smoothing_epsilon: number;
  polygon_sides: number;
  polygon_rotation_deg: number;
  remove_background: boolean;
  bg_tolerance: number;
  merge_islands: boolean;
  border_mode: DieCutBorderMode;
  border_color: string | null;
  border_width_mm: number;
  border_cut_position: DieCutBorderCutPosition;
  border_offset_mm: number;
  target_width_cm?: number | null;
  target_height_cm?: number | null;
  fit_mode?: DieCutFitMode;
}

export interface DetectEdgesResult {
  source_label: string;
  item_id?: number | null;
  mode: DieCutShapeMode;
  cut_direction: DieCutDirection;
  image_width: number;
  image_height: number;
  dpi: number;
  physical_width_cm: number;
  physical_height_cm: number;
  cut_width_cm?: number;
  cut_height_cm?: number;
  effective_px_per_mm?: number;
  target_width_cm?: number | null;
  target_height_cm?: number | null;
  fit_mode?: DieCutFitMode;
  effective_dpi?: number | null;
  dpi_status?: DpiPreflightStatus | null;
  bleed_mm: number;
  white_border_mm?: number;
  artwork_data_url: string;
  cut_path_d: string;
  anchors: BezierAnchor[];
  background_removed: boolean;
  border_mode: DieCutBorderMode;
  border_color: string | null;
  border_cut_position?: DieCutBorderCutPosition;
  detected_base_color: string | null;
  palette_colors: string[];
}

export type RetouchMode =
  | "inpaint_telea"
  | "inpaint_ns"
  | "watermark_clean"
  | "erase_transparent";

export type WatermarkTone = "light" | "dark" | "both";

export interface RetouchInpaintResult {
  preview_data_url: string;
  width: number;
  height: number;
  masked_pixels: number;
  masked_percent: number;
  mode: RetouchMode;
  processing_time_ms: number;
  has_transparency: boolean;
  detected_base_color: string | null;
}

export interface DetectWatermarkMaskResult {
  mask_data_url: string;
  width: number;
  height: number;
  detected_pixels: number;
  detected_percent: number;
  processing_time_ms: number;
}
