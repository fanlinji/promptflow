import * as core from '@actions/core';
import { GitHubClient } from '../utils/github-client.js';
import { callLlmApi, extractGeneratedText } from '../utils/api-client.js';
import { extractPrompt, fillTemplate, handleError } from '../utils/helpers.js';

/**
 * 处理prompt-reply工作流
 * @param {string} token - GitHub令牌
 * @param {string} repo - 仓库名称（owner/repo）
 */
export async function runPromptReplyAction(token, repo) {
  try {
    const github = new GitHubClient(token, repo);
    
    // 获取API配置
    core.info('正在获取API配置...');
    const apiConfigs = await github.getApiConfigs();
    core.info(`找到${apiConfigs.length}个API配置`);
    
    // 加载提示模板
    core.info('正在加载提示模板...');
    const promptTemplates = await loadPromptTemplates(github);
    core.info(`找到${Object.keys(promptTemplates).length}个提示模板`);
    
    // 获取所有讨论
    core.info('正在获取讨论...');
    const discussions = await github.getDiscussions();
    core.info(`找到${discussions.length}个讨论`);
    
    // 跟踪使用过的模板
    const usedTemplateIds = new Set();
    
    // 处理每个讨论
    for (const discussion of discussions) {
      core.info(`处理讨论#${discussion.number}: ${discussion.title}`);
      
      // 获取讨论的评论
      const comments = await github.getDiscussionComments(discussion.number);
      core.info(`在讨论#${discussion.number}中找到${comments.length}条评论`);
      
      // 处理每条评论
      for (const comment of comments) {
        // 跳过带有踩(👎)反应的评论
        if (github.hasDiscussionThumbsDownReaction(comment)) {
          core.info(`跳过评论${comment.id}（已处理）`);
          continue;
        }
        
        core.info(`处理评论${comment.id}`);
        const commentBody = comment.body;
        
        // 对评论应用每个提示模板
        let allTemplatesSucceeded = true;
        
        for (const [templateType, template] of Object.entries(promptTemplates)) {
          try {
            // 用评论内容填充模板
            const filledPrompt = fillTemplate(template.content, commentBody);
            
            // 调用LLM API
            const apiResponse = await callLlmApi(apiConfigs, filledPrompt);
            const generatedText = extractGeneratedText(apiResponse);
            
            // 向评论添加回复
            core.info(`使用模板${templateType}向评论${comment.id}添加回复`);
            await github.addDiscussionReply(discussion.id, comment.id, generatedText);
            
            // 标记模板为已使用
            usedTemplateIds.add(template.id);
            
          } catch (error) {
            core.warning(`将模板${templateType}应用于评论${comment.id}时出错: ${error.message}`);
            allTemplatesSucceeded = false;
            // 继续使用下一个模板
          }
        }
        
        // 只有当所有模板都成功时，才将评论标记为已处理
        if (allTemplatesSucceeded) {
          core.info(`将评论${comment.id}标记为已处理`);
          await github.addThumbsDownToDiscussionComment(comment.id);
        }
      }
    }
    
    // 将使用过的模板标记为已处理
    await markUsedTemplatesAsProcessed(github, usedTemplateIds);
    
    core.info('prompt-reply工作流成功完成');
    
  } catch (error) {
    handleError(error, '运行prompt-reply操作失败');
  }
}

/**
 * 从带有prompt和reply标签的issue中加载提示模板
 * @param {GitHubClient} github - GitHub客户端
 * @returns {Object} - 提示模板映射
 */
async function loadPromptTemplates(github) {
  const templates = {};
  
  // 获取带有prompt和reply标签的issue
  core.info('正在尝试获取带有prompt和reply标签的issues...');
  try {
    core.info('调用 getIssuesWithLabels 方法...');
    const issues = await github.getIssuesWithLabels(['prompt', 'reply']);
    core.info(`成功获取到 ${issues.length} 个带有prompt和reply标签的issues`);
    
    if (issues.length === 0) {
      throw new Error('没有找到带有prompt和reply标签的issue');
    }
    
    const issue = issues[0]; // 使用第一个issue
    core.info(`使用issue #${issue.number}: ${issue.title}`);
    
    core.info(`正在获取issue #${issue.number}的评论...`);
    const comments = await github.getIssueComments(issue.number);
    core.info(`成功获取到 ${comments.length} 条评论`);
    
    // 将每条评论作为模板源处理
    for (const comment of comments) {
      // 跳过带有踩(👎)反应的评论
      if (github.hasThumbsDownReaction(comment)) {
        core.info(`跳过评论 ${comment.id}（已处理）`);
        continue;
      }
      
      // 从评论中提取提示
      core.info(`正在从评论 ${comment.id} 中提取提示...`);
      const prompt = extractPrompt(comment.body);
      if (!prompt) {
        core.info(`评论 ${comment.id} 中没有找到有效的提示格式`);
        continue;
      }
      
      core.info(`从评论 ${comment.id} 中提取到类型为 ${prompt.type} 的提示`);
      // 存储模板及其评论ID，以便稍后标记
      templates[prompt.type] = {
        content: prompt.content,
        id: comment.id
      };
    }
    
    core.info(`总共加载了 ${Object.keys(templates).length} 个提示模板`);
    return templates;
  } catch (error) {
    core.error(`加载提示模板失败: ${error.message}`);
    core.error(`错误详情: ${JSON.stringify(error)}`);
    throw error;
  }
}

/**
 * 将使用过的模板标记为已处理
 * @param {GitHubClient} github - GitHub客户端
 * @param {Set} usedTemplateIds - 使用过的模板ID集合
 */
async function markUsedTemplatesAsProcessed(github, usedTemplateIds) {
  core.info(`标记${usedTemplateIds.size}个模板为已处理`);
  
  for (const id of usedTemplateIds) {
    try {
      await github.addThumbsDownToIssueComment(id);
    } catch (error) {
      core.warning(`将模板${id}标记为已处理时出错: ${error.message}`);
    }
  }
} 