import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Configuration from firebase-applet-config.json
const firebaseConfig = {
  apiKey: "AIzaSyDwiNcYle5gH9L6cMrAcBeRGMOp993owE4",
  authDomain: "gen-lang-client-0840501283.firebaseapp.com",
  projectId: "gen-lang-client-0840501283",
  storageBucket: "gen-lang-client-0840501283.firebasestorage.app",
  messagingSenderId: "789107774584",
  appId: "1:789107774584:web:df47a24c0d633e804ec98d"
};

const databaseId = "ai-studio-lenslogicai-7afa3b4e-b90f-4386-afa3-952d3c571847";

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication
export const auth = getAuth(app);

// Initialize Cloud Firestore with custom database ID
export const db = getFirestore(app, databaseId);

export default app;
