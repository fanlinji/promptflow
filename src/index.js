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
    core.info(`GitHub Token 长度: ${token.length}`);
    core.info(`仓库格式检查: ${repo.includes('/') ? '有效' : '无效 - 缺少斜杠'}`);
    
    // 运行相应的工作流
    switch (workflowType) {
      case 'prompt-comment':
        core.info(`准备执行 prompt-comment 工作流...`);
        await runPromptCommentAction(token, repo);
        break;
      case 'prompt-reply':
        core.info(`准备执行 prompt-reply 工作流...`);
        await runPromptReplyAction(token, repo);
        break;
      default:
        throw new Error(`未知的工作流类型: ${workflowType}`);
    }
    
    core.info(`${workflowType}工作流执行完成`);
    
  } catch (error) {
    core.error(`运行失败，错误详情: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`);
    handleError(error, '运行操作失败');
  }
}

run(); 