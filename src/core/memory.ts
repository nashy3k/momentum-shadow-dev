import { Firestore } from '@google-cloud/firestore';
import { genkit, z } from 'genkit';
import { googleAI, textEmbedding004 } from '@genkit-ai/googleai';
import * as dotenv from 'dotenv';

dotenv.config({ override: true });

const ai = genkit({
    plugins: [googleAI()],
    model: 'googleai/gemini-2.0-flash', // Gemini 3 Flash equivalent
});

export interface Memory {
    id?: string;
    text: string;
    embedding?: number[];
    type: 'positive' | 'negative' | 'tip';
    repoRef?: string;
    timestamp: any;
    metadata?: any;
}

export class MemoryManager {
    private db: Firestore;
    private collectionName = 'memories';

    constructor(db?: Firestore) {
        // Use provided DB or create a new one (will use default credentials)
        this.db = db || new Firestore();
    }

    /**
     * Converts text into a vector embedding using text-embedding-004
     */
    async embed(text: string): Promise<number[]> {
        // Fallback catch-all for embedding failure
        try {
            // Use the string reference which is more robust than the object import in some versions
            const modelName = 'googleai/gemini-embedding-001';
            const result = await ai.embed({
                embedder: modelName,
                content: text,
            });
            if (!result || result.length === 0) return [];
            return result[0]?.embedding || [];
        } catch (err: any) {
            console.error('[Memory] ⚠️ Embedding API Failed:', err.message);
            return []; // Return empty vector on failure (graceful degradation)
        }
    }

    /**
     * Saves a new memory to Firestore with its vector embedding
     */
    async addMemory(text: string, type: Memory['type'], repoRef?: string, metadata?: any): Promise<string> {
        console.log(`[Memory] Embedding new memory: "${text.substring(0, 50)}..."`);
        const embeddingData = await this.embed(text);

        const memory: Memory = {
            text,
            type,
            repoRef: repoRef || '', // Default to empty string for safety
            embedding: embeddingData,
            timestamp: new Date(),
            metadata: metadata || {}
        };

        const docRef = await this.db.collection(this.collectionName).add(memory);
        return docRef.id;
    }

    /**
     * Performs a basic search (Firestore doesn't do vector search natively without extensions, 
     * but we can do a k-NN search in-memory or using simple filters for this hackathon).
     * For Day 1, we'll implement a simple keyword/type filter or basic cosine similarity in-memory.
     */
    async search(query: string, limit: number = 3): Promise<Memory[]> {
        const queryEmbedding = await this.embed(query);
        if (!queryEmbedding || queryEmbedding.length === 0) {
            console.warn('[Memory] Skipping search due to embedding failure.');
            return [];
        }

        // Hackathon logic: Fetch last 50 memories and do in-memory cosine similarity
        // Proper way would be Firestore Vector Search (launched recently)
        const snapshot = await this.db.collection(this.collectionName)
            .orderBy('timestamp', 'desc')
            .limit(50)
            .get();

        const memories: Memory[] = [];
        snapshot.forEach(doc => {
            memories.push({ id: doc.id, ...doc.data() } as Memory);
        });

        // Simple Cosine Similarity
        const similarities = memories
            .filter(m => m.embedding && Array.isArray(m.embedding))
            .map(m => ({
                memory: m,
                similarity: this.cosineSimilarity(queryEmbedding, m.embedding!)
            }))
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);

        console.log(`[Memory] Recalled ${similarities.length} relevant lessons for query: "${query.substring(0, 30)}..."`);
        return similarities.map(s => s.memory);
    }

    private cosineSimilarity(vecA: number[], vecB: number[]): number {
        if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            const a = vecA[i];
            const b = vecB[i];
            if (a === undefined || b === undefined) continue;
            dotProduct += a * b;
            normA += a * a;
            normB += b * b;
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}
