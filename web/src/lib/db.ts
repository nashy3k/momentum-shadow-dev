import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';
import * as fs from 'fs';

if (getApps().length === 0) {
    // Look for key in root (parent of /web)
    const keyPath = path.resolve(process.cwd(), '..', 'service-account-key.json');

    if (fs.existsSync(keyPath)) {
        initializeApp({
            credential: cert(keyPath),
            projectId: 'momentum-shadow-dev-4321'
        });
    } else {
        // Fallback for cloud environment where env vars or ADC might exist
        initializeApp({
            projectId: 'momentum-shadow-dev-4321'
        });
    }
}

export const db = getFirestore();
