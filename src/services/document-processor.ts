
export interface DocumentChunk {
    id: string;
    projectId: string;
    filePath: string;
    content: string;
    metadata: {
        title?: string;
        type: 'markdown' | 'code' | 'text';
        startLine?: number;
        endLine?: number;
    };
}

export class DocumentProcessor {
    /**
     * Chunks a document based on its file type.
     */
    static chunkDocument(projectId: string, filePath: string, content: string): DocumentChunk[] {
        const extension = filePath.split('.').pop()?.toLowerCase();

        if (extension === 'md' || extension === 'markdown') {
            return this.chunkMarkdown(projectId, filePath, content);
        } else if (['ts', 'js', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'h'].includes(extension || '')) {
            return this.chunkCode(projectId, filePath, content);
        } else {
            return this.chunkText(projectId, filePath, content);
        }
    }

    private static chunkMarkdown(projectId: string, filePath: string, content: string): DocumentChunk[] {
        const chunks: DocumentChunk[] = [];
        const lines = content.split('\n');
        let currentChunkLines: string[] = [];
        let currentTitle = 'Introduction';
        let startLine = 1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Split on headers (H1-H3)
            if (line.match(/^#{1,3}\s/)) {
                if (currentChunkLines.length > 0) {
                    chunks.push({
                        id: `${projectId}:${filePath}:${startLine}`,
                        projectId,
                        filePath,
                        content: currentChunkLines.join('\n'),
                        metadata: {
                            title: currentTitle,
                            type: 'markdown',
                            startLine,
                            endLine: i
                        }
                    });
                }
                currentTitle = line.replace(/^#+\s/, '').trim();
                currentChunkLines = [line];
                startLine = i + 1;
            } else {
                currentChunkLines.push(line);
            }
        }

        // Add last chunk
        if (currentChunkLines.length > 0) {
            chunks.push({
                id: `${projectId}:${filePath}:${startLine}`,
                projectId,
                filePath,
                content: currentChunkLines.join('\n'),
                metadata: {
                    title: currentTitle,
                    type: 'markdown',
                    startLine,
                    endLine: lines.length
                }
            });
        }

        return chunks;
    }

    private static chunkCode(projectId: string, filePath: string, content: string): DocumentChunk[] {
        // Simple fixed-size chunking for code with overlap
        // Ideally this would use an AST parser, but for now we'll use a sliding window
        const CHUNK_SIZE = 50; // lines
        const OVERLAP = 10; // lines

        const lines = content.split('\n');
        const chunks: DocumentChunk[] = [];

        for (let i = 0; i < lines.length; i += (CHUNK_SIZE - OVERLAP)) {
            const end = Math.min(i + CHUNK_SIZE, lines.length);
            const chunkLines = lines.slice(i, end);

            chunks.push({
                id: `${projectId}:${filePath}:${i + 1}`,
                projectId,
                filePath,
                content: chunkLines.join('\n'),
                metadata: {
                    type: 'code',
                    startLine: i + 1,
                    endLine: end
                }
            });

            if (end === lines.length) break;
        }

        return chunks;
    }

    private static chunkText(projectId: string, filePath: string, content: string): DocumentChunk[] {
        // Treat as one big chunk for now, or split by paragraphs if needed
        // For simplicity, we'll just limit it to a reasonable size
        return [{
            id: `${projectId}:${filePath}:1`,
            projectId,
            filePath,
            content: content.slice(0, 10000), // Hard limit to avoid massive tokens
            metadata: {
                type: 'text',
                startLine: 1,
                endLine: content.split('\n').length
            }
        }];
    }
}
