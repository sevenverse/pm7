export class ApiClient {
    private baseUrl: string;
    private headers: Record<string, string>;

    constructor(baseUrl: string, headers: Record<string, string> = {}) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.headers = headers;
    }

    async get<T>(path: string, params?: Record<string, string>): Promise<T> {
        const url = new URL(`${this.baseUrl}${path}`);
        if (params) {
            Object.entries(params).forEach(([key, value]) => {
                if (value) url.searchParams.append(key, value);
            });
        }

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: this.headers,
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText} - ${await response.text()}`);
        }

        return response.json() as Promise<T>;
    }

    async getText(path: string, params?: Record<string, string>): Promise<string> {
        const url = new URL(`${this.baseUrl}${path}`);
        if (params) {
            Object.entries(params).forEach(([key, value]) => {
                if (value) url.searchParams.append(key, value);
            });
        }

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: this.headers,
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText} - ${await response.text()}`);
        }

        return response.text();
    }

    async post<T>(path: string, body: any): Promise<T> {
        const response = await fetch(`${this.baseUrl}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.headers,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText} - ${await response.text()}`);
        }

        return response.json() as Promise<T>;
    }

    async put<T>(path: string, body: any): Promise<T> {
        const response = await fetch(`${this.baseUrl}${path}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...this.headers,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText} - ${await response.text()}`);
        }

        return response.json() as Promise<T>;
    }
}
