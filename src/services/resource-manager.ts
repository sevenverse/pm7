
export interface GitLabResource {
    uri: string;
    name: string;
    mimeType?: string;
    text?: string; // Content for files, or description for folders
    isFolder: boolean;
    children?: string[]; // For folders, list of child URIs
    webUrl?: string; // Full GitLab web URL
    projectPath?: string; // Project path with namespace (e.g. group/project)
    instructionToLLM?: string; // Instruction for the LLM on how to use this resource
}

export class ResourceManager {
    private resources: Map<string, GitLabResource> = new Map();

    /**
     * Registers a resource (file or folder).
     */
    registerResource(resource: GitLabResource) {
        this.resources.set(resource.uri, resource);
    }

    /**
     * Gets a resource by URI.
     */
    getResource(uri: string): GitLabResource | undefined {
        return this.resources.get(uri);
    }

    /**
     * Lists all registered resources.
     */
    getAllResources(): GitLabResource[] {
        return Array.from(this.resources.values());
    }

    /**
     * Clears resources for a specific project prefix.
     */
    clearProjectResources(projectId: string) {
        for (const key of this.resources.keys()) {
            if (key.startsWith(`gitlab://${projectId}/`)) {
                this.resources.delete(key);
            }
        }
    }

    /**
     * Helper to construct a URI.
     */
    static getUri(projectId: string, filePath: string): string {
        // Ensure projectId and filePath are clean
        const cleanPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
        return `gitlab://${projectId}/${cleanPath}`;
    }
}

export const resourceManager = new ResourceManager();
