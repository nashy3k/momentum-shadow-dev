'use server';

import { db } from '@/lib/db';
import { FieldValue } from '@google-cloud/firestore';

export async function submitPatronRequest(repoUrl: string) {
    try {
        // Basic sanitization
        const cleanRepo = repoUrl.trim().replace(/^https?:\/\/github\.com\//, '');

        const request = {
            repoRef: cleanRepo,
            status: 'PENDING',
            timestamp: FieldValue.serverTimestamp(),
            requestedAt: new Date().toISOString()
        };

        await db.collection('patron_requests').add(request);

        return { success: true };
    } catch (err: any) {
        console.error('[Actions] Patron Request Error:', err);
        return { success: false, error: err.message };
    }
}
