export type StickerMaterial =
  | "Vinilo Brillo"
  | "Vinilo Mate"
  | "Transparente"
  | "DTF UV"
  | "Hojas Adhesivas";

export type VinylGlossMode = "En rollo" | "Corte uno a uno";

export type StickerShape = "Circular" | "Rectangular" | "Cuadrado" | "En su forma";

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

export interface OrderImageInfo {
  storage_path: string;
  safe_filename: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
}

export interface PublicOrderConfirmation {
  id: string;
  order_number: string;
  referral_name: string;
  phone: string;
  material: StickerMaterial;
  vinyl_gloss_mode: VinylGlossMode | null;
  shape: StickerShape;
  diameter_cm: number | null;
  dimensions: string | null;
  size_display: string;
  quantity: number;
  received_at: string;
  delivery_datetime: string;
  status: OrderStatus;
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
  material: string;
  vinyl_gloss_mode: VinylGlossMode | null;
  shape: StickerShape;
  diameter_cm: number | null;
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
  rembg_installed: boolean;
  modules: Phase2ModuleCapability[];
}
