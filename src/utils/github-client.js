// src/utils/github-client.js (最终完善版)

import * as github from '@actions/github';
import * as core from '@actions/core';
import axios from 'axios'; // <-- 确保引入 axios

/**
 * GitHub客户端类，用于与GitHub API交互
 */
export class GitHubClient {
  constructor(token, repo) {
    this.octokit = github.getOctokit(token);
    [this.owner, this.repo] = repo.split('/');
    this.token = token; // <-- [新增] 保存token以备后用
  }

  /**
   * [已修改] 获取仓库中的所有issue（支持分页）
   * @param {Object} options - 过滤issue的选项
   * @returns {Promise<Array>} - Issue对象数组
   */
  async getIssues(options = {}) {
    core.info(`正在获取仓库 ${this.owner}/${this.repo} 的所有 issues (分页)...`);
    const issues = await this.octokit.paginate(this.octokit.rest.issues.listForRepo, {
      owner: this.owner,
      repo: this.repo,
      state: options.state || 'open',
      ...options
    });
    return issues.filter(issue => !issue.pull_request);
  }

  /**
   * 获取带有特定标签的issue
   * @param {Array} labels - 标签名称数组
   * @returns {Promise<Array>} - Issue对象数组
   */
  async getIssuesWithLabels(labels) {
    return this.getIssues({ labels: labels.join(',') });
  }

  /**
   * [已修改] 获取issue的所有评论（支持分页）
   * @param {number} issueNumber - Issue编号
   * @returns {Promise<Array>} - 评论对象数组
   */
  async getIssueComments(issueNumber) {
    core.info(`正在获取 issue #${issueNumber} 的所有评论 (分页)...`);
    return await this.octokit.paginate(this.octokit.rest.issues.listComments, {
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    });
  }

  /**
   * 获取API issue（带有'api'标签的issue）
   * @returns {Promise<Object>} - API issue对象
   */
  async getApiIssue() {
    const apiIssues = await this.getIssuesWithLabels(['api']);
    if (apiIssues.length === 0) {
      throw new Error('没有找到带有"api"标签的issue');
    }
    return apiIssues[0];
  }

  /**
   * 从API issue中获取API配置
   * @returns {Promise<Array>} - API配置数组
   */
  async getApiConfigs() {
    const apiIssue = await this.getApiIssue();
    const comments = await this.getIssueComments(apiIssue.number);
    const { extractApiConfigs } = await import('./api-client.js');
    return extractApiConfigs(comments);
  }

  /**
   * [已修改] 获取仓库中的所有讨论（支持分页）
   * @returns {Promise<Array>} - 讨论对象数组
   */
  async getDiscussions() {
    let allDiscussions = [];
    let hasNextPage = true;
    let endCursor = null;

    const queryTemplate = `
      query($owner: String!, $repo: String!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
          discussions(first: 100, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              title
              body
              number
              category {
                name
              }
            }
          }
        }
      }
    `;
    
    core.info('开始获取所有讨论（支持分页）...');
    while (hasNextPage) {
      const { repository } = await this.octokit.graphql(queryTemplate, {
        owner: this.owner,
        repo: this.repo,
        cursor: endCursor
      });
      
      const newDiscussions = repository.discussions.nodes.filter(d => d !== null);
      allDiscussions.push(...newDiscussions);
      hasNextPage = repository.discussions.pageInfo.hasNextPage;
      endCursor = repository.discussions.pageInfo.endCursor;
    }
    core.info(`所有讨论获取完毕，共 ${allDiscussions.length} 个。`);
    return allDiscussions;
  }

  /**
   * 通过标题获取讨论
   * @param {string} title - 讨论标题
   * @returns {Promise<Object|null>} - 讨论对象，如果未找到则为null
   */
  async getDiscussionByTitle(title) {
    const discussions = await this.getDiscussions();
    return discussions.find(discussion => discussion.title === title) || null;
  }

  /**
   * 创建新讨论
   * @param {string} title - 讨论标题
   * @param {string} body - 讨论内容
   * @returns {Promise<Object>} - 创建的讨论对象
   */
  async createDiscussion(title, body) {
    const { data: repoData } = await this.octokit.rest.repos.get({
      owner: this.owner,
      repo: this.repo,
    });
    const repositoryId = repoData.node_id;

    if (!repositoryId) {
      throw new Error(`无法获取仓库 ${this.owner}/${this.repo} 的 node_id`);
    }

    const categoryQuery = `
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          discussionCategories(first: 10) {
            nodes {
              id
              name
            }
          }
        }
      }
    `;
    const { repository } = await this.octokit.graphql(categoryQuery, {
      owner: this.owner,
      repo: this.repo
    });

    const categories = repository.discussionCategories.nodes;
    if (categories.length === 0) {
      throw new Error('仓库中没有找到讨论分类');
    }
    
    const generalCategory = categories.find(cat => cat.name === 'General');
    if (!generalCategory) {
      throw new Error('在仓库中没有找到名为 "General" 的讨论分类。请确保该分类存在。');
    }
    const categoryId = generalCategory.id;

    const createMutation = `
      mutation($input: CreateDiscussionInput!) {
        createDiscussion(input: $input) {
          discussion {
            id
            title
            body
            number
          }
        }
      }
    `;
    const { createDiscussion } = await this.octokit.graphql(createMutation, {
      input: {
        repositoryId,
        categoryId,
        title,
        body
      }
    });

    return createDiscussion.discussion;
  }

