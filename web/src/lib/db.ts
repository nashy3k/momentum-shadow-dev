import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';
import * as fs from 'fs';

if (getApps().length === 0) {
    // 1. Try Local Service Account Key (for local dev)
    const keyPath = path.resolve(process.cwd(), '..', 'service-account-key.json');

    if (fs.existsSync(keyPath)) {
        initializeApp({
            credential: cert(keyPath),
            projectId: 'momentum-shadow-dev-4321'
        });
        console.log('[DB] Initialized with local Service Account Key.');
    } else {
        // 2. Production Fallback (Google Cloud environment)
        // initializeApp() will automatically pick up Application Default Credentials 
        // when running on App Hosting / Cloud Run.
        initializeApp({
            projectId: 'momentum-shadow-dev-4321'
        });
        console.log('[DB] Initialized with Application Default Credentials.');
    }
}

export const db = getFirestore();
