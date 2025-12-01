import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
    PORT: z.string().default('3000'),

    // Figma
    FIGMA_ACCESS_TOKEN: z.string().optional(),
    FIGMA_TEAM_ID: z.string().optional(),

    // Jira
    JIRA_DOMAIN: z.string().optional(),
    JIRA_EMAIL: z.string().optional(),
    JIRA_API_TOKEN: z.string().optional(),

    // GitLab
    GITLAB_URL: z.string().default('https://gitlab.com'),
    GITLAB_ACCESS_TOKEN: z.string().optional(),
});

export const config = envSchema.parse(process.env);

export const validateConfig = () => {
    const missing = [];
    if (!config.FIGMA_ACCESS_TOKEN) missing.push('FIGMA_ACCESS_TOKEN');
    if (!config.JIRA_API_TOKEN) missing.push('JIRA_API_TOKEN');
    if (!config.GITLAB_ACCESS_TOKEN) missing.push('GITLAB_ACCESS_TOKEN');

    if (missing.length > 0) {
        console.warn(`Missing optional configuration for: ${missing.join(', ')}. Related tools may not work.`);
    }
};
