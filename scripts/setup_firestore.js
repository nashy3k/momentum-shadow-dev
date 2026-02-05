const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// 1. Load Credentials
const keyPath = path.resolve(process.cwd(), 'service-account-key.json');
if (!fs.existsSync(keyPath)) {
    console.error('❌ Error: service-account-key.json not found in root.');
    console.log('👉 Go to Firebase Console > Project Settings > Service Accounts > Generate New Private Key');
    process.exit(1);
}

try {
    admin.initializeApp({
        credential: admin.credential.cert(require(keyPath))
    });
    console.log('✅ Firebase Admin Initialized');
} catch (e) {
    console.error('❌ Failed to initialize Firebase:', e.message);
    process.exit(1);
}

const db = admin.firestore();

async function setup() {
    console.log('🚀 Starting Database Initialization...');

    // 2. Create Collections (by adding a dummy doc and then deleting it, or just verifying access)
    // Firestore collections are implicit, but we want to test permissions.

    const collections = ['repositories', 'memories', 'users', 'logs']; // Added 'logs' for Friday Polish

    for (const col of collections) {
        try {
            const ref = db.collection(col).doc('_init_check');
            await ref.set({
                created: admin.firestore.FieldValue.serverTimestamp(),
                setup: true
            });
            console.log(`   - Verified Access: [${col}]`);
            await ref.delete();
        } catch (e) {
            console.error(`   ❌ Error accessing collection [${col}]:`, e.message);
            console.log('      (Check if your Service Account has "Firebase Admin" or "Firestore Editor" role)');
        }
    }

    console.log('\n✅ Database Structure Verified!');
    console.log('   You are ready to run: npm run start-bot');
}

setup();
