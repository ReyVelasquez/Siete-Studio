# DOCUMENTACIÓN TÉCNICA — SIETE Sticker Studio

> Documento de referencia arquitectónica, de modelo de datos y seguridad generado a partir del análisis directo del código fuente actual del repositorio. Orientado a auditoría técnica por ingeniería senior.

---

## 1. Resumen y Stack Tecnológico Real

**SIETE Sticker Studio** es una plataforma web full-stack para gestión integral de una imprenta de stickers (recepción pública de pedidos multi-diseño, panel operativo/financiero con control de entregas por prioridad, catálogo CRUD de materiales, gestión RBAC de usuarios y laboratorio de procesamiento de imágenes para preprensa CMYK y troquelado vectorial `.EPS`/`.SVG`).

### Arquitectura General
- **Frontend:** SPA en React 18 + TypeScript + Vite + Tailwind CSS con sistema de Design Tokens de 3 niveles (Light/Dark).
- **Backend:** API REST en FastAPI (Python 3.11+) con Pydantic v2 y arquitectura por capas (`routers` → `services` → `db/models` + `modules`).
- **Persistencia Híbrida:**
  - **Fuente de verdad transaccional:** Base de datos relacional normalizada en 3FN vía SQLAlchemy 2.0 (PostgreSQL con `psycopg` v3 en producción; SQLite con `PRAGMA foreign_keys=ON` como fallback local).
  - **Réplica NoSQL opcional:** Espejo *best-effort* de pedidos Maestro-Detalle en Cloud Firestore (`FIRESTORE_SYNC_ENABLED=true`).
- **Procesamiento de Preprensa (Fase 2):** OpenCV, NumPy y Pillow integrados en el backend (escalado 300 DPI, calibración CMYK/TAC, remoción de fondo, retoque por *inpainting*, vectorización Bézier y exportación `.EPS`/`.SVG` en 2 capas).

### Versiones Exactas Extraídas de Manifiestos

#### Frontend (`frontend/package.json`)
| Categoría | Paquete | Versión | Uso |
|---|---|---|---|
| Runtime | `react` / `react-dom` | `^18.3.1` | UI declarativa |
| Routing | `react-router-dom` | `^6.28.0` | Enrutamiento SPA público/protegido |
| Auth / Cloud | `firebase` | `^11.1.0` | Firebase Web Auth (Email/Password + Google OAuth) |
| Formularios | `react-hook-form` | `^7.54.2` | Gestión de formularios y `useFieldArray` |
| Validación | `zod` / `@hookform/resolvers` | `^3.24.1` / `^3.9.1` | Validación tipada en cliente |
| UI & Motion | `framer-motion` / `lucide-react` | `^11.15.0` / `^0.468.0` | Animaciones e iconografía |
| Build / CSS | `vite` / `tailwindcss` / `postcss` / `autoprefixer` | `^6.0.5` / `^3.4.17` / `^8.4.49` / `^10.4.20` | Empaquetado y estilos utilitarios |
| Tooling | `typescript` / `@vitejs/plugin-react` | `^5.7.2` / `^4.3.4` | Tipado estático y compilación |

#### Backend (`backend/requirements.txt`)
| Categoría | Paquete | Rango de Versión | Uso |
|---|---|---|---|
| Web / ASGI | `fastapi` / `uvicorn[standard]` | `>=0.115.0,<1.0.0` / `>=0.32.0,<1.0.0` | Framework REST y servidor ASGI |
| Validación | `pydantic` / `pydantic-settings` | `>=2.9.0,<3.0.0` / `>=2.6.0,<3.0.0` | Esquemas v2 y configuración por entorno |
| Uploads | `python-multipart` | `>=0.0.12,<1.0.0` | Parsing de `multipart/form-data` |
| Base de Datos | `sqlalchemy` / `psycopg[binary]` | `>=2.0.35,<3.0.0` / `>=3.2.0,<4.0.0` | ORM 2.0 y driver PostgreSQL |
| Firebase | `firebase-admin` | `>=6.6.0,<7.0.0` | Verificación JWT, Firestore, Storage, Auth Admin |
| Preprensa (Fase 2) | `opencv-python-headless` / `numpy` / `pillow` | `>=4.10.0` / `>=2.0.0` / `>=10.4.0` | Mejora 300 DPI, CMYK, *inpainting*, vectorización |
| Testing | `pytest` / `httpx` | `>=8.3.0,<9.0.0` / `>=0.27.0,<1.0.0` | Pruebas unitarias y de integración ASGI |
| Fase 2 (comentadas) | `rembg`, `onnxruntime`, `scipy`, `shapely` | `>=2.0.59`, `>=1.19.0`, `>=1.14.0`, `>=2.0.6` | Aún no instaladas (planificadas para IA/nesting) |

### Servicios Externos Integrados
1. **Firebase Authentication:** Registro, login (correo/clave y Google OAuth popup), verificación obligatoria de correo, recuperación de contraseña y vinculación de credenciales; administración de cuentas y restauración de contraseñas desde el backend vía Admin SDK.
2. **Firebase Cloud Firestore:** Sincronización espejo (*best-effort*) de documentos Maestro-Detalle de pedidos en la colección `orders` (desactivable por variable de entorno).
3. **Firebase Storage (con fallback local):** Almacenamiento de artes subidos y mejorados (`STORAGE_BACKEND=auto|firebase|local`); si el bucket no está disponible en modo `auto`, persiste en disco local bajo `backend/uploads/`.
4. **PostgreSQL (o SQLite fallback):** Persistencia ACID principal del dominio relacional.
5. **WhatsApp Web (`wa.me`):** Enlaces salientes prellenados para confirmación y seguimiento con clientes (sin API server-side).

---

## 2. Árbol de Directorios

*(Se omiten `node_modules`, `.git`, `.venv`, `__pycache__`, `dist`, `.pytest_cache`, `uploads` y archivos compilados; profundidad máxima: 3 niveles en `/backend` y `/frontend`.)*

