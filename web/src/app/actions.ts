'use server';

import { db } from '@/lib/db';
import { FieldValue } from '@google-cloud/firestore';
import { auth } from '@/auth';

export async function submitPatronRequest(repoUrl: string) {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: 'Unauthorized: You must be logged in with Discord to request patronage.' };
        }

        // Basic sanitization
        const cleanRepo = repoUrl.trim().replace(/^https?:\/\/github\.com\//, '');

        // Strict format validation (owner/repo)
        if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(cleanRepo)) {
            return { success: false, error: 'Invalid repository format. Please use owner/repo.' };
        }

        const request = {
            repoRef: cleanRepo,
            status: 'PENDING',
            discordId: session.user.id || null, // If available
            email: session.user.email || null,
            timestamp: new Date().toISOString(),
            requestedAt: new Date().toISOString()
        };

        await db.collection('patron_requests').add(request);

        return { success: true };
    } catch (err: any) {
        console.error('[Actions] Patron Request Error:', err);
        return { success: false, error: err.message };
    }
}
