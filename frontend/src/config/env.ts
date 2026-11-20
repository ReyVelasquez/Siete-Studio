/**
 * Strictly environment-driven frontend configuration.
 * Never hardcode API keys or secrets here — populate frontend/.env from .env.example.
 */

export const env = {
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api/v1").replace(/\/+$/, ""),
  firebase: {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || undefined,
  },
} as const;

export const isFirebaseClientConfigured = Boolean(
  env.firebase.apiKey &&
    env.firebase.authDomain &&
    env.firebase.projectId &&
    !env.firebase.apiKey.startsWith("your_")
);
