import * as core from '@actions/core';
import { GitHubClient } from '../utils/github-client.js';
import { callLlmApi } from '../utils/api-client.js';
import { extractPrompt, fillTemplate, handleError, extractFileUrl } from '../utils/helpers.js';
import pdf from 'pdf-parse';

/**
 * 处理prompt-reply工作流
 * @param {string} token - GitHub令牌
 * @param {string} repo - 仓库名称（owner/repo）
 */
export async function runPromptReplyAction(token, repo) {
  try {
    const github = new GitHubClient(token, repo);
    
    core.info('正在获取API配置...');
    const apiConfigs = await github.getApiConfigs();
    core.info(`找到${apiConfigs.length}个API配置`);
    
    core.info('正在加载提示模板...');
    const promptTemplates = await loadPromptTemplates(github);
    core.info(`找到${Object.keys(promptTemplates).length}个提示模板`);
    
    core.info('正在获取所有讨论...');
    const discussions = await github.getDiscussions();
    core.info(`找到${discussions.length}个讨论`);
    
    const usedTemplateIds = new Set();
    
    for (const discussion of discussions) {
      core.info(`处理讨论 #${discussion.number}: ${discussion.title}`);
      
      const comments = await github.getDiscussionComments(discussion.number);
      core.info(`在讨论 #${discussion.number} 中找到${comments.length}条评论`);
      
      for (const comment of comments) {
        if (github.hasDiscussionThumbsDownReaction(comment)) {
          core.info(`跳过评论 ${comment.id}（已处理）`);
          continue;
        }
        
        core.info(`处理评论 ${comment.id}`);
        
        try {
          let contextContent = ''; // 这个变量将作为填充模板的 {{文章}} 内容

          // 优先从评论中提取和处理文件链接
          const fileUrl = extractFileUrl(comment.body);

          if (fileUrl && fileUrl.endsWith('.pdf')) {
            core.info('在评论中找到 PDF 文件链接，开始下载和解析...');
            const fileBuffer = await github.downloadFile(fileUrl);
            const data = await pdf(fileBuffer);
            contextContent = data.text; // PDF 的文本内容成为上下文
            core.info(`PDF 文件解析成功，共 ${data.numpages} 页。`);
          } else {
            core.info('评论中未找到 PDF 文件，将使用评论本身作为内容。');
            contextContent = comment.body; // 如果没有文件，则使用评论原文作为上下文
          }

          let allTemplatesSucceeded = true;
          for (const [templateType, template] of Object.entries(promptTemplates)) {
            try {
              // 用提取出的内容（PDF文本或评论原文）填充模板
              const filledPrompt = fillTemplate(template.content, contextContent);
              
              // 正确调用LLM API
              let generatedText = await callLlmApi(apiConfigs, filledPrompt);
              generatedText = generatedText.trim();
              
              core.info(`使用模板 ${templateType} 向评论 ${comment.id} 添加回复`);
              await github.addDiscussionReply(discussion.id, comment.id, generatedText);
              
              usedTemplateIds.add(template.id);
              
            } catch (error) {
              core.warning(`将模板 ${templateType} 应用于评论 ${comment.id} 时出错: ${error.message}`);
              allTemplatesSucceeded = false;
            }
          }
          
          // 已根据你的要求，移除自动标记 discussion comment 的功能
          
        } catch (error) {
          core.warning(`处理评论 ${comment.id} 时发生顶层错误: ${error.message}`);
        }
      }
    }
    
    // 已根据你的要求，移除自动标记 template 的功能
    // await markUsedTemplatesAsProcessed(github, usedTemplateIds);
    
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
  
  const issues = await github.getIssuesWithLabels(['prompt', 'reply']);
  if (issues.length === 0) {
    throw new Error('没有找到带有prompt和reply标签的issue');
  }
  
  const issue = issues[0]; 
  const comments = await github.getIssueComments(issue.number);
  
  // 将issue的body和所有comments都作为模板的来源
  const sources = [{ id: issue.id, node_id: issue.node_id, body: issue.body, reactions: issue.reactions }, ...comments];

  for (const source of sources) {
    if (!source.body) continue;
    if (github.hasThumbsDownReaction(source)) {
      continue;
    }
    
    const prompt = extractPrompt(source.body);
    if (!prompt) {
      continue;
    }
    
    // 使用 source.id (数字ID) 或 source.node_id (全局ID) 均可，取决于标记函数需要哪个
    // 我们的 addThumbsDownToIssueComment 需要的是数字ID (comment_id 或 issue_id)
    // 但我们的标记功能已经移除了，所以这里暂时不重要
    templates[prompt.type] = {
      content: prompt.content,
      id: source.id 
    };
  }
  
  return templates;
}

/**
 * (此函数已不再被调用) 将使用过的模板标记为已处理
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