```text
backend/
├── .env.example
├── pytest.ini
├── requirements.txt
├── app/
│   ├── __init__.py
│   ├── main.py                      # Factory FastAPI, lifespan (init_db_and_seed + Firebase), CORS y middlewares
│   ├── core/
│   │   ├── config.py                # Settings Pydantic (env vars, límites, horarios, CORS)
│   │   ├── file_security.py         # Magic-byte detection, sanitización SVG y renombrado UUID
│   │   ├── firebase.py              # Inicialización Firebase Admin SDK (Auth, Firestore, Storage)
│   │   ├── rate_limit.py            # SlidingWindowRateLimiter en memoria (IP)
│   │   └── security.py              # Dependencias JWT (get_current_user, require_admin) + SecurityHeadersMiddleware
│   ├── db/
│   │   ├── database.py              # Engine SQLAlchemy 2.0, SessionLocal, get_db
│   │   ├── models.py                # 10 modelos ORM 3FN + CHECK/UNIQUE/FK constraints
│   │   └── seed.py                  # Seed idempotente (roles, materiales, formas) + backfill order_items
│   ├── modules/
│   │   └── image_processing/        # base.py, enhancer.py, retouch.py, edge_detector.py, layout_packer.py (stub)
│   ├── routers/
│   │   ├── admin_orders.py          # CRUD administrativo de pedidos y descarga de artes (pedido e ítem)
│   │   ├── admin_users.py           # CRUD RBAC de usuarios y restauración de contraseñas (solo admin)
│   │   ├── auth.py                  # Perfil sincronizado (/auth/me) y sync de verificación de email
│   │   ├── dashboard.py             # Resumen KPI y cola prioritaria
│   │   ├── health.py                # Health check de DB, Firebase y dependencias Fase 2
│   │   ├── image_processing.py      # Endpoints de mejora CMYK, retoque, troquel EPS/SVG y stub pack-layout
│   │   ├── materials.py             # Listado público y CRUD administrativo de materiales
│   │   └── public_orders.py         # Ingesta pública Maestro-Detalle (multi-diseño + fallback legado)
│   ├── schemas/
│   │   ├── dashboard.py
│   │   ├── image_processing.py
│   │   ├── material.py
│   │   ├── order.py
│   │   └── user.py
│   └── services/
│       ├── material_service.py      # CRUD de materiales con conteo multi-ítem y protección FK
│       ├── order_service.py         # Persistencia ACID Maestro-Detalle + réplica Firestore + KPIs
│       ├── storage_service.py       # Driver dual Firebase Storage / almacenamiento local seguro
│       └── user_service.py          # Sincronización Firebase↔SQL, CRUD usuarios y reset de claves
└── tests/
    ├── conftest.py                  # Aislamiento de Firestore en pruebas automatizadas
    ├── test_api_security.py
    ├── test_die_cut_eps.py
    ├── test_file_security.py
    ├── test_image_enhancer.py
    ├── test_order_validation.py
    ├── test_rate_limit.py
    ├── test_relational_crud.py
    └── test_retouch_inpaint.py

frontend/
├── .env.example
├── index.html
├── package.json
├── postcss.config.js
├── tailwind.config.ts               # Mapeo de Design Tokens HSL semánticos + darkMode dual
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── public/
│   └── brand/
│       ├── favicon.svg
│       └── logo-mark.svg
└── src/
    ├── App.tsx                      # Definición de rutas públicas y protegidas
    ├── main.tsx
    ├── vite-env.d.ts
    ├── components/
    │   ├── dashboard/               # KpiGrid, PendingQueue, QuickActions, Phase2PreviewModal
    │   ├── image-processing/        # BeforeAfterSlider, CmykTelemetryBar, DieCutVectorCanvas, RetouchInpaintModal
    │   ├── layout/                  # DashboardLayout, ProtectedRoute, PublicHeader
    │   ├── orders/                  # PublicOrderForm, DesignItemCard, LiveStickerPreview, OrderConfirmation, OrderDetailModal, OrdersTable, OrdersCardGrid, QuickOrderModal, StickerDropzone
    │   └── ui/                      # BrandLogo, Button, DieCutDropzone, Input, Modal, Select, StickerBadge, StickerCard, ThemeToggle, ToastContainer
    ├── config/
    │   ├── animations.ts            # Presets Framer Motion centralizados
    │   ├── env.ts                   # Lectura tipada de variables VITE_*
    │   ├── firebase.ts              # Inicialización Firebase Web Auth + GoogleAuthProvider
    │   └── theme.config.ts          # Metadatos de marca, catálogo base, horarios y copy
    ├── contexts/
    │   ├── AuthContext.tsx          # Estado de sesión Firebase + perfil RBAC backend
    │   └── ThemeContext.tsx         # Tema light/dark sincronizado en data-theme, .dark y localStorage
    ├── hooks/
    │   ├── useOrders.ts             # Carga, filtrado y actualización local de pedidos admin
    │   └── useToast.tsx             # Contexto y cola de notificaciones toast
    ├── pages/
    │   ├── DashboardHomePage.tsx
    │   ├── DieCutStudioPage.tsx
    │   ├── ForgotPasswordPage.tsx
    │   ├── ImageEnhancerPage.tsx
    │   ├── LoginPage.tsx
    │   ├── MaterialsCatalogPage.tsx
    │   ├── OrdersManagementPage.tsx
    │   ├── ProfileSecurityPage.tsx
    │   ├── PublicOrderPage.tsx
    │   ├── RegisterPage.tsx
    │   ├── UsersManagementPage.tsx
    │   └── VerifyEmailPage.tsx
    ├── schemas/
    │   ├── auth.schema.ts
    │   ├── material.schema.ts
    │   └── order.schema.ts
    ├── services/
    │   ├── api.ts                   # Cliente fetch con inyección Bearer JWT y manejo ApiError
    │   ├── imageProcessing.service.ts
    │   ├── materials.service.ts
    │   ├── orders.service.ts
    │   └── users.service.ts
    ├── styles/
    │   ├── globals.css              # Clases de taller (.die-cut-zone, .sticker-peel, .bg-print-grid)
    │   └── tokens.css               # 3 niveles de tokens CSS (Sborg HSL Light/Dark)
    ├── types/
    │   └── order.ts                 # Interfaces de dominio (pedidos, usuarios, materiales, Fase 2)
    └── utils/
        └── date.ts                  # Formateo local, slots :00 y urgencia de entrega
```

*(Adicionalmente existen en raíz `database/schema_postgresql.sql`, `database/seed.sql` y `docs/MODELO_BASE_DE_DATOS.md`.)*

---

## 3. Modelo de Datos y Reglas de Negocio

