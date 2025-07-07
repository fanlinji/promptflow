import * as core from '@actions/core';
import { runPromptCommentAction } from './actions/prompt-comment.js';
import { runPromptReplyAction } from './actions/prompt-reply.js';
import { handleError } from './utils/helpers.js';

async function run() {
  try {
    // 获取输入参数
    const token = core.getInput('github-token', { required: true });
    const repo = core.getInput('data-repo', { required: true });
    const workflowType = core.getInput('workflow-type', { required: true });
    
    core.info(`开始执行${workflowType}工作流，仓库: ${repo}`);
    
    // 运行相应的工作流
    switch (workflowType) {
      case 'prompt-comment':
        await runPromptCommentAction(token, repo);
        break;
      case 'prompt-reply':
        await runPromptReplyAction(token, repo);
        break;
      default:
        throw new Error(`未知的工作流类型: ${workflowType}`);
    }
    
  } catch (error) {
    handleError(error, '运行操作失败');
  }
}

run(); 