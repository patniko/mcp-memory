#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface Memory {
  id: string;
  content: string;
  tags: string[];
  context: string;
  timestamp: string;
  session_id?: string;
  importance: 'low' | 'medium' | 'high';
  type: 'conversation' | 'decision' | 'preference' | 'fact' | 'other';
}

interface MemoryStorage {
  memories: Memory[];
  version: string;
  last_updated: string;
}

const isValidReflectArgs = (args: any): args is {
  content: string;
  tags?: string[];
  context?: string;
  session_id?: string;
  importance?: 'low' | 'medium' | 'high';
  type?: 'conversation' | 'decision' | 'preference' | 'fact' | 'other';
} => {
  return typeof args === 'object' &&
    args !== null &&
    typeof args.content === 'string' &&
    (args.tags === undefined || Array.isArray(args.tags)) &&
    (args.context === undefined || typeof args.context === 'string') &&
    (args.session_id === undefined || typeof args.session_id === 'string') &&
    (args.importance === undefined || ['low', 'medium', 'high'].includes(args.importance)) &&
    (args.type === undefined || ['conversation', 'decision', 'preference', 'fact', 'other'].includes(args.type));
};

const isValidRecallArgs = (args: any): args is {
  query?: string;
  tags?: string[];
  session_id?: string;
  importance?: 'low' | 'medium' | 'high';
  type?: 'conversation' | 'decision' | 'preference' | 'fact' | 'other';
  limit?: number;
} => {
  return typeof args === 'object' &&
    args !== null &&
    (args.query === undefined || typeof args.query === 'string') &&
    (args.tags === undefined || Array.isArray(args.tags)) &&
    (args.session_id === undefined || typeof args.session_id === 'string') &&
    (args.importance === undefined || ['low', 'medium', 'high'].includes(args.importance)) &&
    (args.type === undefined || ['conversation', 'decision', 'preference', 'fact', 'other'].includes(args.type)) &&
    (args.limit === undefined || typeof args.limit === 'number');
};

const isValidModifyArgs = (args: any): args is {
  id: string;
  content?: string;
  tags?: string[];
  context?: string;
  importance?: 'low' | 'medium' | 'high';
  type?: 'conversation' | 'decision' | 'preference' | 'fact' | 'other';
} => {
  return typeof args === 'object' &&
    args !== null &&
    typeof args.id === 'string' &&
    (args.content === undefined || typeof args.content === 'string') &&
    (args.tags === undefined || Array.isArray(args.tags)) &&
    (args.context === undefined || typeof args.context === 'string') &&
    (args.importance === undefined || ['low', 'medium', 'high'].includes(args.importance)) &&
    (args.type === undefined || ['conversation', 'decision', 'preference', 'fact', 'other'].includes(args.type));
};

const isValidEraseArgs = (args: any): args is {
  id?: string;
  query?: string;
  tags?: string[];
  session_id?: string;
  confirm?: boolean;
} => {
  return typeof args === 'object' &&
    args !== null &&
    (args.id === undefined || typeof args.id === 'string') &&
    (args.query === undefined || typeof args.query === 'string') &&
    (args.tags === undefined || Array.isArray(args.tags)) &&
    (args.session_id === undefined || typeof args.session_id === 'string') &&
    (args.confirm === undefined || typeof args.confirm === 'boolean');
};

class MemoryServer {
  private server: Server;
  private memoryFile: string;

