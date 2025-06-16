import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { StorageData, Goal, ImplementationPlan, Todo } from './types.js';

export class Storage {
  private storagePath!: string;
  private cursorDir!: string;
  private planPath!: string;
  private tasksPath!: string;
  private data: StorageData;
  private currentWorkingDirectory: string;
  private currentPlan: string = 'main'; // 新增：当前活动计划
  private baseStorageDir!: string; // 新增：基础存储目录

  constructor() {
    // Initialize with default working directory
    this.currentWorkingDirectory = this.detectProjectRoot() || process.cwd();
    this.updatePaths();
    this.data = {
      goals: {},
      plans: {},
    };
  }

  /**
   * 检测项目根目录
   * 通过查找常见的项目标识文件来确定项目根目录
   */
  private detectProjectRoot(): string | null {
    const indicators = ['.git', 'package.json', '.cursor', 'tsconfig.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'];
    let currentDir = process.cwd();
    
    while (currentDir !== path.dirname(currentDir)) {
      for (const indicator of indicators) {
        const indicatorPath = path.join(currentDir, indicator);
        try {
          const fs = require('fs');
          if (fs.existsSync(indicatorPath)) {
            console.error(`[Storage] Detected project root: ${currentDir} (found ${indicator})`);
            return currentDir;
          }
        } catch (error) {
          // Continue searching
        }
      }
      currentDir = path.dirname(currentDir);
    }
    
    console.error(`[Storage] No project root detected, using current directory: ${process.cwd()}`);
    return null;
  }

  /**
   * 更新所有路径基于当前工作目录和当前计划
   */
  private updatePaths(): void {
    this.baseStorageDir = path.join(this.currentWorkingDirectory, '.cursor', 'softwareplan');
    this.cursorDir = path.join(this.baseStorageDir, this.currentPlan);
    this.storagePath = path.join(this.cursorDir, 'data.json');
    this.planPath = path.join(this.cursorDir, 'plan.md');
    this.tasksPath = path.join(this.cursorDir, 'tasks.md');
    
    console.error(`[Storage] Updated paths for directory: ${this.currentWorkingDirectory}, plan: ${this.currentPlan}`);
    console.error(`[Storage] Storage path: ${this.storagePath}`);
  }

