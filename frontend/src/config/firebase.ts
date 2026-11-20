import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";
import { env, isFirebaseClientConfigured } from "./env";

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;
let googleProvider: GoogleAuthProvider | null = null;

if (isFirebaseClientConfigured) {
  firebaseApp = initializeApp(env.firebase);
  firebaseAuth = getAuth(firebaseApp);
  firebaseAuth.languageCode = "es";

  googleProvider = new GoogleAuthProvider();
  googleProvider.setCustomParameters({ prompt: "select_account" });
}

export { firebaseApp, firebaseAuth, googleProvider, isFirebaseClientConfigured };
