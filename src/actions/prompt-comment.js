import * as core from '@actions/core';
import { GitHubClient } from '../utils/github-client.js';
import { callLlmApi, extractGeneratedText } from '../utils/api-client.js';
import { extractPrompt, handleError } from '../utils/helpers.js';

/**
 * 处理prompt-comment工作流
 * @param {string} token - GitHub令牌
 * @param {string} repo - 仓库名称（owner/repo）
 */
export async function runPromptCommentAction(token, repo) {
  try {
    const github = new GitHubClient(token, repo);
    
    // 获取API配置
    core.info('正在获取API配置...');
    const apiConfigs = await github.getApiConfigs();
    core.info(`找到${apiConfigs.length}个API配置`);
    
    // 获取带有prompt和comment标签的issue
    core.info('正在获取带有prompt和comment标签的issue...');
    const issues = await github.getIssuesWithLabels(['prompt', 'comment']);
    core.info(`找到${issues.length}个带有prompt和comment标签的issue`);
    
    // 处理每个issue
    for (const issue of issues) {
      core.info(`处理issue #${issue.number}: ${issue.title}`);
      
      // 获取issue的评论
      const comments = await github.getIssueComments(issue.number);
      core.info(`在issue #${issue.number}中找到${comments.length}条评论`);
      
      // 处理每条评论
      for (const comment of comments) {
        // 跳过带有踩(👎)反应的评论
        if (github.hasThumbsDownReaction(comment)) {
          core.info(`跳过评论${comment.id}（已处理）`);
          continue;
        }
        
        // 从评论中提取提示
        const prompt = extractPrompt(comment.body);
        if (!prompt) {
          core.info(`跳过评论${comment.id}（未找到提示）`);
          continue;
        }
        
        core.info(`处理提示: ${prompt.type}`);
        
        try {
          // [修改] 直接调用callLlmApi并传递prompt内容
          // const apiResponse = await callLlmApi(apiConfigs, prompt.content);
          // const generatedText = extractGeneratedText(apiResponse);

          // 这是修改后的代码
          let generatedText = await callLlmApi(apiConfigs, prompt.content);

          // [推荐] 对最终文本进行清理，去除首尾可能存在的换行符或空格
          generatedText = generatedText.trim();
          
          // 查找或创建与issue标题相同的讨论
          let discussion = await github.getDiscussionByTitle(issue.title);
          if (!discussion) {
            core.info(`创建讨论: ${issue.title}`);
            discussion = await github.createDiscussion(issue.title, issue.title);
          }
          
          // 向讨论添加评论
          core.info(`向讨论#${discussion.number}添加评论`);
          await github.addDiscussionComment(discussion.id, generatedText);
          
          // 将评论标记为已处理
          // core.info(`将评论${comment.id}标记为已处理`);
          // await github.addThumbsDownToIssueComment(comment.id);
          
        } catch (error) {
          core.warning(`处理评论${comment.id}时出错: ${error.message}`);
          // 继续处理下一条评论
        }
      }
    }
    
    core.info('prompt-comment工作流成功完成');
    
  } catch (error) {
    handleError(error, '运行prompt-comment操作失败');
  }
} 