  /**
   * 设置工作目录
   * 允许用户动态更改工作目录
   */
  async setWorkingDirectory(directory: string): Promise<void> {
    // 处理URL编码的路径（特别是Windows路径）
    let normalizedDirectory = directory;
    
    // 解码URL编码的路径
    if (directory.includes('%')) {
      try {
        normalizedDirectory = decodeURIComponent(directory);
      } catch (error) {
        console.error(`[Storage] Failed to decode URL path: ${directory}`);
      }
    }
    
    // 处理类似 /d:/github/... 的路径格式（转换为 D:\github\...）
    if (process.platform === 'win32' && normalizedDirectory.match(/^\/[a-zA-Z]:/)) {
      normalizedDirectory = normalizedDirectory.substring(1).replace(/\//g, '\\');
      // 确保驱动器字母是大写的
      normalizedDirectory = normalizedDirectory.charAt(0).toUpperCase() + normalizedDirectory.slice(1);
    }
    
    const resolvedPath = path.resolve(normalizedDirectory);
    
    // 验证目录是否存在
    try {
      const stats = await fs.stat(resolvedPath);
      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${resolvedPath}`);
      }
    } catch (error) {
      throw new Error(`Invalid directory: ${resolvedPath}. ${error instanceof Error ? error.message : String(error)}`);
    }

    console.error(`[Storage] Changing working directory from ${this.currentWorkingDirectory} to ${resolvedPath}`);
    
    this.currentWorkingDirectory = resolvedPath;
    this.updatePaths();
    
    // 重新初始化存储以加载新目录的数据
    await this.initialize();
  }

  /**
   * 获取当前工作目录
   */
  getCurrentWorkingDirectory(): string {
    return this.currentWorkingDirectory;
  }

  /**
   * 获取当前活动计划名称
   */
  getCurrentPlan(): string {
    return this.currentPlan;
  }

  /**
   * 检查是否为V1.0格式的项目（兼容性检查）
   */
  private async isV1Project(): Promise<boolean> {
    const v1DataPath = path.join(this.baseStorageDir, 'data.json');
    try {
      const stats = await fs.stat(v1DataPath);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  /**
   * 将V1.0数据迁移到V2.0格式
   */
  private async migrateV1ToV2(): Promise<void> {
    console.error(`[Storage] Migrating V1.0 data to V2.0 format...`);
    
    const v1DataPath = path.join(this.baseStorageDir, 'data.json');
    const v1PlanPath = path.join(this.baseStorageDir, 'plan.md');
    const v1TasksPath = path.join(this.baseStorageDir, 'tasks.md');
    
    const mainPlanDir = path.join(this.baseStorageDir, 'main');
    
    try {
      // 创建main计划目录
      await fs.mkdir(mainPlanDir, { recursive: true });
      
      // 迁移数据文件
      await fs.copyFile(v1DataPath, path.join(mainPlanDir, 'data.json'));
      
      // 迁移markdown文件（如果存在）
      try {
        await fs.copyFile(v1PlanPath, path.join(mainPlanDir, 'plan.md'));
      } catch {
        // plan.md不存在，忽略
      }
      
      try {
        await fs.copyFile(v1TasksPath, path.join(mainPlanDir, 'tasks.md'));
      } catch {
        // tasks.md不存在，忽略
      }
      
      // 备份原文件然后删除
      const backupDir = path.join(this.baseStorageDir, 'v1-backup');
      await fs.mkdir(backupDir, { recursive: true });
      
      await fs.rename(v1DataPath, path.join(backupDir, 'data.json'));
      
      try {
        await fs.rename(v1PlanPath, path.join(backupDir, 'plan.md'));
      } catch {
        // plan.md不存在，忽略
      }
      
      try {
        await fs.rename(v1TasksPath, path.join(backupDir, 'tasks.md'));
      } catch {
        // tasks.md不存在，忽略
      }
      
      console.error(`[Storage] V1.0 data successfully migrated to 'main' plan`);
      console.error(`[Storage] V1.0 backup saved to: ${backupDir}`);
      
    } catch (error) {
      console.error(`[Storage] Failed to migrate V1.0 data: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 列出所有计划
   */
  async listPlans(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.baseStorageDir, { withFileTypes: true });
      const plans = entries
        .filter(entry => entry.isDirectory() && entry.name !== 'v1-backup')
        .map(entry => entry.name)
        .sort();
      
      console.error(`[Storage] Found plans: ${plans.join(', ')}`);
      return plans;
    } catch (error) {
      // 目录不存在，返回空数组
      console.error(`[Storage] No plans directory found, returning empty list`);
      return [];
    }
  }

  /**
   * 创建新计划
   */
  async createNewPlan(planName: string, goal?: string): Promise<void> {
    // 验证计划名称
    if (!planName || planName.includes('/') || planName.includes('\\')) {
      throw new Error('Invalid plan name. Plan name cannot contain path separators.');
    }
    
    const planDir = path.join(this.baseStorageDir, planName);
    
    // 检查计划是否已存在
    try {
      await fs.stat(planDir);
      throw new Error(`Plan '${planName}' already exists.`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        throw error;
      }
      // 目录不存在，继续创建
    }
    
    // 创建计划目录
    await fs.mkdir(planDir, { recursive: true });
    
    // 创建空的数据文件
    const emptyData: StorageData = { goals: {}, plans: {} };
    
    // 如果提供了目标，创建初始目标
    if (goal) {
      const goalObj: Goal = {
        id: Date.now().toString(),
        description: goal,
        createdAt: new Date().toISOString(),
      };
      emptyData.goals[goalObj.id] = goalObj;
      
      const plan: ImplementationPlan = {
        goalId: goalObj.id,
        todos: [],
        updatedAt: new Date().toISOString(),
      };
      emptyData.plans[goalObj.id] = plan;
    }
    
    await fs.writeFile(
      path.join(planDir, 'data.json'),
      JSON.stringify(emptyData, null, 2)
    );
    
    console.error(`[Storage] Created new plan: ${planName}`);
  }

  /**
   * 设置活动计划
   */
  async setActivePlan(planName: string): Promise<void> {
    const plans = await this.listPlans();
    
    if (!plans.includes(planName)) {
      throw new Error(`Plan '${planName}' does not exist. Available plans: ${plans.join(', ')}`);
    }
    
    console.error(`[Storage] Switching from plan '${this.currentPlan}' to '${planName}'`);
    
    this.currentPlan = planName;
    this.updatePaths();
    
    // 重新初始化以加载新计划的数据
    await this.initialize();
  }

  async initialize(): Promise<void> {
    try {
      // **关键修复：立即重置内存数据缓存以防止数据污染**
      this.data = { goals: {}, plans: {} };
      
      // 检查并处理V1.0迁移
      if (await this.isV1Project()) {
        await this.migrateV1ToV2();
      }
      
      // Create plan directory if it doesn't exist
      await fs.mkdir(this.cursorDir, { recursive: true });
      console.error(`[Storage] Created/verified plan directory: ${this.cursorDir}`);

      // Try to load existing data
      try {
        const data = await fs.readFile(this.storagePath, 'utf-8');
        this.data = JSON.parse(data);
        console.error(`[Storage] Loaded existing data from: ${this.storagePath}`);
      } catch (readError) {
        console.error(`[Storage] No existing data file, creating new one: ${readError instanceof Error ? readError.message : String(readError)}`);
        // If file doesn't exist or can't be read, use default empty data
        await this.save();
      }
    } catch (error) {
      console.error(`[Storage] Failed to initialize storage: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`[Storage] Error details:`, error);
      throw error;
    }
  }

  async save(): Promise<void> {
    try {
      await fs.writeFile(this.storagePath, JSON.stringify(this.data, null, 2));
      await this.generateMarkdownFiles();
      console.error(`[Storage] Data saved to: ${this.storagePath}`);
    } catch (error) {
      console.error(`[Storage] Failed to save data: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private async generateMarkdownFiles(): Promise<void> {
    const goals = Object.values(this.data.goals);
    const plans = Object.values(this.data.plans);

    if (goals.length === 0) {
      return;
    }

    // Generate plan.md
    const planContent = this.generatePlanMarkdown(goals, plans);
    await fs.writeFile(this.planPath, planContent);

    // Generate tasks.md
    const tasksContent = this.generateTasksMarkdown(plans);
    await fs.writeFile(this.tasksPath, tasksContent);
  }

  private generatePlanMarkdown(goals: Goal[], plans: ImplementationPlan[]): string {
    let markdown = `# 软件开发计划 - ${this.currentPlan}\n\n`;
    markdown += `**当前计划**: ${this.currentPlan}\n`;
    markdown += `**工作目录**: ${this.currentWorkingDirectory}\n\n`;
    
    goals.forEach(goal => {
      const plan = plans.find(p => p.goalId === goal.id);
      if (!plan) return;

      markdown += `## 目标: ${goal.description}\n\n`;
      markdown += `**创建时间**: ${new Date(goal.createdAt).toLocaleString('zh-CN')}\n`;
      markdown += `**最后更新**: ${new Date(plan.updatedAt).toLocaleString('zh-CN')}\n\n`;

      const totalTasks = plan.todos.length;
      const completedTasks = plan.todos.filter(todo => todo.isComplete).length;
      const totalComplexity = plan.todos.reduce((sum, todo) => sum + todo.complexity, 0);
      const completedComplexity = plan.todos.filter(todo => todo.isComplete).reduce((sum, todo) => sum + todo.complexity, 0);

      markdown += `### 进度概览\n\n`;
      markdown += `- **任务进度**: ${completedTasks}/${totalTasks} (${totalTasks > 0 ? Math.round(completedTasks / totalTasks * 100) : 0}%)\n`;
      markdown += `- **复杂度进度**: ${completedComplexity}/${totalComplexity} (${totalComplexity > 0 ? Math.round(completedComplexity / totalComplexity * 100) : 0}%)\n\n`;

      markdown += `### 任务列表\n\n`;
      plan.todos.forEach((todo, index) => {
        const status = todo.isComplete ? '✅' : '⏳';
        markdown += `${index + 1}. ${status} **${todo.title}** (复杂度: ${todo.complexity})\n`;
        markdown += `   - ${todo.description}\n`;
        if (todo.codeExample) {
          markdown += `   - 代码示例:\n\`\`\`\n${todo.codeExample}\n\`\`\`\n`;
        }
        markdown += `   - 创建时间: ${new Date(todo.createdAt).toLocaleString('zh-CN')}\n`;
        markdown += `   - 更新时间: ${new Date(todo.updatedAt).toLocaleString('zh-CN')}\n\n`;
      });
    });

    return markdown;
  }

  private generateTasksMarkdown(plans: ImplementationPlan[]): string {
    let markdown = `# 开发任务 - ${this.currentPlan}\n\n`;
    markdown += `**当前计划**: ${this.currentPlan}\n`;
    markdown += `**工作目录**: ${this.currentWorkingDirectory}\n\n`;
    markdown += '这是当前计划的开发任务列表，按优先级和依赖关系排序。\n\n';

    plans.forEach(plan => {
      const pendingTodos = plan.todos.filter(todo => !todo.isComplete);
      const completedTodos = plan.todos.filter(todo => todo.isComplete);

      if (pendingTodos.length > 0) {
        markdown += `## 🔄 待完成任务\n\n`;
        pendingTodos.forEach((todo, index) => {
          markdown += `### ${index + 1}. ${todo.title}\n\n`;
          markdown += `**复杂度**: ${todo.complexity}/10\n\n`;
          markdown += `**描述**: ${todo.description}\n\n`;
          
          if (todo.codeExample) {
            markdown += `**参考代码**:\n\`\`\`\n${todo.codeExample}\n\`\`\`\n\n`;
          }
          
          markdown += `**创建时间**: ${new Date(todo.createdAt).toLocaleString('zh-CN')}\n\n`;
          markdown += '---\n\n';
        });
      }

      if (completedTodos.length > 0) {
        markdown += `## ✅ 已完成任务\n\n`;
        completedTodos.forEach((todo, index) => {
          markdown += `### ${index + 1}. ${todo.title}\n\n`;
          markdown += `**复杂度**: ${todo.complexity}/10\n\n`;
          markdown += `**描述**: ${todo.description}\n\n`;
          markdown += `**完成时间**: ${new Date(todo.updatedAt).toLocaleString('zh-CN')}\n\n`;
          markdown += '---\n\n';
        });
      }
    });

    if (plans.every(plan => plan.todos.length === 0)) {
      markdown += '暂无任务，请先创建开发计划。\n';
    }

    return markdown;
  }

  async createGoal(description: string): Promise<Goal> {
    const goal: Goal = {
      id: Date.now().toString(),
      description,
      createdAt: new Date().toISOString(),
    };

    this.data.goals[goal.id] = goal;
    await this.save();
    return goal;
  }

  async getGoal(id: string): Promise<Goal | null> {
    return this.data.goals[id] || null;
  }

  async getAllGoals(): Promise<Goal[]> {
    return Object.values(this.data.goals);
  }

  async createPlan(goalId: string): Promise<ImplementationPlan> {
    const plan: ImplementationPlan = {
      goalId,
      todos: [],
      updatedAt: new Date().toISOString(),
    };

    this.data.plans[goalId] = plan;
    await this.save();
    return plan;
  }

  async getPlan(goalId: string): Promise<ImplementationPlan | null> {
    return this.data.plans[goalId] || null;
  }

  async addTodo(
    goalId: string,
    { title, description, complexity, codeExample }: Omit<Todo, 'id' | 'isComplete' | 'createdAt' | 'updatedAt'>
  ): Promise<Todo> {
    const plan = await this.getPlan(goalId);
    if (!plan) {
      throw new Error(`No plan found for goal ${goalId}`);
    }

    const todo: Todo = {
      id: Date.now().toString(),
      title,
      description,
      complexity,
      codeExample,
      isComplete: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    plan.todos.push(todo);
    plan.updatedAt = new Date().toISOString();
    await this.save();
    return todo;
  }

  async removeTodo(goalId: string, todoId: string): Promise<void> {
    const plan = await this.getPlan(goalId);
    if (!plan) {
      throw new Error(`No plan found for goal ${goalId}`);
    }

    plan.todos = plan.todos.filter((todo: Todo) => todo.id !== todoId);
    plan.updatedAt = new Date().toISOString();
    await this.save();
  }

  async updateTodoStatus(goalId: string, todoId: string, isComplete: boolean): Promise<Todo> {
    const plan = await this.getPlan(goalId);
    if (!plan) {
      throw new Error(`No plan found for goal ${goalId}`);
    }

    const todo = plan.todos.find((t: Todo) => t.id === todoId);
    if (!todo) {
      throw new Error(`No todo found with id ${todoId}`);
    }

    todo.isComplete = isComplete;
    todo.updatedAt = new Date().toISOString();
    plan.updatedAt = new Date().toISOString();
    await this.save();
    return todo;
  }

  async getTodos(goalId: string): Promise<Todo[]> {
    const plan = await this.getPlan(goalId);
    return plan?.todos || [];
  }
}

export const storage = new Storage();
