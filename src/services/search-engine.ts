
import { DocumentChunk } from './document-processor.js';
import * as fs from 'fs';
import * as path from 'path';

export interface SearchResult {
    chunk: DocumentChunk;
    score: number;
    matchDetails: {
        term: string;
        matchType: 'exact' | 'fuzzy' | 'semantic';
    }[];
}

export class SearchEngine {
    private index: Map<string, DocumentChunk[]> = new Map();
    private readonly INDEX_FILE = '.gitlab_index.json';

    constructor() {
        this.loadIndex();
    }

    /**
     * Adds document chunks to the search index.
     */
    indexProject(projectId: string, chunks: DocumentChunk[]) {
        this.index.set(projectId, chunks);
        console.error(`Indexed ${chunks.length} chunks for project ${projectId}`);
        this.saveIndex();
    }

    /**
     * Persist index to disk
     */
    private saveIndex() {
        try {
            const data = JSON.stringify(Array.from(this.index.entries()));
            fs.writeFileSync(path.join(process.cwd(), this.INDEX_FILE), data);
        } catch (error) {
            console.error('Failed to save search index:', error);
        }
    }

    /**
     * Load index from disk
     */
    private loadIndex() {
        try {
            const filePath = path.join(process.cwd(), this.INDEX_FILE);
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf-8');
                this.index = new Map(JSON.parse(data));
                console.error('Loaded search index from disk');
            }
        } catch (error) {
            console.error('Failed to load search index:', error);
        }
    }

    /**
     * Smart tokenization that handles camelCase, snake_case, etc.
     */
    private tokenize(text: string): string[] {
        // 1. Split by non-alphanumeric characters
        const rawTokens = text.split(/[^a-zA-Z0-9]+/);

        const tokens: string[] = [];
        for (const token of rawTokens) {
            if (!token) continue;

            // 2. Split camelCase (e.g., "GitLabCrawler" -> "Git", "Lab", "Crawler")
            const camelParts = token.replace(/([a-z])([A-Z])/g, '$1 $2').split(' ');

            for (const part of camelParts) {
                // 3. Lowercase and filter stop words
                const lower = part.toLowerCase();
                if (lower.length > 2 && !this.isStopWord(lower)) {
                    tokens.push(lower);
                }
            }
        }
        return tokens;
    }

    private isStopWord(word: string): boolean {
        const stopWords = new Set([
            'the', 'is', 'at', 'of', 'on', 'and', 'a', 'an', 'in', 'to', 'for', 'with', 'by', 'about', 'as',
            'this', 'that', 'these', 'those', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'but', 'if', 'or', 'because', 'as', 'until', 'while',
            'function', 'class', 'const', 'var', 'let', 'return', 'import', 'export', 'default' // Code stop words
        ]);
        return stopWords.has(word);
    }

    /**
     * Levenshtein distance for fuzzy matching
     */
    private levenshteinDistance(a: string, b: string): number {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;

        const matrix = [];

        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        Math.min(
                            matrix[i][j - 1] + 1, // insertion
                            matrix[i - 1][j] + 1 // deletion
                        )
                    );
                }
            }
        }

        return matrix[b.length][a.length];
    }

    /**
     * Searches for chunks matching the query using BM25 and fuzzy matching.
     */
    search(projectId: string | undefined, query: string, limit: number = 5): SearchResult[] {
        let allChunks: DocumentChunk[] = [];

        if (projectId && this.index.has(projectId)) {
            allChunks = this.index.get(projectId) || [];
            // If specific project requested, we might want to search others too but with lower priority?
            // For now, let's stick to the previous logic: search ALL, boost project.
            for (const [pid, chunks] of this.index.entries()) {
                if (pid !== projectId) allChunks.push(...chunks);
            }
        } else {
            for (const chunks of this.index.values()) {
                allChunks.push(...chunks);
            }
        }

        if (allChunks.length === 0) return [];

        const queryTerms = this.tokenize(query);
        if (queryTerms.length === 0) return [];

        // BM25 Parameters
        const k1 = 1.2;
        const b = 0.75;

        // Calculate avg document length
        const avgDocLength = allChunks.reduce((sum, chunk) => sum + chunk.content.length, 0) / allChunks.length;

        // Calculate IDF for each query term
        const idf: Record<string, number> = {};
        for (const term of queryTerms) {
            let docCount = 0;
            for (const chunk of allChunks) {
                if (chunk.content.toLowerCase().includes(term)) {
                    docCount++;
                }
            }
            // IDF formula
            idf[term] = Math.log(1 + (allChunks.length - docCount + 0.5) / (docCount + 0.5));
        }

        const scoredChunks: SearchResult[] = allChunks.map(chunk => {
            let score = 0;
            const matchDetails: any[] = [];
            const contentLower = chunk.content.toLowerCase();
            const docLength = chunk.content.length;

            for (const term of queryTerms) {
                // Check for exact match or fuzzy match
                let termFreq = 0;
                let matchType: 'exact' | 'fuzzy' | null = null;

                // Exact match count
                const regex = new RegExp(term, 'gi');
                const matches = contentLower.match(regex);
                if (matches) {
                    termFreq = matches.length;
                    matchType = 'exact';
                } else {
                    // Fuzzy match check (only if exact match failed)
                    // We scan words in content? That's expensive.
                    // Optimization: Just check if the term exists as a substring with tolerance?
                    // For performance, let's stick to exact substring inclusion for "fuzzy" in this context
                    // or check tokens.
                    // Let's tokenize the content properly for fuzzy check
                    const contentTokens = this.tokenize(chunk.content);
                    for (const token of contentTokens) {
                        if (this.levenshteinDistance(term, token) <= 2) { // Allow 2 edits
                            termFreq++;
                            matchType = 'fuzzy';
                        }
                    }
                }

                if (termFreq > 0) {
                    // BM25 Score for this term
                    const numerator = idf[term] * termFreq * (k1 + 1);
                    const denominator = termFreq + k1 * (1 - b + b * (docLength / avgDocLength));
                    score += numerator / denominator;

                    matchDetails.push({ term, matchType });
                }
            }

            // Boost for Title match
            const titleLower = chunk.metadata.title?.toLowerCase() || '';
            for (const term of queryTerms) {
                if (titleLower.includes(term)) {
                    score += 2.0; // Boost
                }
            }

            // Boost for Project ID match
            if (projectId && chunk.projectId === projectId) {
                score *= 1.5;
            }

            return { chunk, score, matchDetails };
        });

        return scoredChunks
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    /**
     * Clears the index for a project.
     */
    clearIndex(projectId: string) {
        this.index.delete(projectId);
        this.saveIndex();
    }
}

// Export a singleton instance
export const searchEngine = new SearchEngine();
