# SIETE · Sticker Studio — Sistema Web Integral para Imprenta de Stickers (Fase 1)

Plataforma web full-stack modular para gestión de ventas, recepción pública de pedidos de stickers y panel administrativo seguro, con arquitectura preparada para integrar en **Fase 2** módulos de procesamiento de imágenes, mejora de calidad, troquelado automático con IA (`OpenCV + rembg / U2-Net`) y distribución óptima en pliego con Python.

---

## 1. Stack Tecnológico

- **Frontend (`/frontend`):** React 18, TypeScript, Vite, Tailwind CSS, Framer Motion, Lucide React, React Router DOM, React Hook Form + Zod, Firebase Web SDK.
- **Backend (`/backend`):** Python 3.11+, FastAPI, Pydantic v2, Uvicorn, `firebase-admin` (verificación JWT, Firestore y Firebase Storage).
- **Identidad Visual:** Paleta **monocromática Cobalt-Slate** con soporte **Modo Claro / Modo Oscuro** (contraste WCAG AA), bordes tipo línea de corte (*die-cut dashed borders*), badges tipo pegatina (*sticker badges*), efecto *sticker peel hover* y Design Tokens 100% centralizados.

---

## 2. Arquitectura y Árbol de Directorios

```text
Siete/
├── .gitignore
├── README.md
├── backend/
│   ├── .env.example
│   ├── pytest.ini
│   ├── requirements.txt
│   ├── app/
│   │   ├── main.py                        # App FastAPI, CORS estricto, headers de seguridad
│   │   ├── core/
│   │   │   ├── config.py                  # Configuración por variables de entorno (Pydantic Settings)
│   │   │   ├── firebase.py                # Inicialización Firebase Admin (Auth, Firestore, Storage)
│   │   │   ├── security.py                # Dependencia JWT get_current_user + SecurityHeadersMiddleware
│   │   │   ├── file_security.py           # Validación magic-bytes MIME, sanitización SVG y renombrado UUID
│   │   │   └── rate_limit.py              # Rate Limiting ventana deslizante para endpoint público
│   │   ├── schemas/
│   │   │   ├── order.py                   # Reglas de negocio estrictas Pydantic v2
│   │   │   ├── dashboard.py               # KPIs y cola prioritaria
│   │   │   └── image_processing.py        # Contratos Fase 2
│   │   ├── services/
│   │   │   ├── storage_service.py         # Subida, descarga segura y rollback en Firebase Storage
│   │   │   └── order_service.py           # CRUD Firestore, cálculo de saldo y métricas KPI
│   │   ├── routers/
│   │   │   ├── health.py                  # GET /api/v1/health
│   │   │   ├── public_orders.py           # POST /api/v1/public/orders (con rate limiting)
│   │   │   ├── admin_orders.py            # CRUD pedidos, ventas y descarga segura (JWT obligatorio)
│   │   │   ├── dashboard.py               # GET /api/v1/dashboard/summary (JWT obligatorio)
│   │   │   └── image_processing.py        # Stubs protegidos Fase 2 (501 Not Implemented)
│   │   └── modules/
│   │       └── image_processing/          # Arquitectura modular lista para Fase 2
│   │           ├── base.py                # Interfaces base y DTOs
│   │           ├── enhancer.py            # Stub: mejora de resolución/calidad (OpenCV + NumPy)
│   │           ├── edge_detector.py       # Stub: troquelado IA (OpenCV + rembg/U2-Net)
│   │           └── layout_packer.py       # Stub: distribución óptima en pliego
│   └── tests/
│       ├── test_order_validation.py       # Pruebas de reglas de negocio condicionales
│       ├── test_file_security.py          # Pruebas de firmas binarias y XSS en SVG
│       └── test_rate_limit.py             # Pruebas de límite de peticiones
└── frontend/
    ├── .env.example
    ├── index.html
    ├── package.json
    ├── postcss.config.js
    ├── tailwind.config.ts
    ├── tsconfig.json
    ├── vite.config.ts
    ├── public/brand/
    │   ├── favicon.svg
    │   └── logo-mark.svg
    └── src/
        ├── App.tsx
        ├── main.tsx
        ├── styles/
        │   ├── tokens.css                 # Tokens monocromáticos Light/Dark, radios, sombras, tipografía
        │   └── globals.css                # Utilidades die-cut, sticker-peel, sticker-badge, print-grid
        ├── config/
        │   ├── theme.config.ts            # Branding, textos, materiales, formas, moneda y horarios
        │   ├── animations.ts              # Presets centralizados de Framer Motion
        │   ├── env.ts                     # Variables de entorno Vite
        │   └── firebase.ts                # Firebase Auth & Google OAuth Provider
        ├── types/order.ts
        ├── schemas/
        │   ├── order.schema.ts            # Validación Zod espejo del backend
        │   └── auth.schema.ts
        ├── services/
        │   ├── api.ts                     # Cliente HTTP con inyección automática de Bearer JWT
        │   ├── orders.service.ts
        │   └── imageProcessing.service.ts
        ├── contexts/
        │   ├── AuthContext.tsx
        │   └── ThemeContext.tsx
        ├── hooks/
        │   ├── useOrders.ts
        │   └── useToast.tsx
        ├── utils/date.ts
        ├── components/
        │   ├── ui/                        # BrandLogo, Button, Input, Select, Modal, StickerBadge, StickerCard, ThemeToggle, ToastContainer
        │   ├── layout/                    # PublicHeader, DashboardLayout, ProtectedRoute
        │   ├── orders/                    # PublicOrderForm, StickerDropzone, LiveStickerPreview, OrderConfirmation, OrderDetailModal, OrdersTable, OrdersCardGrid, QuickOrderModal
        │   └── dashboard/                 # KpiGrid, QuickActions, PendingQueue, Phase2PreviewModal
        └── pages/
            ├── PublicOrderPage.tsx        # /
            ├── LoginPage.tsx              # /login
            ├── RegisterPage.tsx           # /register
            ├── ForgotPasswordPage.tsx     # /forgot-password
            ├── DashboardHomePage.tsx      # /dashboard
            └── OrdersManagementPage.tsx   # /dashboard/orders
```