  /**
   * [正确] 获取一个讨论下的所有评论（支持自动分页）
   * @param {number} discussionNumber - 讨论编号
   * @returns {Promise<Array>} - 所有的评论对象数组
   */
  async getDiscussionComments(discussionNumber) {
    let allComments = [];
    let hasNextPage = true;
    let endCursor = null;

    const queryTemplate = `
      query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
          discussion(number: $number) {
            comments(first: 100, after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                body
                createdAt
                author { login }
                replies(first: 100) { nodes { id, body, createdAt, author { login } } }
                reactions(first: 100) { nodes { content } }
              }
            }
          }
        }
      }
    `;

    core.info(`开始获取讨论 #${discussionNumber} 的所有评论（支持分页）...`);
    while (hasNextPage) {
      const { repository } = await this.octokit.graphql(queryTemplate, {
        owner: this.owner,
        repo: this.repo,
        number: discussionNumber,
        cursor: endCursor
      });
      const discussion = repository.discussion;
      if (!discussion || !discussion.comments) {
        core.warning(`在讨论 #${discussionNumber} 中找不到评论，或返回格式异常。`);
        break; 
      }
      const newComments = discussion.comments.nodes.filter(node => node !== null);
      allComments.push(...newComments);
      hasNextPage = discussion.comments.pageInfo.hasNextPage;
      endCursor = discussion.comments.pageInfo.endCursor;
    }
    
    core.info(`讨论 #${discussionNumber} 的评论全部获取完毕，共 ${allComments.length} 条。`);
    return allComments;
  }

  /**
   * 向讨论添加评论
   * @param {string} discussionId - 讨论ID
   * @param {string} body - 评论内容
   * @returns {Promise<Object>} - 创建的评论对象
   */
  async addDiscussionComment(discussionId, body) {
    const mutation = `
      mutation($input: AddDiscussionCommentInput!) {
        addDiscussionComment(input: $input) { comment { id, body } }
      }
    `;
    const { addDiscussionComment } = await this.octokit.graphql(mutation, {
      input: { discussionId, body }
    });
    return addDiscussionComment.comment;
  }

  /**
   * 向讨论评论添加回复
   * @param {string} discussionId - 讨论的ID
   * @param {string} commentId - 要回复的评论ID
   * @param {string} body - 回复内容
   * @returns {Promise<Object>} - 创建的回复对象
   */
  async addDiscussionReply(discussionId, commentId, body) {
    const mutation = `
      mutation($input: AddDiscussionCommentInput!) {
        addDiscussionComment(input: $input) { comment { id, body } }
      }
    `;
    const { addDiscussionComment } = await this.octokit.graphql(mutation, {
      input: {
        discussionId,
        replyToId: commentId,
        body
      }
    });
    return addDiscussionComment.comment;
  }

  /**
   * 向issue评论添加踩(👎)反应
   * @param {number} commentId - 评论ID
   * @returns {Promise<void>}
   */
  async addThumbsDownToIssueComment(commentId) {
    await this.octokit.rest.reactions.createForIssueComment({
      owner: this.owner,
      repo: this.repo,
      comment_id: commentId,
      content: '-1'
    });
  }

  /**
   * 检查issue评论是否有踩(👎)反应
   * @param {Object} comment - 评论对象
   * @returns {boolean}
   */
  hasThumbsDownReaction(comment) {
    if (!comment.reactions) return false;
    return comment.reactions['-1'] > 0;
  }

  /**
   * 检查讨论评论是否有踩(👎)反应
   * @param {Object} comment - 讨论评论对象
   * @returns {boolean}
   */
  hasDiscussionThumbsDownReaction(comment) {
    if (!comment.reactions || !comment.reactions.nodes) return false;
    return comment.reactions.nodes.some(reaction => reaction.content === 'THUMBS_DOWN');
  }

  /**
   * 向讨论评论添加踩(👎)反应
   * @param {string} commentId - 评论ID (node_id)
   * @returns {Promise<void>}
   */
  async addThumbsDownToDiscussionComment(commentId) {
    const mutation = `
      mutation($input: AddReactionInput!) {
        addReaction(input: $input) { reaction { content } }
      }
    `;
    await this.octokit.graphql(mutation, {
      input: {
        subjectId: commentId,
        content: 'THUMBS_DOWN'
      }
    });
  }
  /**
   * [正确位置] downloadFile 函数应该放在这里
   * 在 addThumbsDownToDiscussionComment 函数之后，
   * 并且在整个类的最后一个 `}` 之前。
   * @param {string} fileUrl - 文件的URL
   * @returns {Promise<Buffer>} - 文件的二进制数据
   */
  async downloadFile(fileUrl) {
    core.info(`正在从 ${fileUrl} 下载文件...`);
    try {
      const response = await axios.get(fileUrl, {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'application/octet-stream'
        },
        responseType: 'arraybuffer'
      });
      return response.data;
    } catch (error) {
      core.error(`下载文件失败: ${error.message}`);
      throw error;
    }
  }

} // <--- 这是 class 的最后一个 `}`
// (文件末尾不应该再有任何 `}` 了)


