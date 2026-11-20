import React, { createContext, useContext, useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import {
  firebaseAuth,
  googleProvider,
  isFirebaseClientConfigured,
} from "@/config/firebase";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  isConfigured: boolean;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (name: string, email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function mapFirebaseError(error: unknown): Error {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: string }).code)
      : "";

  const messages: Record<string, string> = {
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/user-not-found": "No existe una cuenta registrada con ese correo.",
    "auth/wrong-password": "La contraseña ingresada es incorrecta.",
    "auth/email-already-in-use": "Este correo ya está registrado. Intenta iniciar sesión.",
    "auth/weak-password": "La contraseña es demasiado débil (usa al menos 6 caracteres).",
    "auth/invalid-email": "El formato del correo electrónico no es válido.",
    "auth/popup-closed-by-user": "Se cerró la ventana de Google antes de completar el acceso.",
    "auth/popup-blocked": "Tu navegador bloqueó la ventana emergente de Google. Permítela e intenta nuevamente.",
    "auth/unauthorized-domain":
      `El dominio actual (${window.location.hostname}) no está autorizado en Firebase Auth. Abre http://localhost:${window.location.port || "5173"}/login o agrega "${window.location.hostname}" en Firebase Console → Authentication → Settings → Authorized domains.`,
    "auth/operation-not-allowed":
      "Este proveedor de inicio de sesión aún no está habilitado en Firebase Console (Authentication -> Sign-in method).",
    "auth/too-many-requests": "Demasiados intentos. Espera unos minutos antes de reintentar.",
    "auth/network-request-failed": "Error de red al conectar con Firebase Authentication.",
  };

  return new Error(
    messages[code] ||
      (error instanceof Error ? error.message : "Ocurrió un error de autenticación.")
  );
}

function assertFirebaseReady(): NonNullable<typeof firebaseAuth> {
  if (!firebaseAuth) {
    throw new Error(
      "Firebase no está configurado en frontend/.env. Revisa el README para ingresar tus claves."
    );
  }
  return firebaseAuth;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(isFirebaseClientConfigured);

  useEffect(() => {
    if (!firebaseAuth) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const loginWithEmail = async (email: string, password: string) => {
    const auth = assertFirebaseReady();
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      throw mapFirebaseError(err);
    }
  };

  const registerWithEmail = async (name: string, email: string, password: string) => {
    const auth = assertFirebaseReady();
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      if (name.trim()) {
        await updateProfile(cred.user, { displayName: name.trim() });
      }
      setUser({ ...cred.user, displayName: name.trim() } as User);
    } catch (err) {
      throw mapFirebaseError(err);
    }
  };

  const loginWithGoogle = async () => {
    const auth = assertFirebaseReady();
    if (!googleProvider) {
      throw new Error("Google OAuth provider no inicializado.");
    }
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      throw mapFirebaseError(err);
    }
  };

  const sendPasswordReset = async (email: string) => {
    const auth = assertFirebaseReady();
    try {
      await sendPasswordResetEmail(auth, email.trim(), {
        url: `${window.location.origin}/login`,
      });
    } catch (err) {
      throw mapFirebaseError(err);
    }
  };

  const logout = async () => {
    const auth = assertFirebaseReady();
    await signOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isConfigured: isFirebaseClientConfigured,
        loginWithEmail,
        registerWithEmail,
        loginWithGoogle,
        sendPasswordReset,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth debe usarse dentro de AuthProvider.");
  }
  return ctx;
}