### 3.1 Modelo Relacional (Fuente de Verdad — `backend/app/db/models.py`)
10 tablas en Tercera Forma Normal (3FN):
- `roles` (`id`, `code` [`admin`|`operador`|`cliente`], `name`, `description`).
- `users` (`id`, `firebase_uid` UK, `email` UK, `display_name`, `role_id` FK `RESTRICT`, `email_verified`, `is_active`, `auth_provider`).
- `customers` (`id`, `referral_name`, `phone` UK, `notes`).
- `materials` (`id`, `name` UK, `description`, `requires_gloss_mode`, `base_unit_price >= 0`, `is_active`).
- `shapes` (`id`, `name` UK, `is_circular`, `is_active`).
- `orders` (Maestro): `id`, `order_number` UK, `customer_id` FK `RESTRICT`, resumen del diseño principal (`material_id`, `vinyl_gloss_mode`, `shape_id`, `diameter_cm`, `dimensions`, `size_display`, `quantity` = suma total), fechas (`received_at`, `delivery_datetime`), estado y finanzas (`status`, `total_price`, `advance_payment`, `pending_balance`, `payment_method`, `notes`, `source` [`public`|`admin`]), auditoría (`created_by_user_id`, `updated_by_user_id` FK `SET NULL`).
- `order_items` (Detalle 1:N, `ON DELETE CASCADE`): `id`, `order_id`, `position` (`UNIQUE(order_id, position)`), `material_id` FK `RESTRICT`, `vinyl_gloss_mode`, `shape_id` FK `RESTRICT`, `diameter_cm`, `dimensions`, `size_display`, `quantity`, metadatos de imagen propia (`image_storage_path`, `image_safe_filename`, `image_original_filename`, `image_content_type`, `image_size_bytes`, `image_uploaded_at`).
- `order_images` (1:1 legado/compatibilidad, `ON DELETE CASCADE`): espejo del arte del diseño #1 usado por herramientas de Fase 2.
- `order_status_history` (1:N, `ON DELETE CASCADE`): bitácora de transiciones de estado (`previous_status`, `new_status`, `changed_by_user_id`, `comment`, `changed_at`).
- `payments` (1:N, `ON DELETE CASCADE`): registro histórico de abonos (`amount > 0`, `payment_method`, `recorded_by_user_id`, `reference`, `recorded_at`).

### 3.2 Esquemas Pydantic v2 (Backend)

| Módulo | Esquema | Campos y Propósito |
|---|---|---|
| `schemas/order.py` | **Enums** | `StickerMaterial` (`Vinilo Brillo`, `Vinilo Mate`, `Transparente`, `DTF UV`, `Hojas Adhesivas`), `VinylGlossMode` (`En rollo`, `Corte uno a uno`), `StickerShape` (`Circular`, `Rectangular`, `Cuadrado`, `En su forma`), `OrderStatus` (`Pendiente`, `En Diseño`, `En Impresión`, `Troquelado`, `Listo`, `Entregado`, `Cancelado`), `PaymentMethod` (`Pendiente`, `Efectivo`, `Transferencia`, `QR`, `Tarjeta`, `Mixto`). |
| `schemas/order.py` | `OrderItemCreateInput` | `material`, `vinyl_gloss_mode?`, `shape`, `diameter_cm?` (0.5–500), `dimensions?` (max 40), `quantity` (1–1,000,000). Aplica reglas condicionales independientes por diseño. |
| `schemas/order.py` | `OrderCreateInput` | Cabecera Maestro-Detalle: `referral_name` (2–120), `phone` (7–25), `received_at` (UTC default now), `delivery_datetime` (exacta `:00`), `items: List[OrderItemCreateInput]` (`min_length=1`, `max_length=50` en esquema). Incluye adaptador `mode="before"` para payloads legados de 1 solo sticker. |
| `schemas/order.py` | `AdminQuickOrderCreateInput` | Hereda `OrderCreateInput` + `total_price`, `advance_payment`, `payment_method`, `status`, `notes` (max 1000). Valida `advance_payment <= total_price` si `total_price > 0`. |
| `schemas/order.py` | `OrderSalesUpdateInput` | PATCH parcial: `referral_name?`, `phone?`, `quantity?`, `total_price?`, `advance_payment?`, `payment_method?`, `status?`, `notes?`, `delivery_datetime?` (`allow_past=True`). |
| `schemas/order.py` | `OrderImageInfo` / `OrderItemResponse` | Metadatos de imagen (`storage_path`, `safe_filename`, `original_filename`, `content_type`, `size_bytes`) y línea de diseño (`id`, `position`, `material`, `vinyl_gloss_mode`, `shape`, `diameter_cm`, `dimensions`, `size_display`, `quantity`, `image`). |
| `schemas/order.py` | `PublicOrderConfirmation` / `OrderResponse` | Cabecera del pedido + `items: List[OrderItemResponse]`, `items_count`, `total_quantity`, y campos resumen retrocompatibles del ítem #1 (`material`, `shape`, `size_display`, `quantity`). `OrderResponse` añade finanzas, `image`, `source`, `updated_at/by`, `status_history[]` y `payments[]`. |
| `schemas/material.py` | `MaterialCreateInput` / `MaterialUpdateInput` / `MaterialResponse` | `name` (2–80), `description?` (max 400), `requires_gloss_mode`, `base_unit_price` (0–100,000), `is_active`; respuesta incluye `orders_count`. |
| `schemas/user.py` | `AdminCreateUserInput` / `AdminUpdateUserInput` / `AdminRestorePasswordInput` / `UserProfileResponse` | Enum `UserRoleCode` (`admin`, `operador`, `cliente`), validación de contraseña fuerte (`>=8`, letra + número), modos de restauración (`temporary_password` | `reset_link`). |
| `schemas/dashboard.py` | `DashboardSummaryResponse` | Contadores (`pending_orders_count`, `in_production_count`, `today_deliveries_count`, `overdue_deliveries_count`), métricas financieras (`today_*`, `month_*`), `status_breakdown` y `upcoming_deliveries` (máx. 8). |
| `schemas/image_processing.py` | `EnhanceAdjustmentsBase`, `EnhanceImageRequest`, `SaveEnhancedToOrderRequest`, `DetectEdgesRequest`, `ExportDieCutRequest`, `PackLayoutRequest` | Parámetros acotados de DPI (`72–1200`), upscale (`1.0–4.0`), remoción de fondo (`smart_subject`, `auto_color`, `grabcut`), ajustes tonales/CMYK (`-50..+50`, `ink_limit_percent` `200..400`), `BezierAnchorSchema` (`3..500` nodos), exportación `.eps`/`.svg` y contrato stub de nesting. |

