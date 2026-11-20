import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  linkWithCredential,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  updateProfile,
  type User,
} from "firebase/auth";
import {
  firebaseAuth,
  googleProvider,
  isFirebaseClientConfigured,
} from "@/config/firebase";
import { usersService } from "@/services/users.service";
import type { UserProfile } from "@/types/order";

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isConfigured: boolean;
  hasPasswordProvider: boolean;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (name: string, email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  refreshEmailVerification: () => Promise<boolean>;
  changeOwnPassword: (currentPassword: string, newPassword: string) => Promise<void>;
  linkPasswordToGoogleAccount: (newPassword: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
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
    "auth/wrong-password": "La contraseña actual ingresada es incorrecta.",
    "auth/email-already-in-use": "Este correo ya está registrado. Intenta iniciar sesión.",
    "auth/weak-password": "La contraseña es demasiado débil (usa al menos 8 caracteres con letras y números).",
    "auth/invalid-email": "El formato del correo electrónico no es válido.",
    "auth/requires-recent-login":
      "Por seguridad, cierra sesión y vuelve a ingresar antes de cambiar tu contraseña.",
    "auth/provider-already-linked": "Tu cuenta ya tiene una contraseña vinculada.",
    "auth/popup-closed-by-user": "Se cerró la ventana de Google antes de completar el acceso.",
    "auth/popup-blocked":
      "Tu navegador bloqueó la ventana emergente de Google. Permítela e intenta nuevamente.",
    "auth/unauthorized-domain": `El dominio actual (${window.location.hostname}) no está autorizado en Firebase Auth. Abre http://localhost:${window.location.port || "5173"}/login o agrega "${window.location.hostname}" en Firebase Console → Authentication → Settings → Authorized domains.`,
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
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(isFirebaseClientConfigured);

  const loadBackendProfile = useCallback(async (firebaseUser: User | null) => {
    if (!firebaseUser) {
      setProfile(null);
      return;
    }
    try {
      const data = await usersService.getMyProfile();
      setProfile(data);
    } catch {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    if (!firebaseAuth) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser) => {
      setUser(firebaseUser);
      await loadBackendProfile(firebaseUser);
      setLoading(false);
    });
    return unsubscribe;
  }, [loadBackendProfile]);

  const hasPasswordProvider = Boolean(
    user?.providerData.some((p) => p.providerId === "password")
  );

  const loginWithEmail = async (email: string, password: string) => {
    const auth = assertFirebaseReady();
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      await loadBackendProfile(cred.user);
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
      // Send mandatory email verification link on registration
      await sendEmailVerification(cred.user, {
        url: `${window.location.origin}/login`,
      });
      setUser(auth.currentUser);
      await loadBackendProfile(cred.user);
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
      const cred = await signInWithPopup(auth, googleProvider);
      await loadBackendProfile(cred.user);
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

  const resendVerificationEmail = async () => {
    const auth = assertFirebaseReady();
    if (!auth.currentUser) {
      throw new Error("No hay una sesión activa.");
    }
    try {
      await sendEmailVerification(auth.currentUser, {
        url: `${window.location.origin}/login`,
      });
    } catch (err) {
      throw mapFirebaseError(err);
    }
  };

  const refreshEmailVerification = async (): Promise<boolean> => {
    const auth = assertFirebaseReady();
    if (!auth.currentUser) return false;
    try {
      await auth.currentUser.reload();
      await auth.currentUser.getIdToken(true);
      const verified = Boolean(auth.currentUser.emailVerified);
      setUser({ ...auth.currentUser } as User);
      if (verified) {
        const synced = await usersService.syncEmailVerification();
        setProfile(synced);
      }
      return verified;
    } catch (err) {
      throw mapFirebaseError(err);
    }
  };

  const changeOwnPassword = async (currentPassword: string, newPassword: string) => {
    const auth = assertFirebaseReady();
    const current = auth.currentUser;
    if (!current || !current.email) {
      throw new Error("No hay una sesión activa válida.");
    }
    try {
      const credential = EmailAuthProvider.credential(current.email, currentPassword);
      await reauthenticateWithCredential(current, credential);
      await updatePassword(current, newPassword);
    } catch (err) {
      throw mapFirebaseError(err);
    }
  };

  const linkPasswordToGoogleAccount = async (newPassword: string) => {
    const auth = assertFirebaseReady();
    const current = auth.currentUser;
    if (!current || !current.email) {
      throw new Error("No hay una sesión activa válida.");
    }
    try {
      const credential = EmailAuthProvider.credential(current.email, newPassword);
      await linkWithCredential(current, credential);
      await current.reload();
      setUser({ ...current } as User);
    } catch (err) {
      throw mapFirebaseError(err);
    }
  };

  const refreshProfile = async () => {
    await loadBackendProfile(firebaseAuth?.currentUser ?? null);
  };

  const logout = async () => {
    const auth = assertFirebaseReady();
    await signOut(auth);
    setProfile(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        isConfigured: isFirebaseClientConfigured,
        hasPasswordProvider,
        loginWithEmail,
        registerWithEmail,
        loginWithGoogle,
        sendPasswordReset,
        resendVerificationEmail,
        refreshEmailVerification,
        changeOwnPassword,
        linkPasswordToGoogleAccount,
        refreshProfile,
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