  constructor() {
    this.server = new Server(
      {
        name: 'memory-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Store memories in a JSON file in the project directory
    this.memoryFile = path.join(__dirname, '..', 'memories.json');

    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private async loadMemories(): Promise<MemoryStorage> {
    try {
      const data = await fs.readFile(this.memoryFile, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      // If file doesn't exist or is invalid, return empty storage
      return {
        memories: [],
        version: '1.0.0',
        last_updated: new Date().toISOString(),
      };
    }
  }

  private async saveMemories(storage: MemoryStorage): Promise<void> {
    storage.last_updated = new Date().toISOString();
    await fs.writeFile(this.memoryFile, JSON.stringify(storage, null, 2));
  }

  private searchMemories(memories: Memory[], query?: string): Memory[] {
    if (!query) return memories;
    
    const searchTerm = query.toLowerCase();
    return memories.filter(memory => 
      memory.content.toLowerCase().includes(searchTerm) ||
      memory.context.toLowerCase().includes(searchTerm) ||
      memory.tags.some(tag => tag.toLowerCase().includes(searchTerm))
    );
  }

  private filterMemories(memories: Memory[], filters: {
    tags?: string[];
    session_id?: string;
    importance?: string;
    type?: string;
  }): Memory[] {
    return memories.filter(memory => {
      if (filters.tags && !filters.tags.some(tag => memory.tags.includes(tag))) {
        return false;
      }
      if (filters.session_id && memory.session_id !== filters.session_id) {
        return false;
      }
      if (filters.importance && memory.importance !== filters.importance) {
        return false;
      }
      if (filters.type && memory.type !== filters.type) {
        return false;
      }
      return true;
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'reflect',
          description: 'Store a new memory from the current conversation or context',
          inputSchema: {
            type: 'object',
            properties: {
              content: {
                type: 'string',
                description: 'The main content of the memory to store',
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional tags to categorize the memory',
              },
              context: {
                type: 'string',
                description: 'Additional context about when/where this memory was created',
              },
              session_id: {
                type: 'string',
                description: 'Optional session identifier to group related memories',
              },
              importance: {
                type: 'string',
                enum: ['low', 'medium', 'high'],
                description: 'Importance level of this memory',
              },
              type: {
                type: 'string',
                enum: ['conversation', 'decision', 'preference', 'fact', 'other'],
                description: 'Type of memory being stored',
              },
            },
            required: ['content'],
          },
        },
        {
          name: 'recall',
          description: 'Retrieve memories based on search criteria',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query to match against memory content, context, and tags',
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Filter by specific tags',
              },
              session_id: {
                type: 'string',
                description: 'Filter by session identifier',
              },
              importance: {
                type: 'string',
                enum: ['low', 'medium', 'high'],
                description: 'Filter by importance level',
              },
              type: {
                type: 'string',
                enum: ['conversation', 'decision', 'preference', 'fact', 'other'],
                description: 'Filter by memory type',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of memories to return (default: 10)',
                minimum: 1,
                maximum: 100,
              },
            },
            required: [],
          },
        },
        {
          name: 'modify',
          description: 'Update an existing memory by its ID',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The unique ID of the memory to modify',
              },
              content: {
                type: 'string',
                description: 'New content for the memory',
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'New tags for the memory',
              },
              context: {
                type: 'string',
                description: 'New context for the memory',
              },
              importance: {
                type: 'string',
                enum: ['low', 'medium', 'high'],
                description: 'New importance level',
              },
              type: {
                type: 'string',
                enum: ['conversation', 'decision', 'preference', 'fact', 'other'],
                description: 'New memory type',
              },
            },
            required: ['id'],
          },
        },
        {
          name: 'erase',
          description: 'Delete memories by ID or search criteria',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The unique ID of a specific memory to delete',
              },
              query: {
                type: 'string',
                description: 'Search query to find memories to delete',
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Delete memories with these tags',
              },
              session_id: {
                type: 'string',
                description: 'Delete all memories from this session',
              },
              confirm: {
                type: 'boolean',
                description: 'Confirmation flag for bulk deletions (required for non-ID deletions)',
              },
            },
            required: [],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case 'reflect':
            return await this.handleReflect(request.params.arguments);
          case 'recall':
            return await this.handleRecall(request.params.arguments);
          case 'modify':
            return await this.handleModify(request.params.arguments);
          case 'erase':
            return await this.handleErase(request.params.arguments);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async handleReflect(args: any) {
    if (!isValidReflectArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid reflect arguments');
    }

    const storage = await this.loadMemories();
    
    const newMemory: Memory = {
      id: uuidv4(),
      content: args.content,
      tags: args.tags || [],
      context: args.context || '',
      timestamp: new Date().toISOString(),
      session_id: args.session_id,
      importance: args.importance || 'medium',
      type: args.type || 'other',
    };

    storage.memories.push(newMemory);
    await this.saveMemories(storage);

    return {
      content: [
        {
          type: 'text',
          text: `Memory stored successfully with ID: ${newMemory.id}\n\nContent: ${newMemory.content}\nTags: ${newMemory.tags.join(', ')}\nImportance: ${newMemory.importance}\nType: ${newMemory.type}`,
        },
      ],
    };
  }

  private async handleRecall(args: any) {
    if (!isValidRecallArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid recall arguments');
    }

    const storage = await this.loadMemories();
    let memories = storage.memories;

    // Apply search query
    if (args.query) {
      memories = this.searchMemories(memories, args.query);
    }

    // Apply filters
    memories = this.filterMemories(memories, {
      tags: args.tags,
      session_id: args.session_id,
      importance: args.importance,
      type: args.type,
    });

    // Sort by timestamp (most recent first)
    memories.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Apply limit
    const limit = args.limit || 10;
    memories = memories.slice(0, limit);

    const resultText = memories.length === 0
      ? 'No memories found matching the criteria.'
      : `Found ${memories.length} memories:\n\n${memories.map((memory, index) => 
          `${index + 1}. ID: ${memory.id}\n   Content: ${memory.content}\n   Tags: ${memory.tags.join(', ')}\n   Context: ${memory.context}\n   Importance: ${memory.importance}\n   Type: ${memory.type}\n   Session: ${memory.session_id || 'N/A'}\n   Timestamp: ${memory.timestamp}`
        ).join('\n\n')}`;

    return {
      content: [
        {
          type: 'text',
          text: resultText,
        },
      ],
    };
  }

  private async handleModify(args: any) {
    if (!isValidModifyArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid modify arguments');
    }

    const storage = await this.loadMemories();
    const memoryIndex = storage.memories.findIndex(m => m.id === args.id);

    if (memoryIndex === -1) {
      throw new McpError(ErrorCode.InvalidParams, `Memory with ID ${args.id} not found`);
    }

    const memory = storage.memories[memoryIndex];
    const originalMemory = { ...memory };

    // Update fields if provided
    if (args.content !== undefined) memory.content = args.content;
    if (args.tags !== undefined) memory.tags = args.tags;
    if (args.context !== undefined) memory.context = args.context;
    if (args.importance !== undefined) memory.importance = args.importance;
    if (args.type !== undefined) memory.type = args.type;

    await this.saveMemories(storage);

    return {
      content: [
        {
          type: 'text',
          text: `Memory ${args.id} updated successfully.\n\nOriginal:\n  Content: ${originalMemory.content}\n  Tags: ${originalMemory.tags.join(', ')}\n  Context: ${originalMemory.context}\n  Importance: ${originalMemory.importance}\n  Type: ${originalMemory.type}\n\nUpdated:\n  Content: ${memory.content}\n  Tags: ${memory.tags.join(', ')}\n  Context: ${memory.context}\n  Importance: ${memory.importance}\n  Type: ${memory.type}`,
        },
      ],
    };
  }

  private async handleErase(args: any) {
    if (!isValidEraseArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid erase arguments');
    }

    const storage = await this.loadMemories();

    if (args.id) {
      // Delete specific memory by ID
      const initialCount = storage.memories.length;
      storage.memories = storage.memories.filter(m => m.id !== args.id);
      
      if (storage.memories.length === initialCount) {
        throw new McpError(ErrorCode.InvalidParams, `Memory with ID ${args.id} not found`);
      }

      await this.saveMemories(storage);

      return {
        content: [
          {
            type: 'text',
            text: `Memory ${args.id} deleted successfully.`,
          },
        ],
      };
    } else {
      // Bulk deletion - requires confirmation
      if (!args.confirm) {
        // Preview what would be deleted
        let memories = storage.memories;

        if (args.query) {
          memories = this.searchMemories(memories, args.query);
        }

        memories = this.filterMemories(memories, {
          tags: args.tags,
          session_id: args.session_id,
        });

        return {
          content: [
            {
              type: 'text',
              text: `This would delete ${memories.length} memories. To confirm, call erase again with confirm: true.\n\nMemories to be deleted:\n${memories.map(m => `- ${m.id}: ${m.content.substring(0, 50)}...`).join('\n')}`,
            },
          ],
        };
      }

      // Perform bulk deletion
      let memoriesToDelete = storage.memories;

      if (args.query) {
        memoriesToDelete = this.searchMemories(memoriesToDelete, args.query);
      }

      memoriesToDelete = this.filterMemories(memoriesToDelete, {
        tags: args.tags,
        session_id: args.session_id,
      });

      const deletedIds = memoriesToDelete.map(m => m.id);
      storage.memories = storage.memories.filter(m => !deletedIds.includes(m.id));

      await this.saveMemories(storage);

      return {
        content: [
          {
            type: 'text',
            text: `Successfully deleted ${deletedIds.length} memories.`,
          },
        ],
      };
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Memory MCP server running on stdio');
  }
}

const server = new MemoryServer();
server.run().catch(console.error);