### 3.3 Tipos/Interfaces TypeScript Principales (`frontend/src/types/order.ts` y `schemas/`)
- **Tipos literales:** `StickerMaterial`, `VinylGlossMode`, `StickerShape`, `OrderStatus`, `PaymentMethod`, `UserRoleCode`, `EnhanceOutputFormat`, `BgRemovalMode`, `DieCutShapeMode`, `DieCutDirection`, `DieCutBorderMode`, `DieCutBorderCutPosition`, `RetouchMode`, `WatermarkTone`.
- **Interfaces núcleo:** `OrderImageInfo`, `OrderDesignItemResponse`, `PublicOrderConfirmation`, `OrderItem` (representa un pedido completo con `items?`, `items_count?`, `total_quantity?`, `status_history?`, `payments?`), `OrderListResponse`, `UserProfile`, `MaterialItem`, `DashboardSummary`, `OrderSalesUpdatePayload`.
- **DTOs Fase 2:** `ImageProcessingCapabilities`, `EnhanceAdjustments`, `CmykStats`, `EnhanceImageResult`, `BezierAnchor`, `DetectEdgesParams`, `DetectEdgesResult`, `RetouchInpaintResult`, `DetectWatermarkMaskResult`.
- **Esquemas Zod (`frontend/src/schemas/`):** `publicOrderSchema` (cabecera + `items: z.array(orderDesignItemSchema)`), `quickOrderSchema` (un diseño), `salesUpdateSchema`, `materialSchema` y esquemas de autenticación (`loginSchema`, `registerSchema`, `forgotPasswordSchema`, `changePasswordSchema`, `linkPasswordSchema`, `adminCreateUserSchema`, `adminTempPasswordSchema`).

### 3.4 Estructura en Cloud Firestore (Réplica Maestro-Detalle)
Cuando `FIRESTORE_SYNC_ENABLED=true` y Firebase Admin está configurado, `order_service.py` escribe/actualiza un documento por pedido en la colección raíz `orders` con ID de documento igual al código de orden (`orders/{order_number}`):

```json
{
  "id": "12",
  "order_number": "STK-20261122-AB3K",
  "referral_name": "Andrea Soliz",
  "phone": "+59177889900",
  "received_at": "Timestamp (UTC)",
  "delivery_datetime": "Timestamp (UTC, minuto :00)",
  "status": "Pendiente",
  "source": "public",
  "items_count": 2,
  "total_quantity": 150,
  "items": [
    {
      "id": "21",
      "position": 1,
      "material": "Vinilo Brillo",
      "vinyl_gloss_mode": "Corte uno a uno",
      "shape": "Circular",
      "diameter_cm": 5.0,
      "dimensions": null,
      "size_display": "Ø 5 cm",
      "quantity": 100,
      "image": {
        "storage_path": "orders/2026/11/<uuid>.png",
        "safe_filename": "<uuid>.png",
        "original_filename": "logo-circular.png",
        "content_type": "image/png",
        "size_bytes": 184220
      }
    }
  ],
  "total_price": 0.0,
  "advance_payment": 0.0,
  "pending_balance": 0.0,
  "payment_method": "Pendiente",
  "notes": null,
  "updated_at": "Timestamp (UTC)",
  "updated_by": null
}
```
- **Relación Maestro-Detalle:** Implementada como documento maestro con arreglo embebido `items[]` (no subcolección). Al actualizar ventas/estado se sobrescribe el documento (`set`); al eliminar el pedido en SQL se elimina el documento en Firestore (`delete`). Fallos de Firestore se registran como `WARNING` sin revertir la transacción SQL.

### 3.5 Reglas de Negocio Implementadas
1. **Materiales y modalidad condicional:** Si `material == "Vinilo Brillo"`, `vinyl_gloss_mode` es obligatorio (`En rollo` o `Corte uno a uno`). Para cualquier otro material, enviar `vinyl_gloss_mode` provoca rechazo (`422`). No se puede eliminar un material referenciado en `orders` o `order_items` (`409 Conflict`, `ON DELETE RESTRICT`).
2. **Formas y medidas excluyentes (XOR):**
   - `Circular`: exige exclusivamente `diameter_cm` entre `0.5` y `500` cm (redondeado a 2 decimales, `size_display = "Ø {d} cm"`); prohíbe `dimensions`.
   - `Rectangular`, `Cuadrado`, `En su forma`: exige exclusivamente `dimensions` con regex `Alto x Ancho` (cada lado entre `0.5` y `500` cm, normalizado a `"{h}x{w} cm"`); prohíbe `diameter_cm`.
   - Esta restricción se duplica en Zod (cliente), Pydantic (API) y `CHECK` constraints en SQL (`chk_orders_size_xor`, `chk_order_items_size_xor`).
3. **Horas de entrega estrictas:** `delivery_datetime` debe tener minutos, segundos y microsegundos exactamente en `0` (`:00`), dentro del horario laboral (`08:00`–`20:00` en zona horaria del taller `TIMEZONE_OFFSET_MINUTES=-240`, UTC-4). En creación no puede ser pasado (tolerancia de 5 min); en `PATCH` administrativo se permiten fechas pasadas para regularización.
4. **Cantidades y código de orden:** Cada ítem admite `1..1,000,000` unidades. El código se genera con entropía criptográfica (`secrets.choice`) bajo el formato `STK-YYYYMMDD-XXXX`.
5. **Estados y pagos:** Estados permitidos: `Pendiente` → `En Diseño` → `En Impresión` → `Troquelado` → `Listo` → `Entregado` / `Cancelado`. Cada cambio de estado inserta un registro en `order_status_history`. En finanzas: `total_price >= 0`, `advance_payment >= 0`, `advance_payment <= total_price` (cuando `total_price > 0`), `pending_balance = max(0, total_price - advance_payment)`. Todo incremento positivo en `advance_payment` genera un registro auditable en `payments`.
6. **Clientes y teléfonos:** Los teléfonos se normalizan eliminando separadores y validando `7..15` dígitos (preservando `+` inicial). Un cliente se hace *upsert* por `customers.phone` (llave única).

---