---

## 3. Configuración de Firebase (Paso a Paso)

1. Ingresa a [Firebase Console](https://console.firebase.google.com/) y crea un nuevo proyecto (por ejemplo, `siete-sticker-studio`).
2. **Activa Firebase Authentication:**
   - Ve a **Build -> Authentication -> Get Started**.
   - En la pestaña **Sign-in method**, habilita:
     - **Correo electrónico/contraseña** (*Email/Password*).
     - **Google** (configura el correo de soporte del proyecto y guarda).
   - En **Templates -> Password reset**, verifica la plantilla de correo de restablecimiento (funciona directamente con Gmail y otros correos).
   - En **Settings -> Authorized domains**, confirma que `localhost` esté incluido.
3. **Activa Cloud Firestore:**
   - Ve a **Build -> Firestore Database -> Create database**.
   - Inicia en **modo producción** (todo acceso a datos se canaliza de forma segura a través del backend FastAPI con `firebase-admin`).
   - Reglas recomendadas en Firestore (bloquea acceso directo anónimo desde cliente):
     ```js
     rules_version = '2';
     service cloud.firestore {
       match /databases/{database}/documents {
         match /{document=**} {
           allow read, write: if false;
         }
       }
     }
     ```
4. **Activa Firebase Storage:**
   - Ve a **Build -> Storage -> Get started** (modo producción).
   - Reglas recomendadas (el backend valida los archivos y los sube/descarga vía Admin SDK):
     ```js
     rules_version = '2';
     service firebase.storage {
       match /b/{bucket}/o {
         match /{allPaths=**} {
           allow read, write: if false;
         }
       }
     }
     ```
   - Copia el nombre de tu bucket (ej. `tu-proyecto.firebasestorage.app`).
5. **Obtén credenciales para el Frontend (Web App):**
   - Ve a **Project Settings -> General -> Your apps -> Web (`</>`)**.
   - Registra la app web y copia `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId` y `appId`.
6. **Obtén la Cuenta de Servicio para el Backend (`firebase-admin`):**
   - Ve a **Project Settings -> Service accounts -> Generate new private key**.
   - Guarda el archivo JSON descargado como `backend/firebase-service-account.json` (ya está ignorado en `.gitignore`; **nunca** lo subas a Git).

---

## 4. Configuración de Variables de Entorno

### Backend (`backend/.env`)

Copia `backend/.env.example` a `backend/.env`:

```powershell
Copy-Item backend\.env.example backend\.env
```

Edita `backend/.env` con tus valores reales:

```env
APP_NAME="Siete Sticker Studio API"
APP_ENV=development
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
FIREBASE_CREDENTIALS_PATH=./firebase-service-account.json
FIREBASE_STORAGE_BUCKET=tu-proyecto.firebasestorage.app
MAX_UPLOAD_SIZE_MB=10
DELIVERY_HOUR_START=8
DELIVERY_HOUR_END=20
TIMEZONE_OFFSET_MINUTES=-240
RATE_LIMIT_PUBLIC_ORDERS_REQUESTS=10
RATE_LIMIT_PUBLIC_ORDERS_WINDOW_SECONDS=60
```

### Frontend (`frontend/.env`)

Copia `frontend/.env.example` a `frontend/.env`:

```powershell
Copy-Item frontend\.env.example frontend\.env
```

Edita `frontend/.env`:

```env
VITE_API_BASE_URL=http://localhost:8000/api/v1
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=tu-proyecto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=tu-proyecto
VITE_FIREBASE_STORAGE_BUCKET=tu-proyecto.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
VITE_FIREBASE_APP_ID=1:123456789012:web:abcdef123456
```

---

## 5. Ejecución Local en Windows (PowerShell y CMD)

Abre **dos terminales** en la carpeta raíz del proyecto (`Siete/`).

### Terminal 1 — Backend FastAPI

**En PowerShell:**
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**En CMD (Símbolo del sistema):**
```cmd
cd backend
python -m venv .venv
.venv\Scripts\activate.bat
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

- Documentación interactiva Swagger: `http://127.0.0.1:8000/docs`
- Healthcheck: `http://127.0.0.1:8000/api/v1/health`

### Terminal 2 — Frontend React + Vite

**En PowerShell o CMD:**
```powershell
cd frontend
npm install
npm run dev
```

- Portal Público de Pedidos: `http://localhost:5173/`
- Inicio de Sesión: `http://localhost:5173/login`
- Panel Administrativo: `http://localhost:5173/dashboard`
- Gestión de Pedidos y Ventas: `http://localhost:5173/dashboard/orders`

---

## 6. Pruebas Automatizadas y Validación de Build

### Pruebas unitarias del Backend (reglas de negocio, seguridad de archivos y rate limit)
```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pytest
```

### Verificación de tipos y build de producción del Frontend
```powershell
cd frontend
npm run typecheck
npm run build
```

---

## 7. Personalización Total (Design Tokens y Animaciones)

- **Cambiar paleta monocromática, radios o sombras:** edita únicamente [`frontend/src/styles/tokens.css`](frontend/src/styles/tokens.css). Todos los componentes y clases Tailwind consumen esas variables CSS automáticamente.
- **Cambiar nombre de marca, logo, moneda (`Bs.` / `$`), WhatsApp, horarios de entrega o textos:** edita únicamente [`frontend/src/config/theme.config.ts`](frontend/src/config/theme.config.ts).
- **Ajustar o desactivar animaciones Framer Motion:** cambia `ANIMATIONS_ENABLED` o las variantes en [`frontend/src/config/animations.ts`](frontend/src/config/animations.ts).

---

## 8. Preparación para Fase 2 (OpenCV + NumPy + IA)

Los contratos e interfaces base ya están integrados en `backend/app/modules/image_processing/`:
- `enhancer.py` (`ImageEnhancerService`): mejora de nitidez y escalado a 300 DPI.
- `edge_detector.py` (`DieCutEdgeDetectorService`): eliminación de fondo con `rembg`/U2-Net y generación de trazado de troquelado SVG/DXF.
- `layout_packer.py` (`SheetLayoutPackerService`): algoritmo 2D de anidado óptimo de stickers en pliego.

Para habilitar las librerías científicas en Fase 2, descomenta la sección correspondiente en `backend/requirements.txt` y ejecuta `pip install -r requirements.txt`.
