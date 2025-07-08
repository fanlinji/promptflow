// src/actions/prompt-reply.js (原生文件处理最终版)

import * as core from '@actions/core';
import { GitHubClient } from '../utils/github-client.js';
import { callLlmApi } from '../utils/api-client.js';
import { extractPrompt, fillTemplate, handleError, extractFileUrl } from '../utils/helpers.js';

/**
 * 处理prompt-reply工作流
 * @param {string} token - GitHub令牌
 * @param {string} repo - 仓库名称（owner/repo）
 */
export async function runPromptReplyAction(token, repo) {
  try {
    const github = new GitHubClient(token, repo);
    
    const apiConfigs = await github.getApiConfigs();
    const promptTemplates = await loadPromptTemplates(github);
    const discussions = await github.getDiscussions();
    
    core.info(`找到 ${apiConfigs.length}个API配置, ${Object.keys(promptTemplates).length}个模板, ${discussions.length}个讨论`);
    
    for (const discussion of discussions) {
      core.info(`处理讨论 #${discussion.number}: ${discussion.title}`);
      
      const comments = await github.getDiscussionComments(discussion.number);
      core.info(`在讨论 #${discussion.number} 中找到${comments.length}条评论`);
      
      for (const comment of comments) {
        if (github.hasDiscussionThumbsDownReaction(comment)) {
          core.info(`跳过评论 ${comment.id}（已手动标记）`);
          continue;
        }
        
        core.info(`处理评论 ${comment.id}`);
        
        try {
          const fileUrl = extractFileUrl(comment.body);
          let fileBuffer = null;
          let mimeType = null;

          if (fileUrl && fileUrl.endsWith('.pdf')) {
            core.info('在评论中找到 PDF 文件链接，开始下载...');
            fileBuffer = await github.downloadFile(fileUrl);
            mimeType = 'application/pdf';
            core.info('PDF 文件下载成功。');
          }

          for (const [templateType, template] of Object.entries(promptTemplates)) {
            try {
              // 注意：我们不再把文件内容填充到模板里
              // 而是把模板作为纯文本指令，文件作为附加内容
              const textPrompt = fillTemplate(template.content, fileBuffer ? "请分析你收到的文件" : comment.body);
              
              let generatedText;
              if(fileBuffer) {
                // 如果有文件，同时传递文本指令和文件
                generatedText = await callLlmApi(apiConfigs, textPrompt, fileBuffer, mimeType);
              } else {
                // 如果没有文件，只传递文本指令
                generatedText = await callLlmApi(apiConfigs, textPrompt);
              }
              
              generatedText = generatedText.trim();
              
              core.info(`使用模板 ${templateType} 向评论 ${comment.id} 添加回复`);
              await github.addDiscussionReply(discussion.id, comment.id, generatedText);
              
            } catch (error) {
              core.warning(`将模板 ${templateType} 应用于评论 ${comment.id} 时出错: ${error.message}`);
            }
          }
        } catch (error) {
          core.warning(`处理评论 ${comment.id} 时发生顶层错误: ${error.message}`);
        }
      }
    }
    
    core.info('prompt-reply工作流成功完成');
    
  } catch (error) {
    handleError(error, '运行prompt-reply操作失败');
  }
}

async function loadPromptTemplates(github) {
  const templates = {};
  const issues = await github.getIssuesWithLabels(['prompt', 'reply']);
  if (issues.length === 0) {
    throw new Error('没有找到带有prompt和reply标签的issue');
  }
  
  const issue = issues[0]; 
  const comments = await github.getIssueComments(issue.number);
  const sources = [{ id: issue.id, body: issue.body, reactions: issue.reactions }, ...comments];

  for (const source of sources) {
    if (!source.body || github.hasThumbsDownReaction(source)) continue;
    const prompt = extractPrompt(source.body);
    if (!prompt) continue;
    templates[prompt.type] = { content: prompt.content, id: source.id };
  }
  return templates;
}