## 4. Mapa de Endpoints (API Backend)

Prefijo base configurable: `/api/v1` (adicionalmente `GET /` retorna estado básico del servicio sin auth).

| Método HTTP | Ruta | ¿Requiere Auth? | Descripción breve | Validaciones principales |
|---|---|---|---|---|
| `GET` | `/` | No | Estado raíz del servicio (excluido de OpenAPI) | Ninguna |
| `GET` | `/api/v1/health` | No | Readiness de DB, Firebase y libs Fase 2 | Ninguna |
| `GET` | `/api/v1/auth/me` | Sí (JWT) | Perfil sincronizado en SQL y rol RBAC | Token Bearer Firebase válido + usuario activo |
| `POST` | `/api/v1/auth/sync-verification` | Sí (JWT) | Sincroniza `email_verified` de Firebase a SQL | Token Bearer Firebase válido |
| `POST` | `/api/v1/public/orders` | No (Rate limit) | Crea pedido público Maestro-Detalle (`multipart/form-data`) | Rate limit IP (10/60s), `items` JSON (1–`MAX_ORDER_ITEMS`) o campos legados, 1 imagen por ítem, reglas condicionales, hora `:00` futura, magic bytes + SVG XSS |
| `GET` | `/api/v1/public/materials` | No | Lista materiales activos del catálogo | Filtra `is_active=True` |
| `GET` | `/api/v1/dashboard/summary` | Sí (JWT) | KPIs operativos, financieros y 8 entregas próximas | Token Bearer válido |
| `GET` | `/api/v1/admin/orders` | Sí (JWT) | Lista pedidos ordenados por urgencia/entrega | Query params tipados (`status`, `material`, `shape`, `search` max 120, `only_pending`, `delivery_date`, `limit` 1–500) |
| `POST` | `/api/v1/admin/orders` | Sí (JWT) | Crea pedido rápido interno (multi-diseño o legado) | `AdminQuickOrderCreateInput`, `advance <= total`, 1 imagen por ítem validada |
| `GET` | `/api/v1/admin/orders/{order_id}` | Sí (JWT) | Detalle completo de pedido con ítems, historial y pagos | `order_id` numérico válido (404 si no existe) |
| `PATCH` | `/api/v1/admin/orders/{order_id}` | Sí (JWT) | Actualiza cliente, ventas, pagos, notas, estado o entrega | `OrderSalesUpdateInput`, `advance <= total`, hora `:00` |
| `DELETE` | `/api/v1/admin/orders/{order_id}` | Sí (JWT) | Elimina pedido (`CASCADE`), archivos en Storage y doc Firestore | `order_id` existente |
| `GET` | `/api/v1/admin/orders/{order_id}/image` | Sí (JWT) | Descarga/previsualiza arte principal (o `?item_id=&download=`) | Existencia de pedido/ítem y archivo en Storage |
| `GET` | `/api/v1/admin/orders/{order_id}/items/{item_id}/image` | Sí (JWT) | Descarga/previsualiza arte propio de un diseño específico | Relación `item_id` perteneciente al `order_id` |
| `GET` | `/api/v1/admin/materials` | Sí (JWT) | Lista todos los materiales con conteo de pedidos | Token Bearer válido |
| `POST` | `/api/v1/admin/materials` | Sí (JWT) | Crea un material en catálogo | `MaterialCreateInput`, unicidad case-insensitive (`409`) |
| `PATCH` | `/api/v1/admin/materials/{material_id}` | Sí (JWT) | Edita un material existente | `MaterialUpdateInput`, unicidad de nombre (`409`) |
| `DELETE` | `/api/v1/admin/materials/{material_id}` | Sí (JWT) | Elimina material sin pedidos asociados | Bloquea con `409` si existe referencia en `orders` o `order_items` |
| `GET` | `/api/v1/admin/users` | Sí (JWT + `admin`) | Lista usuarios con filtros `search` y `role` | `require_admin` (`403` si rol ≠ `admin`), `search` max 120 |
| `POST` | `/api/v1/admin/users` | Sí (JWT + `admin`) | Crea usuario en Firebase Auth y SQL | `require_admin`, email válido, contraseña fuerte (`>=8`, letra+número) |
| `PATCH` | `/api/v1/admin/users/{user_id}` | Sí (JWT + `admin`) | Modifica nombre, rol, verificación o estado activo | `require_admin`, impide auto-desactivación o auto-degradación |
| `DELETE` | `/api/v1/admin/users/{user_id}` | Sí (JWT + `admin`) | Elimina usuario en Firebase Auth y SQL | `require_admin`, impide auto-eliminación |
| `POST` | `/api/v1/admin/users/{user_id}/restore-password` | Sí (JWT + `admin`) | Asigna contraseña temporal o genera link de reset | `require_admin`, `AdminRestorePasswordInput` |
| `GET` | `/api/v1/image-processing/capabilities` | Sí (JWT) | Estado de módulos Fase 2 y librerías instaladas | Token Bearer válido |
| `POST` | `/api/v1/image-processing/enhance` | Sí (JWT) | Mejora calidad, fondo y CMYK del arte de un pedido | `EnhanceImageRequest` (DPI 72–1200, upscale 1–4x, TAC 200–400%) |
| `POST` | `/api/v1/image-processing/enhance/upload` | Sí (JWT) | Mejora imagen subida directamente (`multipart`) | `validate_and_prepare_image` + rangos `Form(...)` |
| `POST` | `/api/v1/image-processing/enhance/export` | Sí (JWT) | Exporta archivo final `png_rgb`, `tiff_cmyk` o `jpeg_cmyk` | Requiere `order_id` o `image`, rangos de calibración |
| `POST` | `/api/v1/image-processing/enhance/save-to-order` | Sí (JWT) | Procesa y reemplaza el arte principal de un pedido en Storage/DB | `SaveEnhancedToOrderRequest`, `advance_status` acotado |
| `POST` | `/api/v1/image-processing/enhance/save-to-order/upload` | Sí (JWT) | Guarda arte retocado subido sobre el pedido y registra historial | `validate_and_prepare_image` + `order_id` válido |
| `POST` | `/api/v1/image-processing/retouch/inpaint` | Sí (JWT) | Borrador mágico / limpieza de marcas de agua con máscara | `mask` obligatoria + (`image` o `order_id`), `mode` acotado, `radius` 1–30 |
| `POST` | `/api/v1/image-processing/retouch/detect-watermark` | Sí (JWT) | Detecta máscara automática de marcas de agua | `image` o `order_id`, `tone` (`light`/`dark`/`both`), `sensitivity` 10–95 |
| `POST` | `/api/v1/image-processing/detect-edges` | Sí (JWT) | Detecta silueta y genera anclas Bézier de troquel para pedido | `DetectEdgesRequest` (`mode`, `bleed_mm` 0–20, `polygon_sides` 3–12) |
| `POST` | `/api/v1/image-processing/detect-edges/upload` | Sí (JWT) | Detecta silueta y anclas Bézier sobre imagen subida | `validate_and_prepare_image` + rangos de borde/sangrado |
| `POST` | `/api/v1/image-processing/die-cut/export` | Sí (JWT) | Exporta `.EPS` o `.SVG` en 2 capas (Diseño CMYK + `CutContour`) | `ExportDieCutRequest` (`3..500` anclas, 16–8192 px, `artwork_data_url` u `order_id`) |
| `POST` | `/api/v1/image-processing/pack-layout` | Sí (JWT) | **[Stub Fase 2]** Devuelve `501 Not Implemented` | `PackLayoutRequest` (`items >= 1`, dimensiones `> 0`) |

