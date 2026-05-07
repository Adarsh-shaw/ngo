import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// TODO: Replace this with your actual Firebase project configuration
const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
  measurementId: ""
};

let app, auth, provider;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  provider = new GoogleAuthProvider();
} catch (error) {
  console.error("Firebase initialization error:", error);
}

export const signInWithGoogle = async () => {
  if (!auth) {
    throw new Error("Firebase is not configured! Please update public/js/firebase-auth.js with your config.");
  }

  try {
    const result = await signInWithPopup(auth, provider);
    // Get the ID token
    const idToken = await result.user.getIdToken();

    // Send ID token to our backend
    const response = await fetch('/api/auth/google', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ idToken })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Backend authentication failed');
    }

    return data; // returns { token, user }
  } catch (error) {
    console.error("Google sign in error:", error);
    throw error;
  }
};
