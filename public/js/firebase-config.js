/**
 * SecureC - Firebase Authentication Configuration & Helper Library
 * 
 * Instructions:
 * Replace the placeholder values in `firebaseConfig` below with your real project
 * credentials from the Firebase Console (https://console.firebase.google.com/).
 * 
 * Enabled Providers:
 * - Email / Password
 * - Google Sign-In
 * - Phone Number (SMS OTP via reCAPTCHA)
 */

// Live Firebase project configuration for SecureC:
const firebaseConfig = {
  apiKey: "AIzaSyCdNyXHvMSGo6ASAKTj7sdvTESEhNwmgrY",
  authDomain: "sc-messenger-scm.firebaseapp.com",
  projectId: "sc-messenger-scm",
  storageBucket: "sc-messenger-scm.firebasestorage.app",
  messagingSenderId: "101434037247",
  appId: "1:101434037247:web:f638e6dee3a1266cb24dca",
  measurementId: "G-2DDK9EV7EB"
};

// State flag to detect whether real Firebase config is provided
let isFirebaseConfigured = false;

// Initialize Firebase if SDK is loaded and valid real config is present
if (typeof firebase !== 'undefined') {
  try {
    const isPlaceholderKey = !firebaseConfig.apiKey ||
      firebaseConfig.apiKey.includes("YOUR_FIREBASE_API_KEY") ||
      firebaseConfig.apiKey.includes("EXAMPLE_KEY");

    if (!isPlaceholderKey) {
      firebase.initializeApp(firebaseConfig);
      isFirebaseConfigured = true;
      console.log("Firebase initialized successfully with live project credentials.");
    } else {
      console.warn("Firebase Config contains placeholder values. Running in Demo Auth Mode.");
    }
  } catch (err) {
    console.error("Firebase Initialization Error:", err);
  }
} else {
  console.warn("Firebase SDK library not loaded.");
}

/**
 * Sign up user with Email and Password & send email verification link
 */
async function signUpWithEmail(email, password) {
  if (!isFirebaseConfigured) {
    throw new Error("Firebase is not configured with live credentials. Use Quick Guest Access or add your Firebase keys.");
  }
  try {
    const credential = await firebase.auth().createUserWithEmailAndPassword(email, password);
    if (credential.user) {
      await credential.user.sendEmailVerification();
    }
    return {
      user: credential.user,
      isVerificationSent: true
    };
  } catch (firebaseErr) {
    console.error("Firebase SignUp Error:", firebaseErr);
    throw firebaseErr;
  }
}

/**
 * Sign in user with Email and Password (requires verified email)
 */
async function signInWithEmail(email, password) {
  if (!isFirebaseConfigured) {
    throw new Error("Firebase is not configured with live credentials. Use Quick Guest Access or add your Firebase keys.");
  }
  try {
    const credential = await firebase.auth().signInWithEmailAndPassword(email, password);
    
    // Require real email verification before allowing access
    if (credential.user && !credential.user.emailVerified) {
      const err = new Error("Your email address is not verified yet. Please check your inbox and click the verification link sent to your email.");
      err.code = 'auth/email-not-verified';
      err.user = credential.user;
      throw err;
    }

    return credential;
  } catch (firebaseErr) {
    console.error("Firebase SignIn Error:", firebaseErr);
    throw firebaseErr;
  }
}

/**
 * Resend Verification Email to currently signing-in user
 */
async function resendVerificationEmail(user) {
  if (user && typeof user.sendEmailVerification === 'function') {
    await user.sendEmailVerification();
  } else if (firebase.auth().currentUser) {
    await firebase.auth().currentUser.sendEmailVerification();
  } else {
    throw new Error("No user session found to resend verification email.");
  }
}

/**
 * Sign in user with Google Auth Pop-up
 */
async function signInWithGoogle() {
  if (!isFirebaseConfigured) {
    throw new Error("Firebase is not configured with live credentials. Use Quick Guest Access or add your Firebase keys.");
  }
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    const credential = await firebase.auth().signInWithPopup(provider);
    return credential;
  } catch (firebaseErr) {
    console.error("Firebase Google Auth Error:", firebaseErr);
    throw firebaseErr;
  }
}



/**
 * Sign out current user
 */
async function signOutUser() {
  if (isFirebaseConfigured && typeof firebase !== 'undefined' && firebase.auth().currentUser) {
    await firebase.auth().signOut();
  }
  localStorage.removeItem('securec_token');
  localStorage.removeItem('securec_refresh_token');
}

/**
 * Listen to Auth State Changes
 */
function onAuthStateChangedListener(callback) {
  if (isFirebaseConfigured && typeof firebase !== 'undefined') {
    firebase.auth().onAuthStateChanged((user) => {
      callback(user);
    });
  }
}