---

## 5. Arquitectura Frontend

### 5.1 Mapa de Rutas (`frontend/src/App.tsx`)

| Ruta | Acceso | Guard / Layout | Vista |
|---|---|---|---|
| `/` | Pública | `PublicHeader` | `PublicOrderPage` (creación de pedidos multi-diseño + vista previa en vivo + confirmación) |
| `/login` | Pública | — | `LoginPage` (Email/Password + Google OAuth) |
| `/register` | Pública | — | `RegisterPage` (alta + envío de correo de verificación) |
| `/forgot-password` | Pública | — | `ForgotPasswordPage` (envío de enlace Firebase) |
| `/verify-email` | Protegida (parcial) | `ProtectedRoute allowUnverified` | `VerifyEmailPage` (bloquea acceso al dashboard hasta verificar correo) |
| `/dashboard` | Protegida + email verificado | `ProtectedRoute` → `DashboardLayout` | `DashboardHomePage` (KPIs, cola prioritaria, accesos rápidos) |
| `/dashboard/orders` | Protegida + email verificado | `ProtectedRoute` → `DashboardLayout` | `OrdersManagementPage` (tabla/tarjetas, filtros, modal detalle multi-diseño y pedido rápido) |
| `/dashboard/image-enhancer` | Protegida + email verificado | `ProtectedRoute` → `DashboardLayout` | `ImageEnhancerPage` (calidad 300 DPI, fondo PNG, CMYK, borrador *inpaint*) |
| `/dashboard/die-cut` | Protegida + email verificado | `ProtectedRoute` → `DashboardLayout` | `DieCutStudioPage` (canvas vectorial Bézier interactivo y exportación `.EPS`/`.SVG`) |
| `/dashboard/materials` | Protegida + email verificado | `ProtectedRoute` → `DashboardLayout` | `MaterialsCatalogPage` (CRUD de sustratos) |
| `/dashboard/users` | Protegida (UI filtrada a `admin`) | `ProtectedRoute` → `DashboardLayout` | `UsersManagementPage` (CRUD usuarios y restauración de contraseñas; el backend exige `admin`) |
| `/dashboard/profile` | Protegida + email verificado | `ProtectedRoute` → `DashboardLayout` | `ProfileSecurityPage` (cambio de clave, vinculación de clave a cuentas Google) |
| `*` | Pública | `Navigate replace` | Redirige a `/` |

### 5.2 Manejo de Estado y Comunicación con API
- **Contextos globales (sin Redux/Zustand):**
  - `ThemeProvider` (`ThemeContext.tsx`): persiste `light`/`dark` en `localStorage` (`siete_studio_theme`), respeta `prefers-color-scheme` y sincroniza tanto `data-theme="dark"` como la clase `.dark` en `<html>`.
  - `AuthProvider` (`AuthContext.tsx`): suscrito a `onAuthStateChanged` de Firebase Auth; carga y sincroniza el perfil RBAC del backend (`GET /auth/me`), encapsula login, registro, Google OAuth, verificación de email, cambio y vinculación de contraseña.
  - `ToastProvider` (`useToast.tsx`): sistema global de notificaciones transitorias.
- **Hooks y capa de servicios (`frontend/src/services/`):**
  - `api.ts`: cliente `fetch` centralizado (`apiRequest` y `apiFetchBlob`) que obtiene el ID Token fresco de `firebaseAuth.currentUser.getIdToken()`, inyecta `Authorization: Bearer <token>`, serializa JSON o `FormData` y normaliza errores en `ApiError(status, detail)`.
  - `useOrders.ts`: gestiona listado filtrado, carga, error y actualización optimista/local (`replaceOrderLocally`).
- **Formularios y validación:**
  - Basados en `react-hook-form` + `zodResolver`.
  - `PublicOrderForm.tsx` usa `useFieldArray({ control, name: "items" })` para administrar dinámicamente tarjetas `DesignItemCard`. Cada tarjeta evalúa sus reglas condicionales de forma independiente y las vistas previas locales (`URL.createObjectURL`) se indexan por `field.id` (evitando corrupción de vistas previas al eliminar elementos intermedios y revocándolas al desmontar).

### 5.3 Sistema de Diseño y Design Tokens
- **Arquitectura de 3 niveles (`frontend/src/styles/tokens.css`):**
  1. **Tier 1 (Anclas Sborg):** Canales HSL separados por espacio (`--sborg-midnight-hsl`, `--sborg-navy-hsl`, `--sborg-emerald-hsl`, `--sborg-white-hsl` y escala `--brand-50` a `--brand-950`) para soportar modificadores nativos de opacidad en Tailwind (`bg-accent-soft/75`).
  2. **Tier 2 (Semánticos Light & Dark):** `surface-*` (`canvas`, `card`, `elevated`, `subtle`, `inverted`), `ink-*` (`primary`, `secondary`, `muted`, `inverted`), `line-*` (`subtle`, `strong`, `diecut`), `accent-*` y estados tonales `state-{info,positive,warning,critical}-{bg,ink}` verificados bajo contraste WCAG 2.1 AA/AAA.
  3. **Tier 3 (Componentes y taller):** Radii (`--radius-sticker`), elevaciones (`--shadow-sticker`, `--shadow-sticker-hover`), timing (`--duration-fast/base`, `--ease-studio`), marcas de registro, efecto *corner-peel* y texturas `.bg-print-grid` / `.bg-transparency-grid` definidas en `globals.css`.
