
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as cheerio from 'cheerio';

export function registerWebCrawler(server: McpServer) {
    server.registerTool(
        'web-crawler',
        {
            description: 'Crawl a public URL to get its content. This tool is designed for LLMs that cannot access the internet directly. It returns the text content of the page and a list of links found, allowing you to follow them for subsequent searches.',
            inputSchema: {
                url: z.string().url().describe('The full URL to crawl (must start with http:// or https://)'),
            },
        },
        async ({ url }) => {
            try {
                const response = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; PM7-MCP-Crawler/1.0)',
                    },
                });

                if (!response.ok) {
                    return {
                        content: [{ type: 'text' as const, text: `Failed to fetch URL: ${response.status} ${response.statusText}` }],
                        isError: true,
                    };
                }

                const html = await response.text();
                const $ = cheerio.load(html);

                // Remove scripts, styles, and other non-content elements
                $('script, style, nav, footer, header, noscript, iframe, svg').remove();

                // Extract text
                const text = $('body').text().replace(/\s+/g, ' ').trim();

                // Extract links
                const links: string[] = [];
                $('a').each((_, element) => {
                    const href = $(element).attr('href');
                    if (href && (href.startsWith('http') || href.startsWith('/'))) {
                        // Resolve relative URLs
                        try {
                            const absoluteUrl = new URL(href, url).toString();
                            links.push(absoluteUrl);
                        } catch (e) {
                            // Ignore invalid URLs
                        }
                    }
                });

                // Limit links to avoid overwhelming context
                const uniqueLinks = [...new Set(links)].slice(0, 50);

                return {
                    content: [{
                        type: 'text' as const,
                        text: `Page Content for ${url}:\n\n${text.slice(0, 10000)} ${text.length > 10000 ? '...(truncated)' : ''}\n\n---\n\nFound Links (Top 50):\n${uniqueLinks.join('\n')}`
                    }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: 'text' as const, text: `Error crawling URL: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );
}
