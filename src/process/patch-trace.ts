import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';

const keyPath = path.resolve(process.cwd(), 'service-account-key.json');

if (fs.existsSync(keyPath)) {
    initializeApp({
        credential: cert(keyPath),
        projectId: 'momentum-shadow-dev-4321'
    });
} else {
    initializeApp({
        projectId: 'momentum-shadow-dev-4321'
    });
}

const db = getFirestore();

async function patchTrace() {
    const docId = 'nashy3k-autism-comm-cards';
    // Using the real 'Detailed' trace ID from the user's screenshot
    const sampleTraceId = '019c2743-98dc-770b-af1a-c0cb70ebc72a';

    console.log(`[Patch] Injecting trace ID ${sampleTraceId} for ${docId}...`);

    try {
        await db.collection('repositories').doc(docId).set({
            opikTraceId: sampleTraceId
        }, { merge: true });
        console.log('✅ Trace ID patched! Button should appear on refresh.');
    } catch (err) {
        console.error('❌ Failed:', err);
    }
}

patchTrace();
