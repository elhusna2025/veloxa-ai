import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, initializeFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

function adminApp() {
  return getApps().find(app => app.name === 'veloxa-server') || initializeApp({
    credential: applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'veloxa-ai-saas',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'veloxa-ai-saas.firebasestorage.app',
  }, 'veloxa-server');
}

export const adminAuth = () => getAuth(adminApp());
export const adminDb = () => {
  const app = adminApp();
  try { return initializeFirestore(app, { preferRest: true }); } catch { return getFirestore(app); }
};
export const adminBucket = () => getStorage(adminApp()).bucket();