- **Integración Tailwind (`tailwind.config.ts`):** Mapea cada token a `hsl(var(--*-hsl) / <alpha-value>)` con soporte dual de modo oscuro (`&:where(.dark, .dark *)` y `[data-theme="dark"]`).
- **Primitivas reutilizables (`components/ui/`):** `Button` (variantes `primary`, `secondary`, `outline`, `ghost`, `inverted`, `dieCut`), `StickerCard` (`peel`, `dieCut`, `registrationMarks`, `tone`), `DieCutDropzone`, `Input`, `Select`, `Modal`, `StickerBadge`, `ThemeToggle`, `ToastContainer`.

---

## 6. Seguridad Implementada

### 6.1 Verificación de JWT Firebase y Control de Acceso (RBAC)
- **Extracción:** `HTTPBearer(auto_error=False)` en `backend/app/core/security.py`; rechaza con `401` si falta esquema `Bearer` o el token está vacío.
- **Verificación criptográfica y revocación:** `verify_firebase_id_token(token)` ejecuta `firebase_auth.verify_id_token(id_token, check_revoked=True)` mediante Firebase Admin SDK.
- **Sincronización SQL y estado activo:** `user_service.sync_firebase_user(db, decoded)` vincula `firebase_uid` (o `email`) con la tabla `users`, obtiene su rol desde `roles` y bloquea cuentas desactivadas (`is_active=False` → `403 Forbidden`).
- **RBAC:** `require_admin` restringe estrictamente `/api/v1/admin/users/*` al rol `admin` (`403` para otros roles) e impide que un administrador se auto-elimine, auto-desactive o se quite el rol `admin`.
- **Frontend:** `ProtectedRoute.tsx` exige sesión Firebase activa y `user.emailVerified === true` antes de renderizar `/dashboard/*` (redirige a `/login` o `/verify-email`).

