import { initializeApp } from 'firebase/app'
import { getFirestore, addDoc, collection, serverTimestamp } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId)
const app = isConfigured ? initializeApp(firebaseConfig) : null
const db = app ? getFirestore(app) : null

export async function saveEmergencyEvent(message) {
  if (!db) return false
  await addDoc(collection(db, 'emergency_events'), {
    message,
    createdAt: serverTimestamp(),
  })
  return true
}

export function firebaseEnabled() {
  return Boolean(db)
}
