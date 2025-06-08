#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { storage } from './storage.js';
import { SEQUENTIAL_THINKING_PROMPT, formatPlanAsTodos } from './prompts.js';
import { Goal, Todo } from './types.js';

class SoftwarePlanningServer {
  private server: Server;
  private currentGoal: Goal | null = null;

  constructor() {
    this.server = new Server(
      {
        name: 'software-planning-tool',
        version: '0.1.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.setupResourceHandlers();
    this.setupToolHandlers();
    
    this.server.onerror = (error) => console.error('[MCP Error]', error);
  }

  private setupResourceHandlers() {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'planning://current-goal',
          name: 'Current Goal',
          description: 'The current software development goal being planned',
          mimeType: 'application/json',
        },
        {
          uri: 'planning://implementation-plan',
          name: 'Implementation Plan',
          description: 'The current implementation plan with todos',
          mimeType: 'application/json',
        },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      switch (request.params.uri) {
        case 'planning://current-goal': {
          if (!this.currentGoal) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'No active goal. Start a new planning session first.'
            );
          }
          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: 'application/json',
                text: JSON.stringify(this.currentGoal, null, 2),
              },
            ],
          };
        }
        case 'planning://implementation-plan': {
          if (!this.currentGoal) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'No active goal. Start a new planning session first.'
            );
          }
          const plan = await storage.getPlan(this.currentGoal.id);
          if (!plan) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'No implementation plan found for current goal.'
            );
          }
          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: 'application/json',
                text: JSON.stringify(plan, null, 2),
              },
            ],
          };
        }
        default:
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Unknown resource URI: ${request.params.uri}`
          );
      }
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'start_planning',
          description: 'Start a new planning session with a goal',
          inputSchema: {
            type: 'object',
            properties: {
              goal: {
                type: 'string',
                description: 'The software development goal to plan',
              },
            },
            required: ['goal'],
          },
        },
        {
          name: 'save_plan',
          description: 'Save the current implementation plan',
          inputSchema: {
            type: 'object',
            properties: {
              plan: {
                type: 'string',
                description: 'The implementation plan text to save',
              },
            },
            required: ['plan'],
          },
        },
        {
          name: 'add_todo',
          description: 'Add a new todo item to the current plan',
          inputSchema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Title of the todo item',
              },
              description: {
                type: 'string',
                description: 'Detailed description of the todo item',
              },
              complexity: {
                type: 'number',
                description: 'Complexity score (0-10)',
                minimum: 0,
                maximum: 10,
              },
              codeExample: {
                type: 'string',
                description: 'Optional code example',
              },
            },
            required: ['title', 'description', 'complexity'],
          },
        },
        {
          name: 'remove_todo',
          description: 'Remove a todo item from the current plan',
          inputSchema: {
            type: 'object',
            properties: {
              todoId: {
                type: 'string',
                description: 'ID of the todo item to remove',
              },
            },
            required: ['todoId'],
          },
        },
        {
          name: 'get_todos',
          description: 'Get all todos in the current plan',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'update_todo_status',
          description: 'Update the completion status of a todo item',
          inputSchema: {
            type: 'object',
            properties: {
              todoId: {
                type: 'string',
                description: 'ID of the todo item',
              },
              isComplete: {
                type: 'boolean',
                description: 'New completion status',
              },
            },
            required: ['todoId', 'isComplete'],
          },
        },
        {
          name: 'view_plan',
          description: 'View the current project plan in markdown format',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'view_tasks',
          description: 'View the current project tasks in markdown format',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'set_working_directory',
          description: 'Set the working directory for the current session (where .cursor folder will be created)',
          inputSchema: {
            type: 'object',
            properties: {
              directory: {
                type: 'string',
                description: 'Absolute or relative path to the project directory',
              },
            },
            required: ['directory'],
          },
        },
        {
          name: 'get_working_directory',
          description: 'Get the current working directory where plans are stored',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case 'start_planning': {
          const { goal } = request.params.arguments as { goal: string };
          this.currentGoal = await storage.createGoal(goal);
          await storage.createPlan(this.currentGoal.id);

          return {
            content: [
              {
                type: 'text',
                text: SEQUENTIAL_THINKING_PROMPT,
              },
            ],
          };
        }

        case 'save_plan': {
          if (!this.currentGoal) {
            throw new McpError(
              ErrorCode.InvalidRequest,
              'No active goal. Start a new planning session first.'
            );
          }

          const { plan } = request.params.arguments as { plan: string };
          const todos = formatPlanAsTodos(plan);

          for (const todo of todos) {
            await storage.addTodo(this.currentGoal.id, todo);
          }

          return {
            content: [
              {
                type: 'text',
                text: `Successfully saved ${todos.length} todo items to the implementation plan.`,
              },
            ],
          };
        }

        case 'add_todo': {
          if (!this.currentGoal) {
            throw new McpError(
              ErrorCode.InvalidRequest,
              'No active goal. Start a new planning session first.'
            );
          }

          const todo = request.params.arguments as Omit<
            Todo,
            'id' | 'isComplete' | 'createdAt' | 'updatedAt'
          >;
          const newTodo = await storage.addTodo(this.currentGoal.id, todo);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(newTodo, null, 2),
              },
            ],
          };
        }

        case 'remove_todo': {
          if (!this.currentGoal) {
            throw new McpError(
              ErrorCode.InvalidRequest,
              'No active goal. Start a new planning session first.'
            );
          }

          const { todoId } = request.params.arguments as { todoId: string };
          await storage.removeTodo(this.currentGoal.id, todoId);

          return {
            content: [
              {
                type: 'text',
                text: `Successfully removed todo ${todoId}`,
              },
            ],
          };
        }

        case 'get_todos': {
          if (!this.currentGoal) {
            throw new McpError(
              ErrorCode.InvalidRequest,
              'No active goal. Start a new planning session first.'
            );
          }

          const todos = await storage.getTodos(this.currentGoal.id);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(todos, null, 2),
              },
            ],
          };
        }

        case 'update_todo_status': {
          if (!this.currentGoal) {
            throw new McpError(
              ErrorCode.InvalidRequest,
              'No active goal. Start a new planning session first.'
            );
          }

          const { todoId, isComplete } = request.params.arguments as {
            todoId: string;
            isComplete: boolean;
          };
          const updatedTodo = await storage.updateTodoStatus(
            this.currentGoal.id,
            todoId,
            isComplete
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(updatedTodo, null, 2),
              },
            ],
          };
        }

        case 'view_plan': {
          const fs = await import('fs/promises');
          const path = await import('path');
          
          try {
            const planPath = path.join(storage.getCurrentWorkingDirectory(), '.cursor', 'plan.md');
            const planContent = await fs.readFile(planPath, 'utf-8');
            
            return {
              content: [
                {
                  type: 'text',
                  text: planContent,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text',
                  text: '未找到计划文件。请先创建一个开发计划。',
                },
              ],
            };
          }
        }

        case 'view_tasks': {
          const fs = await import('fs/promises');
          const path = await import('path');
          
          try {
            const tasksPath = path.join(storage.getCurrentWorkingDirectory(), '.cursor', 'tasks.md');
            const tasksContent = await fs.readFile(tasksPath, 'utf-8');
            
            return {
              content: [
                {
                  type: 'text',
                  text: tasksContent,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text',
                  text: '未找到任务文件。请先创建一个开发计划。',
                },
              ],
            };
          }
        }

        case 'set_working_directory': {
          const { directory } = request.params.arguments as { directory: string };
          
          try {
            await storage.setWorkingDirectory(directory);
            
            return {
              content: [
                {
                  type: 'text',
                  text: `工作目录已设置为: ${storage.getCurrentWorkingDirectory()}\n计划文件将保存到: ${storage.getCurrentWorkingDirectory()}/.cursor/`,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text',
                  text: `设置工作目录失败: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            };
          }
        }

        case 'get_working_directory': {
          return {
            content: [
              {
                type: 'text',
                text: `当前工作目录: ${storage.getCurrentWorkingDirectory()}\n计划文件位置: ${storage.getCurrentWorkingDirectory()}/.cursor/`,
              },
            ],
          };
        }

        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  async run() {
    try {
      console.error('[Server] Starting Software Planning MCP server...');
      console.error(`[Server] Working directory: ${process.cwd()}`);
      console.error(`[Server] Environment PWD: ${process.env.PWD || 'not set'}`);
      console.error(`[Server] Environment INIT_CWD: ${process.env.INIT_CWD || 'not set'}`);
      
      await storage.initialize();
      console.error('[Server] Storage initialized successfully');
      
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error('Software Planning MCP server running on stdio');
    } catch (error) {
      console.error('[Server] Failed to start server:', error instanceof Error ? error.message : String(error));
      console.error('[Server] Error details:', error);
      throw error;
    }
  }
}

const server = new SoftwarePlanningServer();
server.run().catch(console.error);