### 6.2 CORS, Variables de Entorno y Cabeceras HTTP
- **CORS (`backend/app/main.py` + `config.py`):** Lista blanca estricta leída desde `CORS_ORIGINS`; el parser `cors_origins_list` elimina explícitamente wildcards `*` porque `allow_credentials=True` está habilitado. Métodos permitidos: `GET, POST, PATCH, DELETE, OPTIONS`; cabeceras permitidas: `Authorization, Content-Type, Accept`; expuestas: `Content-Disposition, X-RateLimit-Limit, X-RateLimit-Remaining`.
- **Cabeceras OWASP (`SecurityHeadersMiddleware`):** Adjunta a cada respuesta `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` y `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- **Configuración y secretos:** Cargados vía `pydantic-settings` (`backend/.env`) y `import.meta.env` (`frontend/.env`). OpenAPI (`/docs`, `/redoc`) se deshabilita automáticamente cuando `APP_ENV=production`. `.gitignore` excluye `.env`, `*firebase-adminsdk*.json`, `serviceAccountKey.json`, `*.db` y `backend/uploads/`.

### 6.3 Validación, Renombrado, Almacenamiento y Rate Limiting de Imágenes
- **Lectura acotada (`file_security.py`):** `validate_and_prepare_image` lee en bloques de `64 KB` y corta inmediatamente con `413 Request Entity Too Large` al exceder `MAX_UPLOAD_SIZE_MB` (`10 MB` por archivo).
- **Verificación de tipo por contenido real (Magic Bytes):** `detect_real_image_type` inspecciona bytes crudos (sin confiar en el header `Content-Type`):
  - PNG (`\x89PNG\r\n\x1a\n`), JPEG (`\xff\xd8\xff`), WEBP (`RIFF....WEBP`).
  - SVG: decodificación UTF-8, rechazo por regex previo al parser XML (`<script>`, `<foreignObject>`, `<iframe>`, `<object>`, `<embed>`, `<!ENTITY>`, `<!DOCTYPE>`, `on*=`, `javascript:`, `data:text/html`) y recorrido de árbol `ElementTree` validando etiqueta raíz `svg` y atributos por elemento.
- **Renombrado seguro y prevención de Path Traversal:** Todo archivo se renombra con UUID v4 (`orders/YYYY/MM/{uuid4().hex}{ext}`). El nombre original se sanitiza a ASCII (`[a-zA-Z0-9._-]`, máx. 100 chars) solo para metadatos. En fallback local, `StorageService._safe_local_path` exige `candidate.is_relative_to(LOCAL_UPLOADS_DIR)`.
- **Atomicidad ante errores:** `validate_order_item_uploads` valida todas las imágenes de un pedido multi-diseño antes de subir a Storage; `_upload_item_images_atomically` y el bloque `except` de SQL eliminan todos los blobs ya subidos si falla una subida o la transacción DB.
- **Rate Limiting (`rate_limit.py`):** `SlidingWindowRateLimiter` *thread-safe* aplicado a `POST /api/v1/public/orders` (`10` solicitudes por ventana de `60s` por IP; `TRUST_PROXY_HEADERS=False` por defecto para impedir spoofing de `X-Forwarded-For`). Responde `429` con cabecera `Retry-After` y expone `X-RateLimit-Limit` / `X-RateLimit-Remaining`.

---

## 7. Estado Actual y Pendientes

### 7.1 Funcionalidades 100% Operativas
- **Portal público multi-diseño (`/`)**: Creación de pedidos Maestro-Detalle con tarjetas dinámicas (`useFieldArray`), reglas condicionales independientes por tarjeta, zona de carga individual, simulador en vivo por diseño y pantalla de confirmación con resumen completo y link WhatsApp.
- **Backend Maestro-Detalle ACID + Firestore**: Creación, listado con filtros (incluyendo búsqueda por material/forma en ítems secundarios), edición financiera/estado, bitácoras de auditoría (`order_status_history`, `payments`), borrado en cascada con limpieza multi-archivo y descarga individual por ítem (`/items/{item_id}/image`).
- **Autenticación y gestión RBAC**: Login/registro/verificación/reset con Firebase Auth + Google OAuth, cambio/vinculación de contraseña y CRUD de usuarios con restauración administrativa de claves.
- **Catálogo CRUD de materiales**: Gestión completa respetando integridad referencial (`ON DELETE RESTRICT`) sobre `orders` y `order_items`.
- **Fase 2 — Módulo 1 (Mejora de Calidad, Retoque y CMYK)**: Operativo con OpenCV/NumPy/Pillow (`ImageEnhancerService` y `RetouchInpaintService`): escalado Lanczos-4 hasta 4x a 300 DPI, remoción de fondo algorítmica (`smart_subject`, `auto_color`, `grabcut`), calibración CMYK con telemetría TAC, borrador mágico *inpainting* (Telea/Navier-Stokes), detector de marcas de agua y exportación `PNG`/`TIFF CMYK`/`JPEG CMYK` o guardado directo al pedido.
- **Fase 2 — Módulo 2 (Troquelador Vectorial y EPS 2 Capas)**: Operativo con OpenCV/NumPy (`DieCutEdgeDetectorService` + `DieCutStudioPage`): modos silueta/circular/polígono, editor interactivo de nodos Bézier y exportación en `.EPS` (PostScript) o `.SVG` con Capa 1 (Diseño CMYK) y Capa 2 (`CutContour`).

### 7.2 En Desarrollo, Incompletas o Stubs
- **Fase 2 — Módulo 3 (`SheetLayoutPackerService` — Distribución en Pliego):** Implementado únicamente como *stub*. `POST /api/v1/image-processing/pack-layout` devuelve `501 Not Implemented`, `layout_packer.py` lanza `NotImplementedError` y sus librerías (`shapely`, `scipy`) están comentadas en `requirements.txt`.
- **Remoción de fondo con IA (`rembg` / `onnxruntime`):** Comentadas en `requirements.txt`; el sistema reporta `rembg_installed` dinámicamente vía `/capabilities` y actualmente utiliza algoritmos clásicos de OpenCV.
- **Procesamiento Fase 2 y Pedido Rápido Admin sobre pedidos multi-diseño:**
  - `QuickOrderModal.tsx` (panel interno) sigue enviando 1 solo diseño mediante campos legados en lugar de soportar múltiples tarjetas.
  - Los endpoints de `image_processing.py` (`enhance`, `save-to-order`, `retouch`, `detect-edges`) operan únicamente sobre `order.image` (diseño #1) y aún no aceptan `item_id` para procesar diseños #2..#N de forma individual.
- **Catálogo dinámico en portal público:** `PublicOrderForm` toma la lista de materiales desde `THEME_CONFIG.materials` (estático) en lugar de consumir `GET /api/v1/public/materials`.

### 7.3 Errores Conocidos, Riesgos de Seguridad y Deuda Técnica Detectada
1. **Riesgo de DoS por amplificación de carga y desalineación de límite de diseños (`Alta`):**
   - `config.py` define `MAX_ORDER_ITEMS=10`, `MAX_TOTAL_ORDER_UPLOAD_MB=30` y `MAX_ITEMS_JSON_BYTES=32768`, pero **`MAX_TOTAL_ORDER_UPLOAD_MB` y `MAX_ITEMS_JSON_BYTES` no se aplican aún** en `public_orders.py` ni `file_security.py`. Además, `schemas/order.py` (`MAX_ORDER_ITEMS_LIMIT=50`) y `frontend/src/schemas/order.schema.ts` (`MAX_ORDER_DESIGNS=50`) siguen permitiendo hasta 50 diseños.
   - `validate_order_item_uploads` mantiene todos los `ValidatedImageFile` en RAM simultáneamente y no cierra explícitamente cada `UploadFile` (`await upload.close()`) en bloque `finally` ante fallos parciales.
2. **Brechas en validación MIME/extensión y hardening SVG (`Alta`):**
   - En `file_security.py`, `ALLOWED_EXTENSIONS` está declarado pero no se valida; tampoco se contrasta el header `Content-Type` declarado contra los magic bytes reales.
   - `_is_valid_safe_svg` no bloquea etiquetas `<animate>`, `<set>`, `<?xml-stylesheet`, atributos con `data:image/svg+xml` / `vbscript:` o referencias externas `http(s)://` en `href`/`xlink:href`/`<style>`.
   - `admin_orders.py` (`_build_image_response`) sirve SVGs con `Content-Disposition: inline` sin cabecera `Content-Security-Policy: default-src 'none'; sandbox`.
3. **RBAC incompleto en endpoints administrativos (`Alta`):**
   - Solo `/admin/users` exige `require_admin`. Los routers `/admin/orders`, `/admin/materials`, `/dashboard` e `/image-processing` solo validan `get_current_user`, por lo que un usuario con rol `cliente` podría invocarlos si se le asigna dicho rol. Adicionalmente, `sync_firebase_user` promueve automáticamente a `operador` a cualquier nuevo usuario no-inicial registrado en Firebase Auth.
4. **Integridad en ingesta pública (`Media`):**
   - `POST /api/v1/public/orders` acepta `received_at` opcional desde el cliente anónimo, permitiendo falsificar la fecha usada para auditoría y KPIs de ventas (`today_sales_total`, `month_sales_total`).
   - `OrderCreateInput` no valida que la suma `total_quantity` sea `<= 1,000,000` antes de subir las imágenes, pudiendo provocar un `IntegrityError` tardío en SQL (`chk_orders_quantity`) después del upload.
5. **Escalabilidad y mantenimiento (`Media`/`Baja`):**
   - `order_service.list_orders` carga todos los pedidos en memoria y aplica filtros en Python en vez de cláusulas SQL `WHERE`.
   - `SlidingWindowRateLimiter` es en memoria por proceso (no distribuido entre múltiples workers y sin limpieza periódica de claves inactivas).
   - `StorageService.delete_order_image` intenta consultar el bucket de Firebase incluso cuando `STORAGE_BACKEND="local"`, produciendo timeouts de red en entornos aislados.
   - Existe un archivo local de credenciales de servicio (`backend/siete-impresiones-firebase-adminsdk-*.json`) dentro de la carpeta del proyecto; aunque está excluido en `.gitignore`, se recomienda reubicarlo fuera del árbol del repositorio en despliegues y estaciones de trabajo.
   - En `image_processing.py` (`export_die_cut_file`), el avance opcional de estado envuelve `db.commit()` en un `except Exception: db.rollback()` silencioso sin logging.
