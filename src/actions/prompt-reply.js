import * as core from '@actions/core';
import { GitHubClient } from '../utils/github-client.js';
import { callLlmApi } from '../utils/api-client.js';
import { extractPrompt, fillTemplate, handleError, extractFileUrl } from '../utils/helpers.js';
// [修改] 引入新的、可靠的PDF解析库
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

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
    
    // 跟踪使用过的模板ID，以便后续手动标记
    const usedTemplateIds = new Set();
    
    // 处理每个讨论
    for (const discussion of discussions) {
      core.info(`处理讨论 #${discussion.number}: ${discussion.title}`);
      
      const comments = await github.getDiscussionComments(discussion.number);
      core.info(`在讨论 #${discussion.number} 中找到${comments.length}条评论`);
      
      // 处理每条评论
      for (const comment of comments) {
        if (github.hasDiscussionThumbsDownReaction(comment)) {
          core.info(`跳过评论 ${comment.id}（已手动标记为已处理）`);
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
            
            // [修改] 使用 pdfjs-dist 的新方法来解析PDF
            const doc = await pdfjsLib.getDocument({ data: fileBuffer }).promise;
            core.info(`PDF 文件解析成功，共 ${doc.numPages} 页。正在提取文本...`);
            
            let fullText = '';
            for (let i = 1; i <= doc.numPages; i++) {
              const page = await doc.getPage(i);
              const textContent = await page.getTextContent();
              const pageText = textContent.items.map(item => item.str).join(' ');
              fullText += pageText + '\n\n'; // 每页内容后加换行
            }
            contextContent = fullText;
            core.info(`PDF 文本提取完毕。`);

          } else {
            core.info('评论中未找到 PDF 文件，将使用评论本身作为内容。');
            contextContent = comment.body; 
          }

          let allTemplatesSucceeded = true;
          for (const [templateType, template] of Object.entries(promptTemplates)) {
            try {
              const filledPrompt = fillTemplate(template.content, contextContent);
              
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
          
          // 根据你的要求，已移除自动标记 discussion comment 的功能
          
        } catch (error) {
          core.warning(`处理评论 ${comment.id} 时发生顶层错误: ${error.message}`);
        }
      }
    }
    
    // 根据你的要求，已移除自动标记 template 的功能
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
      // 这里的ID可能是issue的ID或comment的ID，需要区分处理
      // 但由于函数已不被调用，此处的逻辑暂时保留
      await github.addThumbsDownToIssueComment(id);
    } catch (error) {
      core.warning(`将模板源 ${id} 标记为已处理时出错: ${error.message}`);
    }
  }
}