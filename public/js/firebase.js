// Init de Firebase v10 (app, App Check, Firestore, Auth).
// DEBE ser el primer import de main.js: App Check tiene que existir antes de usar Firestore/IA.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
// App Check (reCAPTCHA v3): verifica que las llamadas vengan de esta app real (protege datos y cuota de IA)
import { initializeAppCheck, ReCaptchaV3Provider } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js';

export { collection, getDocs, addDoc, deleteDoc, updateDoc, doc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
export { signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
export { getToken as getAppCheckToken } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js';

export const firebaseConfig = {
    apiKey: "AIzaSyCiRD6oqLCxcqf8jNL5lf2CJVqzslpYIsE",
    authDomain: "llama-repostera-app.firebaseapp.com",
    projectId: "llama-repostera-app",
    storageBucket: "llama-repostera-app.firebasestorage.app",
    messagingSenderId: "1068969810874",
    appId: "1:1068969810874:web:90b68af4eec3ab4598db83"
};

const firebaseApp = initializeApp(firebaseConfig);

// App Check — clave de sitio reCAPTCHA v3 (pública).
export const APP_CHECK_SITE_KEY = '6LeLIT0tAAAAAHO0Knz6sBMTrxgg4xs64Lt1UDhA';
export const appCheck = initializeAppCheck(firebaseApp, {
    provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true
});

export const db = getFirestore(firebaseApp);
export const auth = getAuth(firebaseApp);
export const googleProvider = new GoogleAuthProvider();
